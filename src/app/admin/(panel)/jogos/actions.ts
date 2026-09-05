"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin, auditAdmin } from "@/lib/admin";
import { supabaseAdmin } from "@/lib/supabase/server";
import { buildListMessage, enqueueListUpdate, enqueueListOpened, enqueueGroupMessage, sendGroupDirect } from "@/lib/messaging";
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

/**
 * Devolve um jogo fechado (ou aberto em teste) ao status "Agendado",
 * recalculando o horário de abertura pela regra da turma. Assim o robô
 * volta a cuidar dele: abre a lista e dispara no grupo na hora certa.
 * As confirmações já registradas são preservadas.
 */
export async function backToScheduled(gameId: string) {
  const admin = await requireAdmin();
  const db = supabaseAdmin();
  const { data: g } = await db.from("games")
    .select("id, status, date, time, teams(open_hours_before)")
    .eq("id", gameId).maybeSingle();
  if (!g) return { error: "Jogo não encontrado." };
  if (!["closed", "open"].includes(g.status)) return { error: "Só listas abertas ou fechadas podem voltar para Agendado." };

  const team = g.teams as unknown as { open_hours_before: number };
  const gameStart = new Date(`${g.date}T${g.time}-03:00`);
  if (gameStart <= new Date()) return { error: "O horário deste jogo já passou — não faz sentido voltar para Agendado." };

  const opensAt = new Date(gameStart.getTime() - (team?.open_hours_before ?? 48) * 3600_000);
  await db.from("games").update({ status: "scheduled", opens_at: opensAt.toISOString() }).eq("id", gameId);
  await auditAdmin(admin.id, "back_to_scheduled", "games", gameId, { opensAt: opensAt.toISOString() });
  revalidatePath(`/admin/jogos/${gameId}`);

  if (opensAt <= new Date()) {
    return { ok: true, note: "O horário de abertura já passou — o robô vai reabrir a lista e avisar o grupo em até 1 minuto." };
  }
  return { ok: true, note: `Agendado! A lista abre automaticamente em ${opensAt.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })} e o grupo será avisado.` };
}

/**
 * Restaura um jogo cancelado por engano, voltando ao estado natural:
 * se a abertura ainda não chegou → agendado; senão → lista aberta
 * (mensalistas reconvidados e prazos estendidos se necessário).
 */
export async function restoreGame(gameId: string) {
  const admin = await requireAdmin();
  const db = supabaseAdmin();
  const { data: g } = await db.from("games").select("id, status, opens_at").eq("id", gameId).maybeSingle();
  if (!g) return { error: "Jogo não encontrado." };
  if (g.status !== "canceled") return { error: "Este jogo não está cancelado." };

  if (new Date(g.opens_at) > new Date()) {
    await db.from("games").update({ status: "scheduled", cancel_reason: null }).eq("id", gameId);
    await auditAdmin(admin.id, "restore_game", "games", gameId, { to: "scheduled" });
    revalidatePath(`/admin/jogos/${gameId}`);
    return { ok: true, restoredTo: "scheduled" };
  }

  // abertura já passou: volta como agendado e reabre pela rotina normal
  await db.from("games").update({ status: "scheduled", cancel_reason: null }).eq("id", gameId);
  await auditAdmin(admin.id, "restore_game", "games", gameId, { to: "open" });
  await toggleList(gameId, true);
  return { ok: true, restoredTo: "open" };
}

/** Salva a divisão de times escolhida, vinculada ao jogo. */
export async function saveTeamsSplit(gameId: string, teamsPlayerIds: string[][]) {
  const admin = await requireAdmin();
  if (!Array.isArray(teamsPlayerIds)) return { error: "Divisão inválida." };
  const db = supabaseAdmin();
  const { error } = await db.from("games").update({
    teams_split: { teams: teamsPlayerIds, saved_at: new Date().toISOString() },
  }).eq("id", gameId);
  if (error) return { error: "Erro ao salvar a divisão." };
  await auditAdmin(admin.id, "save_teams_split", "games", gameId, { sizes: teamsPlayerIds.map((t) => t.length) });
  return { ok: true };
}

export async function sendListNow(gameId: string) {
  await requireAdmin();
  const db = supabaseAdmin();
  const built = await buildListMessage(gameId);
  if (!built?.team.whatsapp_group_id) return { error: "Turma sem grupo do WhatsApp configurado. Configure na turma o ID no formato 1203...@g.us." };
  const sent = await sendGroupDirect(built.team.id, built.team.whatsapp_group_id, built.body, gameId);
  if (!sent.ok) return { error: "O WhatsApp recusou o envio: " + sent.error };
  return { ok: true };
}

