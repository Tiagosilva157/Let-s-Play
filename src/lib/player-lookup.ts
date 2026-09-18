// Localiza o jogador pelo telefone (com/sem nono dígito) e corrige o formato antigo.
import { supabaseAdmin } from "@/lib/supabase/server";
import { phoneVariants } from "@/lib/phone";

export interface PlayerRow {
  id: string; name: string; phone: string; active: boolean;
  email: string | null; cpf_cnpj: string | null; password_hash: string | null;
}

export async function findPlayerByPhone(phone: string): Promise<PlayerRow | null> {
  const db = supabaseAdmin();
  const { data: matches } = await db.from("players")
    .select("id, name, phone, active, email, cpf_cnpj, password_hash").in("phone", phoneVariants(phone));
  const player = (matches ?? []).find((p) => p.phone === phone) ?? (matches ?? [])[0] ?? null;
  if (player && player.phone !== phone && phone.length === 13) {
    await db.from("players").update({ phone }).eq("id", player.id);
  }
  return player;
}

/** Quantas tentativas (falhas) de login nos últimos minutos — limite anti força-bruta. */
export async function recentFailures(phone: string, minutes = 15): Promise<number> {
  const db = supabaseAdmin();
  const since = new Date(Date.now() - minutes * 60_000).toISOString();
  const { count } = await db.from("auth_attempts").select("id", { count: "exact", head: true })
    .eq("phone", phone).eq("ok", false).gte("created_at", since);
  return count ?? 0;
}

export async function recordAttempt(phone: string, ok: boolean) {
  const db = supabaseAdmin();
  await db.from("auth_attempts").insert({ phone, ok });
}
