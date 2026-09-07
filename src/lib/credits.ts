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