/**
 * Reseta a lista do jogo: remove todas as participações e recomeça do zero.
 * - Cobranças Pix pendentes são canceladas no Asaas.
 * - Cobranças já pagas são preservadas no Financeiro e sinalizadas para
 *   decisão do admin (crédito/estorno) via auditoria.
 * - Se a lista estiver aberta, os mensalistas voltam como "aguardando resposta".
 */
export async function resetGame(gameId: string) {
  const admin = await requireAdmin();
  const db = supabaseAdmin();

  const { data: game } = await db.from("games").select("id, status, team_id").eq("id", gameId).maybeSingle();
  if (!game) return { error: "Jogo não encontrado." };

  // 1. cancela cobranças pendentes deste jogo no Asaas
  const { data: charges } = await db.from("charges")
    .select("id, asaas_payment_id, status").eq("game_id", gameId);
  let canceled = 0, paidKept = 0;
  for (const c of charges ?? []) {
    if (c.status === "pending") {
      if (c.asaas_payment_id) await Asaas.cancelPayment(c.asaas_payment_id).catch(() => {});
      await db.from("charges").update({ status: "canceled" }).eq("id", c.id);
      canceled++;
    } else if (["received", "confirmed"].includes(c.status)) {
      paidKept++; // fica registrada no Financeiro para decisão de crédito/estorno
    }
  }

  // 2. zera as participações
  const { count: removedCount } = await db.from("game_participants")
    .select("id", { count: "exact", head: true }).eq("game_id", gameId);
  await db.from("game_participants").delete().eq("game_id", gameId);

  // 3. lista aberta: mensalistas voltam como convidados
  if (game.status === "open") {
    const { data: members } = await db.from("team_members")
      .select("player_id").eq("team_id", game.team_id).eq("status", "active");
    for (const m of members ?? []) {
      await db.from("game_participants").insert({
        game_id: gameId, player_id: m.player_id, kind: "member", status: "invited", source: "system",
      });
    }
  }

  await auditAdmin(admin.id, "reset_game", "games", gameId, {
    removed: removedCount ?? 0, chargesCanceled: canceled, paidKept,
  });

  // 4. avisa o grupo com a lista zerada
  const built = await buildListMessage(gameId);
  if (built?.team.whatsapp_group_id) {
    await enqueueGroupMessage(
      built.team.id, built.team.whatsapp_group_id,
      `🔄 *A lista deste jogo foi reiniciada pelo organizador.*\nConfirme sua presença novamente.\n\n${built.body}`,
      gameId
    ).catch(() => {});
  }

  revalidatePath(`/admin/jogos/${gameId}`);
  return { ok: true, removed: removedCount ?? 0, chargesCanceled: canceled, paidKept };
}

/**
 * Envia a divisão de times ao grupo — somente nomes, nunca as estrelas.
 * Os nomes são recarregados do banco a partir dos ids (fonte confiável).
 */
export async function sendTeamsToGroup(gameId: string, teamsPlayerIds: string[][]) {
  const admin = await requireAdmin();
  if (!Array.isArray(teamsPlayerIds) || teamsPlayerIds.length === 0) return { error: "Divida os times primeiro." };

  const db = supabaseAdmin();
  const { data: game } = await db
    .from("games")
    .select("id, date, teams(id, name, whatsapp_group_id)")
    .eq("id", gameId).maybeSingle();
  if (!game) return { error: "Jogo não encontrado." };
  const team = game.teams as unknown as { id: string; name: string; whatsapp_group_id: string | null };
  if (!team.whatsapp_group_id) return { error: "Turma sem grupo do WhatsApp configurado." };

  const allIds = teamsPlayerIds.flat().slice(0, 200);
  const { data: players } = await db.from("players").select("id, name").in("id", allIds);
  const nameById = new Map((players ?? []).map((p) => [p.id, p.name]));

  const { teamsMessage } = await import("@/lib/balance");
  const teamsWithNames = teamsPlayerIds.map((ids) => ({
    players: ids.map((id) => ({ name: nameById.get(id) ?? "?" })).filter((p) => p.name !== "?"),
  }));
  const body = teamsMessage(team.name, game.date, teamsWithNames);

  const sent = await sendGroupDirect(team.id, team.whatsapp_group_id, body, gameId);
  if (!sent.ok) return { error: "O WhatsApp recusou o envio: " + sent.error };
  await auditAdmin(admin.id, "send_teams", "games", gameId, { teams: teamsPlayerIds.map((t) => t.length) });
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
