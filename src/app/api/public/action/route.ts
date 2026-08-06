// Ações do jogador no link público: confirmar, recusar, desistir, reservar (avulso).
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/server";
import { getSessionPlayer } from "@/lib/session";
import { Asaas } from "@/lib/asaas";
import { enqueueListUpdate } from "@/lib/messaging";

const Body = z.object({
  gameId: z.string().uuid(),
  action: z.enum(["confirm", "decline", "withdraw", "reserve"]),
});

export async function POST(req: NextRequest) {
  const player = await getSessionPlayer();
  if (!player) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  const { gameId, action } = parsed.data;

  const db = supabaseAdmin();

  // é mensalista neste jogo?
  const { data: game } = await db.from("games").select("id, team_id, date, teams(dropin_fee, name)").eq("id", gameId).single();
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
    // reserva desfeita → cancela cobrança pendente
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
    const { data } = await db.rpc("fn_reserve_dropin", { p_game_id: gameId, p_player_id: player.id });
    result = data;
    if (result?.ok && !result.already_reserved) {
      // cria cobrança Pix
      try {
        const team = game.teams as unknown as { dropin_fee: number; name: string };
        let asaasCustomerId: string;
        const { data: p } = await db.from("players").select("asaas_customer_id, name, phone").eq("id", player.id).single();
        if (p?.asaas_customer_id) {
          asaasCustomerId = p.asaas_customer_id;
        } else {
          const customer = await Asaas.createCustomer({
            name: p!.name, mobilePhone: p!.phone, externalReference: player.id,
          });
          asaasCustomerId = customer.id;
          await db.from("players").update({ asaas_customer_id: customer.id }).eq("id", player.id);
        }
        const payment = await Asaas.createPixPayment({
          customer: asaasCustomerId,
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
      } catch (e) {
        console.error("Asaas charge failed", e);
        // desfaz reserva para não travar a vaga sem meio de pagamento
        await db.rpc("fn_withdraw_dropin", { p_game_id: gameId, p_player_id: player.id, p_source: "system" });
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
    if (action !== "reserve") await enqueueListUpdate(gameId).catch(() => {});
  }

  return NextResponse.json(result ?? { ok: false, error: "unknown" });
}
