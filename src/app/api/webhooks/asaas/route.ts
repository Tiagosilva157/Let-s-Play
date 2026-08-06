// Webhook Asaas — idempotente, validado por authToken.
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { enqueueListUpdate } from "@/lib/messaging";
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

    // mensalidade gerada pela assinatura → cria cobrança local
    if (payload.event === "PAYMENT_CREATED" && asaasPaymentId && payload.payment?.subscription) {
      const { data: member } = await db
        .from("team_members")
        .select("player_id, team_id")
        .eq("asaas_subscription_id", payload.payment.subscription)
        .maybeSingle();
      if (member) {
        await db.from("charges").upsert({
          player_id: member.player_id,
          team_id: member.team_id,
          type: "subscription",
          asaas_payment_id: asaasPaymentId,
          amount: payload.payment.value,
          status: "pending",
          due_date: payload.payment.dueDate ?? null,
        }, { onConflict: "asaas_payment_id", ignoreDuplicates: true });
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
          await db.from("charges").update({ status: newStatus }).eq("id", charge.id);
        }
        await db.from("payment_events").insert({
          charge_id: charge.id, asaas_event: payload.event, payload,
        });

        // pagamento de avulso confirmado → confirma vaga
        if ((payload.event === "PAYMENT_RECEIVED" || payload.event === "PAYMENT_CONFIRMED") && charge.type === "dropin" && charge.game_id) {
          const { data: result } = await db.rpc("fn_confirm_dropin_payment", { p_charge_id: charge.id });
          if (result?.confirmed) await enqueueListUpdate(charge.game_id).catch(() => {});
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
          const { data: sub } = await db.from("charges").select("player_id, team_id").eq("id", charge.id).single();
          if (sub) {
            if (payload.event === "PAYMENT_RECEIVED" || payload.event === "PAYMENT_CONFIRMED") {
              await db.from("team_members")
                .update({ subscription_status: "active" })
                .eq("player_id", sub.player_id).eq("team_id", sub.team_id)
                .neq("subscription_status", "canceled");
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
