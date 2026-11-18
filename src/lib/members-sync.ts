// Mantém as listas ABERTAS coerentes quando a turma muda de mensalistas.
//  - saiu da turma: convite sem resposta vira "Não vai" (vaga liberada, espera sobe);
//    quem já confirmou continua na lista (passa a aparecer como não mensalista)
//  - entrou na turma: recebe o convite na hora, com a vaga reservada, como os demais
// Jogos fechados/cancelados não são tocados; a próxima abertura já lê a turma nova.
import { supabaseAdmin } from "@/lib/supabase/server";
import { enqueueListUpdate } from "@/lib/messaging";
import { processPromotions } from "@/lib/waitlist";

async function openGames(teamId: string) {
  const db = supabaseAdmin();
  const { data } = await db.from("games").select("id, members_pay").eq("team_id", teamId).eq("status", "open");
  return data ?? [];
}

export async function onMembersRemoved(teamId: string, playerIds: string[]) {
  if (!playerIds.length) return;
  const db = supabaseAdmin();
  for (const g of await openGames(teamId)) {
    const { data: freed } = await db.from("game_participants")
      .update({ status: "declined", source: "admin" })
      .eq("game_id", g.id).in("player_id", playerIds).eq("status", "invited")
      .select("id");
    if (!freed?.length) continue;
    const { data: promo } = await db.rpc("fn_promote_waitlist", { p_game_id: g.id });
    const promoted = (promo?.promoted ?? []) as string[];
    if (promoted.length) await processPromotions(g.id, promoted).catch(() => {});
    else await enqueueListUpdate(g.id).catch(() => {});
  }
}

export async function onMembersAdded(teamId: string, playerIds: string[]) {
  if (!playerIds.length) return;
  const db = supabaseAdmin();
  for (const g of await openGames(teamId)) {
    if (g.members_pay) continue; // jogo em que todos pagam: ninguém é convidado
    const { data: existing } = await db.from("game_participants").select("player_id").eq("game_id", g.id).in("player_id", playerIds);
    const has = new Set((existing ?? []).map((r) => r.player_id));
    const rows = playerIds.filter((p) => !has.has(p)).map((p) => ({ game_id: g.id, player_id: p, kind: "member", status: "invited", source: "system" }));
    if (!rows.length) continue;
    await db.from("game_participants").insert(rows);
    await enqueueListUpdate(g.id).catch(() => {});
  }
}
