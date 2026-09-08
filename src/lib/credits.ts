// Consumo automático de créditos (jogo cancelado / pagamento sem vaga).
// Regra: 1 crédito cobre 1 jogo, desde que o valor do crédito seja
// suficiente para a taxa de avulso da turma. Consome sempre o mais antigo.
import { supabaseAdmin } from "@/lib/supabase/server";

export interface AvailableCredit { id: string; amount: number }

/** Existe crédito disponível que cubra a taxa? (só leitura) */
export async function peekCredit(playerId: string, teamId: string, fee: number): Promise<AvailableCredit | null> {
  const db = supabaseAdmin();
  const { data } = await db
    .from("credits")
    .select("id, amount")
    .eq("player_id", playerId)
    .eq("team_id", teamId)
    .eq("status", "available")
    .gte("amount", fee)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  return data ?? null;
}

/**
 * Concede crédito a partir de uma cobrança paga (desistência no prazo,
 * jogo cancelado...). Idempotente: uma cobrança gera no máximo um crédito.
 */
export async function grantCreditForCharge(opts: {
  playerId: string; teamId: string; amount: number; chargeId: string; reason: string; createdBy?: string | null;
  /** false = desistência após o prazo: vale como crédito, mas não pode virar dinheiro */
  refundable?: boolean;
}): Promise<{ id: string; created: boolean }> {
  const db = supabaseAdmin();
  const { data: existing } = await db.from("credits").select("id").eq("origin_charge_id", opts.chargeId).neq("status", "revoked").limit(1).maybeSingle();
  if (existing) return { id: existing.id, created: false };
  const { data, error } = await db.from("credits").insert({
    player_id: opts.playerId, team_id: opts.teamId, amount: opts.amount,
    origin_charge_id: opts.chargeId, reason: opts.reason, created_by: opts.createdBy ?? null,
    refundable: opts.refundable ?? true,
  }).select("id").single();
  if (error || !data) throw new Error(error?.message ?? "falha ao criar crédito");
  return { id: data.id, created: true };
}

/** Estornou em dinheiro? O crédito daquela cobrança deixa de valer. */
export async function revokeCreditsForCharge(chargeId: string) {
  const db = supabaseAdmin();
  await db.from("credits")
    .update({ status: "revoked", updated_at: new Date().toISOString() })
    .eq("origin_charge_id", chargeId).eq("status", "available");
}

/**
 * Tenta consumir o crédito (claim otimista — seguro contra corrida).
 * Devolve o crédito consumido ou null se alguém levou antes.
 */
export async function claimCredit(creditId: string, gameId: string): Promise<boolean> {
  const db = supabaseAdmin();
  const { data } = await db
    .from("credits")
    .update({ status: "used", used_game_id: gameId, used_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", creditId)
    .eq("status", "available")
    .select("id")
    .maybeSingle();
  return !!data;
}
