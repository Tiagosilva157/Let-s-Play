// Ações do jogador no link público: confirmar, recusar, desistir, reservar (avulso).
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/server";
import { getSessionPlayer } from "@/lib/session";
import { Asaas } from "@/lib/asaas";
import { ensureAsaasCustomer, normalizeCpfCnpj, MissingCustomerDataError } from "@/lib/asaas-customer";
import { enqueueListUpdate, sendPixToPlayer, enqueueIndividual } from "@/lib/messaging";
import { peekCredit, claimCredit, grantCreditForCharge } from "@/lib/credits";
import { processPromotions } from "@/lib/waitlist";

const Body = z.object({
  gameId: z.string().uuid(),
  action: z.enum(["confirm", "decline", "withdraw", "reserve"]),
  // dados exigidos pelo Asaas, coletados no link público quando faltarem
  cpf: z.string().max(20).optional(),
  email: z.string().max(120).optional(),
});

export async function POST(req: NextRequest) {
  const player = await getSessionPlayer();
  if (!player) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  const { gameId, action } = parsed.data;

  const db = supabaseAdmin();

  const { data: game } = await db
    .from("games")
    .select("id, team_id, date, time, teams(dropin_fee, name, reservation_minutes)")
    .eq("id", gameId)
    .single();
  if (!game) return NextResponse.json({ error: "game_not_found" }, { status: 404 });

  const { data: membership } = await db
    .from("team_members")
    .select("id")
    .eq("team_id", game.team_id)
    .eq("player_id", player.id)
    .eq("status", "active")
    .maybeSingle();
  const isMember = !!membership;

  let result: { ok: boolean; error?: string; [k: string]: unknown };

  if (action === "confirm" && isMember) {
    const { data } = await db.rpc("fn_confirm_member", { p_game_id: gameId, p_player_id: player.id });
    result = data;
  } else if (action === "decline" && isMember) {
    const { data } = await db.rpc("fn_decline_member", { p_game_id: gameId, p_player_id: player.id });
    result = data;
  } else if (action === "withdraw" && !isMember) {
    const { data } = await db.rpc("fn_withdraw_dropin", { p_game_id: gameId, p_player_id: player.id });
    result = data;
    if (result?.ok && result.was_reserved) {
      const { data: charge } = await db
        .from("charges")
        .select("id, asaas_payment_id")
        .eq("game_id", gameId).eq("player_id", player.id).eq("status", "pending")
        .maybeSingle();
      if (charge?.asaas_payment_id) {
        await Asaas.cancelPayment(charge.asaas_payment_id).catch(() => {});
        await db.from("charges").update({ status: "canceled" }).eq("id", charge.id);
      }
    } else if (result?.ok) {
      // desistiu DENTRO do prazo já tendo pago: o valor vira crédito na hora,
      // usado automaticamente na próxima vaga (e o admin ainda pode estornar)
      const { data: paid } = await db
        .from("charges")
        .select("id, amount")
        .eq("game_id", gameId).eq("player_id", player.id)
        .in("status", ["received", "confirmed"])
        .order("created_at", { ascending: false })
        .limit(1).maybeSingle();
      if (paid) {
        const teamInfo = game.teams as unknown as { name: string };
        const { data: pl } = await db.from("players").select("name, phone").eq("id", player.id).single();
        const late = result.late === true; // depois do prazo: crédito sim, dinheiro não
        const dateBR = game.date.split("-").reverse().join("/");
        const amountBR = `R$ ${Number(paid.amount).toFixed(2).replace(".", ",")}`;
        try {
          const credit = await grantCreditForCharge({
            playerId: player.id, teamId: game.team_id, amount: Number(paid.amount), chargeId: paid.id,
            reason: late ? `Desistência APÓS o prazo — jogo ${dateBR}` : `Desistência dentro do prazo — jogo ${dateBR}`,
            refundable: !late,
          });
          result.credit_granted = true;
          result.credit_amount = Number(paid.amount);
          result.credit_late = late;
          if (credit.created && pl) {
            await enqueueIndividual(game.team_id, pl.phone, [
              `✅ ${pl.name.split(" ")[0]}, sua desistência do *${teamInfo.name}* de ${dateBR} foi registrada${late ? " (após o prazo)" : ""}.`,
              ``,
              late
                ? `Como o prazo de desistência já tinha passado, os *${amountBR}* pagos viram *crédito* (sem devolução em dinheiro): na próxima vez que garantir vaga, a presença é confirmada sem pagar de novo. 🎫`
                : `Os *${amountBR}* que você pagou viraram *crédito*: na próxima vez que garantir vaga, a presença é confirmada sem pagar de novo. 🎫`,
            ].join("\n")).catch(() => {});
          }
        } catch (e) {
          console.error("[credit] desistência no prazo:", String(e).slice(0, 150));
        }
      }
    }
  } else if (action === "reserve" && !isMember) {
    // 1. o Asaas exige CPF; pedimos ao jogador antes de segurar a vaga
    const { data: p } = await db
      .from("players")
      .select("id, name, phone, email, cpf_cnpj, asaas_customer_id")
      .eq("id", player.id).single();

    const cpfInput = normalizeCpfCnpj(parsed.data.cpf);
    const emailInput = parsed.data.email?.trim();
    if (cpfInput || emailInput) {
      await db.from("players").update({
        ...(cpfInput ? { cpf_cnpj: cpfInput } : {}),
        ...(emailInput ? { email: emailInput } : {}),
      }).eq("id", player.id);
      if (cpfInput) p!.cpf_cnpj = cpfInput;
      if (emailInput) p!.email = emailInput;
    }
    const team = game.teams as unknown as { dropin_fee: number; name: string; reservation_minutes: number };

    // crédito disponível cobre a taxa? então nem precisamos de CPF/Pix
    const credit = await peekCredit(player.id, game.team_id, Number(team.dropin_fee));

    if (!credit && !normalizeCpfCnpj(p!.cpf_cnpj)) {
      return NextResponse.json({ error: "needs_billing_data", needs: ["cpf", "email"] }, { status: 200 });
    }

    // 2. só então reservamos a vaga
    const { data } = await db.rpc("fn_reserve_dropin", { p_game_id: gameId, p_player_id: player.id });
    result = data;

    // 2b. com crédito: confirma direto, sem Pix — consome o crédito
    if (result?.ok && !result.already_reserved && credit && (await claimCredit(credit.id, gameId))) {
      await db.from("game_participants")
        .update({ status: "confirmed", confirmed_at: new Date().toISOString(), source: "system" })
        .eq("id", result.participant_id as string);
      await db.from("audit_logs").insert({
        actor_type: "player", actor_id: player.id, action: "reserve_with_credit",
        entity: "credits", entity_id: credit.id, after: { gameId, amount: credit.amount },
      });
      await enqueueIndividual(game.team_id, p!.phone, [
        `🎫 ${p!.name.split(" ")[0]}, sua vaga no *${team.name}* de ${game.date.split("-").reverse().join("/")} foi garantida usando seu crédito de R$ ${Number(credit.amount).toFixed(2).replace(".", ",")}.`,
        ``,
        `Nada a pagar — presença confirmada! ✅`,
      ].join("\n")).catch(() => {});
      await enqueueListUpdate(gameId).catch(() => {});
      return NextResponse.json({ ok: true, credit_used: true, amount: credit.amount });
    }

    if (result?.ok && !result.already_reserved) {
      try {
        const customerId = await ensureAsaasCustomer(p!);
        const payment = await Asaas.createPixPayment({
          customer: customerId,
          value: Number(team.dropin_fee),
          dueDate: new Date().toISOString().slice(0, 10),
          description: `${team.name} — jogo ${game.date}`,
          externalReference: `${gameId}:${player.id}`,
        });
        const qr = await Asaas.getPixQr(payment.id);
        const { data: charge } = await db
          .from("charges")
          .insert({
            player_id: player.id, team_id: game.team_id, game_id: gameId,
            type: "dropin", asaas_payment_id: payment.id, amount: team.dropin_fee,
            status: "pending", pix_qr: qr.encodedImage, pix_copypaste: qr.payload,
            expires_at: result.reserved_until,
          })
          .select("id").single();
        await db.from("game_participants").update({ charge_id: charge!.id }).eq("id", result.participant_id as string);
        result.pix = { qr: qr.encodedImage, copypaste: qr.payload, amount: team.dropin_fee };

        // 3. manda o Pix também no WhatsApp do jogador
        await sendPixToPlayer({
          teamId: game.team_id, phone: p!.phone, playerName: p!.name, teamName: team.name,
          date: game.date, time: String(game.time), amount: Number(team.dropin_fee),
          copypaste: qr.payload, minutes: team.reservation_minutes ?? 15,
        }).catch((e) => console.error("[whatsapp] pix individual:", e));
      } catch (e) {
        console.error("Asaas charge failed", e);
        // libera a vaga para não travar a lista sem meio de pagamento
        await db.rpc("fn_withdraw_dropin", { p_game_id: gameId, p_player_id: player.id, p_source: "system" });
        if (e instanceof MissingCustomerDataError) {
          return NextResponse.json({ error: "needs_billing_data", needs: ["cpf"] }, { status: 200 });
        }
        return NextResponse.json({ error: "payment_provider_error" }, { status: 502 });
      }
    } else if (result?.ok && result.already_reserved) {
      const { data: charge } = await db
        .from("charges")
        .select("pix_qr, pix_copypaste, amount")
        .eq("game_id", gameId).eq("player_id", player.id).eq("status", "pending")
        .maybeSingle();
      if (charge) result.pix = { qr: charge.pix_qr, copypaste: charge.pix_copypaste, amount: charge.amount };
    }
  } else {
    return NextResponse.json({ error: "action_not_allowed" }, { status: 403 });
  }

  if (result?.ok) {
    await db.from("audit_logs").insert({
      actor_type: "player", actor_id: player.id, action,
      entity: "game_participants", entity_id: gameId,
      after: result as unknown as Record<string, unknown>,
    });
    // desistência/recusa pode ter promovido alguém da fila → Pix + avisos
    const promoted = (result.promoted ?? []) as string[];
    if (promoted.length) {
      await processPromotions(gameId, promoted).catch((e) => console.error("[waitlist]", e));
    } else if (action !== "reserve") {
      await enqueueListUpdate(gameId).catch((e) => console.error("[whatsapp]", e));
    }
  }

  return NextResponse.json(result ?? { ok: false, error: "unknown" });
}
