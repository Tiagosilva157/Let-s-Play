"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin, auditAdmin } from "@/lib/admin";
import { supabaseAdmin } from "@/lib/supabase/server";
import { buildListMessage, enqueueListUpdate, enqueueListOpened, enqueueGroupMessage } from "@/lib/messaging";
import { Asaas } from "@/lib/asaas";

export async function adminConfirm(gameId: string, playerId: string, kind: "member" | "dropin") {
  const admin = await requireAdmin();
  const db = supabaseAdmin();
  if (kind === "member") {
    await db.rpc("fn_confirm_member", { p_game_id: gameId, p_player_id: playerId, p_source: "admin" });
  } else {
    // admin pode confirmar avulso manualmente (ex.: pagou em dinheiro)
    await db.from("game_participants")
      .upsert({ game_id: gameId, player_id: playerId, kind: "dropin", status: "confirmed", source: "admin", confirmed_at: new Date().toISOString() }, { onConflict: "game_id,player_id" });
  }
  await auditAdmin(admin.id, "admin_confirm", "game_participants", `${gameId}:${playerId}`);
  await enqueueListUpdate(gameId).catch(() => {});
  revalidatePath(`/admin/jogos/${gameId}`);
}

export async function adminRemove(gameId: string, playerId: string) {
  const admin = await requireAdmin();
  const db = supabaseAdmin();
  await db.from("game_participants").update({ status: "removed", source: "admin" })
    .eq("game_id", gameId).eq("player_id", playerId);
  const { data: promo } = await db.rpc("fn_promote_waitlist", { p_game_id: gameId });
  await auditAdmin(admin.id, "admin_remove", "game_participants", `${gameId}:${playerId}`);
  const promoted = (promo?.promoted ?? []) as string[];
  if (promoted.length) {
    const { processPromotions } = await import("@/lib/waitlist");
    await processPromotions(gameId, promoted).catch(() => {});
  } else {
    await enqueueListUpdate(gameId).catch(() => {});
  }
  revalidatePath(`/admin/jogos/${gameId}`);
}

export async function cancelGame(gameId: string, reason: string) {
  const admin = await requireAdmin();
  const db = supabaseAdmin();
  await db.from("games").update({ status: "canceled", cancel_reason: reason || null }).eq("id", gameId);
  await auditAdmin(admin.id, "cancel_game", "games", gameId, { reason });

  // avulsos pagos ficam em pending_review para decisão de crédito/estorno
  await db.from("game_participants").update({ status: "pending_review" })
    .eq("game_id", gameId).eq("kind", "dropin").eq("status", "confirmed");

  const built = await buildListMessage(gameId);
  if (built?.team.whatsapp_group_id) {
    await enqueueGroupMessage(
      built.team.id,
      built.team.whatsapp_group_id,
      `🚫 *Jogo cancelado*${reason ? ` — ${reason}` : ""}\nQuem já pagou será atendido pelo organizador (crédito ou estorno).`,
      gameId
    ).catch((e) => console.error("[whatsapp] cancelamento:", e));
  }
  revalidatePath(`/admin/jogos/${gameId}`);
}

export async function toggleList(gameId: string, open: boolean) {
  const admin = await requireAdmin();
  const db = supabaseAdmin();
  if (open) {
    // reabertura com prazo vencido: estende confirmação/desistência até o horário do jogo,
    // senão o cron fecharia a lista de novo no minuto seguinte
    const { data: gameRow } = await db.from("games").select("date, time, confirm_until, withdraw_until").eq("id", gameId).single();
    const updates: Record<string, string> = { status: "open", opens_at: new Date().toISOString() };
    if (gameRow) {
      const gameStart = new Date(`${gameRow.date}T${gameRow.time}-03:00`).toISOString();
      if (new Date(gameRow.confirm_until) < new Date()) updates.confirm_until = gameStart;
      if (new Date(gameRow.withdraw_until) < new Date()) updates.withdraw_until = gameStart;
    }
    await db.from("games").update(updates).eq("id", gameId);
    // garante invited dos mensalistas
    const { data: g } = await db.from("games").select("team_id").eq("id", gameId).single();
    if (g) {
      const { data: members } = await db.from("team_members").select("player_id").eq("team_id", g.team_id).eq("status", "active");
      for (const m of members ?? []) {
        await db.from("game_participants")
          .upsert({ game_id: gameId, player_id: m.player_id, kind: "member", status: "invited", source: "system" }, { onConflict: "game_id,player_id", ignoreDuplicates: true });
      }
    }
  } else {
    await db.from("games").update({ status: "closed" }).eq("id", gameId);
  }
  await auditAdmin(admin.id, open ? "open_list" : "close_list", "games", gameId);
  // abrir a lista avisa o grupo (era um envio que faltava)
  if (open) await enqueueListOpened(gameId).catch((e) => console.error("[whatsapp] abertura:", e));
  revalidatePath(`/admin/jogos/${gameId}`);
}

export async function sendListNow(gameId: string) {
  await requireAdmin();
  const db = supabaseAdmin();
  const built = await buildListMessage(gameId);
  if (!built?.team.whatsapp_group_id) return { error: "Turma sem grupo do WhatsApp configurado." };
  try {
    await enqueueGroupMessage(built.team.id, built.team.whatsapp_group_id, built.body, gameId);
  } catch (e) {
    return { error: "Falha ao enviar: " + String(e).slice(0, 160) };
  }
  return { ok: true };
}

export async function resolvePendingReview(participantId: string, decision: "credit" | "refund" | "keep") {
  const admin = await requireAdmin();
  const db = supabaseAdmin();
  const { data: part } = await db.from("game_participants")
    .select("id, game_id, player_id, charge_id, charges(id, amount, team_id, asaas_payment_id)")
    .eq("id", participantId).single();
  if (!part) return { error: "Participação não encontrada." };
  const charge = part.charges as unknown as { id: string; amount: number; team_id: string; asaas_payment_id: string | null } | null;

  if (decision === "credit" && charge) {
    await db.from("credits").insert({
      player_id: part.player_id, team_id: charge.team_id, amount: charge.amount,
      origin_charge_id: charge.id, reason: "Pagamento sem vaga / jogo cancelado", created_by: admin.id,
    });
  }
  if (decision === "refund" && charge?.asaas_payment_id) {
    try { await Asaas.refundPayment(charge.asaas_payment_id); } catch { return { error: "Falha ao estornar no Asaas." }; }
    await db.from("charges").update({ status: "refunded" }).eq("id", charge.id);
  }
  await db.from("game_participants").update({ status: "removed" }).eq("id", participantId);
  await auditAdmin(admin.id, `resolve_pending_${decision}`, "game_participants", participantId);
  revalidatePath(`/admin/jogos/${part.game_id}`);
  return { ok: true };
}
