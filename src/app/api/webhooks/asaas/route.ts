// Webhook Asaas — idempotente, validado por authToken.
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { enqueueListUpdate, sendPaymentConfirmed } from "@/lib/messaging";
import { getAsaasConfig } from "@/lib/settings";

const STATUS_MAP: Record<string, string> = {
  PAYMENT_RECEIVED: "received",
  PAYMENT_CONFIRMED: "confirmed",
  PAYMENT_OVERDUE: "overdue",
  PAYMENT_REFUNDED: "refunded",
  PAYMENT_DELETED: "canceled",
};

export async function POST(req: NextRequest) {
  // 1. valida token
  const token = req.headers.get("asaas-access-token");
  const { webhookToken } = await getAsaasConfig();
  if (!webhookToken || !token || token !== webhookToken) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const payload = await req.json().catch(() => null);
  if (!payload?.event || !payload?.id) return NextResponse.json({ error: "bad_payload" }, { status: 400 });

  const db = supabaseAdmin();

  // 2. idempotência: insere event_key único; duplicado → 200 e sai
  const { error: insErr } = await db.from("webhook_events").insert({
    source: "asaas",
    event_key: payload.id,
    event_type: payload.event,
    payload,
  });
  if (insErr) {
    if (insErr.code === "23505") return NextResponse.json({ ok: true, duplicate: true });
    console.error("webhook insert failed", insErr);
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }

  try {
    const asaasPaymentId: string | undefined = payload.payment?.id;

    // mensalidade gerada pela assinatura → cria cobrança local e AVISA o mensalista com o Pix
    if (payload.event === "PAYMENT_CREATED" && asaasPaymentId && payload.payment?.subscription) {
      const { data: member } = await db
        .from("team_members")
        .select("player_id, team_id, players(name, phone), teams(name)")
        .eq("asaas_subscription_id", payload.payment.subscription)
        .maybeSingle();
      if (member) {
        const { data: existing } = await db.from("charges").select("id").eq("asaas_payment_id", asaasPaymentId).maybeSingle();
        let chargeId = existing?.id as string | undefined;
        if (!chargeId) {
          const { data: created } = await db.from("charges").insert({
            player_id: member.player_id,
            team_id: member.team_id,
            type: "subscription",
            asaas_payment_id: asaasPaymentId,
            amount: payload.payment.value,
            status: "pending",
            due_date: payload.payment.dueDate ?? null,
          }).select("id").single();
          chargeId = created?.id;
        }
        // O Asaas gera a mensalidade do mês SEGUINTE com ~30 dias de antecedência.
        // Só avisamos na hora se o vencimento estiver próximo; senão os lembretes
        // (5 dias antes e no dia) cuidam disso — evita "cobrança de outubro em setembro".
        const dueStr: string = payload.payment.dueDate ?? new Date().toISOString().slice(0, 10);
        const daysToDue = Math.round((new Date(dueStr + "T12:00:00-03:00").getTime() - Date.now()) / 86400e3);
        const { sendMembershipCreated, alreadyDispatched } = await import("@/lib/messaging");
        if (chargeId && daysToDue <= 7 && !(await alreadyDispatched(`sub_created:${chargeId}`))) {
          const pl = member.players as unknown as { name: string; phone: string };
          const tm = member.teams as unknown as { name: string };
          const { Asaas } = await import("@/lib/asaas");
          const qr = await Asaas.getPixQr(asaasPaymentId).catch(() => null);
          if (qr?.payload) await db.from("charges").update({ pix_qr: qr.encodedImage, pix_copypaste: qr.payload }).eq("id", chargeId);
          await sendMembershipCreated({
            teamId: member.team_id, phone: pl.phone, playerName: pl.name, teamName: tm.name,
            amount: Number(payload.payment.value), dueDate: payload.payment.dueDate ?? new Date().toISOString().slice(0, 10),
            chargeId, copypaste: qr?.payload ?? null, invoiceUrl: payload.payment.invoiceUrl ?? null,
          }).catch((e) => console.error("[whatsapp] mensalidade gerada:", e));
        }
      }
    }

    if (asaasPaymentId && STATUS_MAP[payload.event]) {
      const { data: charge } = await db
        .from("charges")
        .select("id, type, game_id, status")
        .eq("asaas_payment_id", asaasPaymentId)
        .maybeSingle();

      if (charge) {
        const newStatus = STATUS_MAP[payload.event];
        // não regride status final
        const finals = ["refunded", "canceled"];
        if (!(finals.includes(charge.status) && !finals.includes(newStatus))) {
          const paid = newStatus === "received" || newStatus === "confirmed";
          await db.from("charges").update({ status: newStatus, ...(paid ? { paid_at: new Date().toISOString() } : {}) }).eq("id", charge.id);
          // forma de pagamento: Pix do Asaas — sem sobrescrever dinheiro/Pix manual já acusado pelo admin
          const manual = payload.payment?.status === "RECEIVED_IN_CASH";
          if (paid && !manual) {
            await db.from("charges").update({ payment_method: "asaas_pix" }).eq("id", charge.id).is("payment_method", null);
          }
        }
        await db.from("payment_events").insert({
          charge_id: charge.id, asaas_event: payload.event, payload,
        });

        // estorno concluído (inclusive o autorizado manualmente no Asaas):
        // o crédito daquela cobrança deixa de valer e a pendência some da tela
        if (payload.event === "PAYMENT_REFUNDED") {
          const { revokeCreditsForCharge } = await import("@/lib/credits");
          await revokeCreditsForCharge(charge.id);
          await db.from("game_participants").update({ status: "removed" })
            .eq("charge_id", charge.id).in("status", ["pending_review", "withdrawn"]);
        }

        // pagamento de avulso confirmado → confirma vaga
        if ((payload.event === "PAYMENT_RECEIVED" || payload.event === "PAYMENT_CONFIRMED") && charge.type === "dropin" && charge.game_id) {
          const { data: result } = await db.rpc("fn_confirm_dropin_payment", { p_charge_id: charge.id });
          if (result?.confirmed) {
            await enqueueListUpdate(charge.game_id).catch((e) => console.error("[whatsapp]", e));
            // avisa o jogador no WhatsApp que a vaga está garantida
            const { data: info } = await db
              .from("charges")
              .select("team_id, players(name, phone), games(date), teams(name)")
              .eq("id", charge.id).single();
            if (info) {
              const pl = info.players as unknown as { name: string; phone: string };
              const tm = info.teams as unknown as { name: string };
              const gm = info.games as unknown as { date: string } | null;
              await sendPaymentConfirmed(info.team_id, pl.phone, pl.name, tm.name, gm?.date ?? "")
                .catch((e) => console.error("[whatsapp] confirmação:", e));
            }
          }
          if (result?.pending_review) {
            await db.from("audit_logs").insert({
              actor_type: "webhook", action: "payment_after_full_list",
              entity: "charges", entity_id: charge.id,
              after: result,
            });
          }
        }

        // mensalidade
        if (charge.type === "subscription") {
          const { data: sub } = await db.from("charges").select("player_id, team_id, amount, due_date, players(name, phone), teams(name)").eq("id", charge.id).single();
          if (sub) {
            if (payload.event === "PAYMENT_RECEIVED" || payload.event === "PAYMENT_CONFIRMED") {
              await db.from("team_members")
                .update({ subscription_status: "active" })
                .eq("player_id", sub.player_id).eq("team_id", sub.team_id)
                .neq("subscription_status", "canceled");
              // confirma o pagamento ao mensalista (uma vez por cobrança)
              const { sendMembershipPaid, alreadyDispatched } = await import("@/lib/messaging");
              if (!(await alreadyDispatched(`sub_paid:${charge.id}`))) {
                const pl = sub.players as unknown as { name: string; phone: string };
                const tm = sub.teams as unknown as { name: string };
                await sendMembershipPaid({
                  teamId: sub.team_id, phone: pl.phone, playerName: pl.name, teamName: tm.name,
                  amount: Number(sub.amount), dueDate: sub.due_date, chargeId: charge.id,
                }).catch((e) => console.error("[whatsapp] mensalidade paga:", e));
              }
            }
            if (payload.event === "PAYMENT_OVERDUE") {
              await db.from("team_members")
                .update({ subscription_status: "overdue" })
                .eq("player_id", sub.player_id).eq("team_id", sub.team_id)
                .eq("subscription_status", "active");
            }
          }
        }
      }
    }

    await db.from("webhook_events").update({ status: "processed" }).eq("event_key", payload.id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("webhook processing failed", e);
    await db.from("webhook_events").update({ status: "failed", error: String(e) }).eq("event_key", payload.id);
    // 200 mesmo assim: o evento está persistido; reprocesso via conciliação
    return NextResponse.json({ ok: true, deferred: true });
  }
}
