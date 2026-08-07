// Ações do jogador no link público: confirmar, recusar, desistir, reservar (avulso).
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/server";
import { getSessionPlayer } from "@/lib/session";
import { Asaas } from "@/lib/asaas";
import { ensureAsaasCustomer, normalizeCpfCnpj, MissingCustomerDataError } from "@/lib/asaas-customer";
import { enqueueListUpdate, sendPixToPlayer } from "@/lib/messaging";

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
    if (!normalizeCpfCnpj(p!.cpf_cnpj)) {
      return NextResponse.json({ error: "needs_billing_data", needs: ["cpf", "email"] }, { status: 200 });
    }

    // 2. só então reservamos a vaga
    const { data } = await db.rpc("fn_reserve_dropin", { p_game_id: gameId, p_player_id: player.id });
    result = data;

    const team = game.teams as unknown as { dropin_fee: number; name: string; reservation_minutes: number };

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
    if (action !== "reserve") await enqueueListUpdate(gameId).catch((e) => console.error("[whatsapp]", e));
  }

  return NextResponse.json(result ?? { ok: false, error: "unknown" });
}
