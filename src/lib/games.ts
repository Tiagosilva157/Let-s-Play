// Jogo único (extra): fora da recorrência da turma. Usa o grupo e as regras de
// prazo da turma; data, horário, local, vagas e valor podem ser próprios.
// A lista abre pelo robô de 1 minuto (mesmo caminho dos jogos normais), que
// também anuncia no grupo.
import { supabaseAdmin } from "@/lib/supabase/server";

export interface OneOffInput {
  teamId: string; date: string; time: string; title?: string; address?: string;
  capacity?: number | null; fee?: number | null; membersPay: boolean; openNow: boolean;
}

export async function createOneOffGameCore(input: OneOffInput): Promise<{ ok: true; id: string } | { error: string }> {
  const db = supabaseAdmin();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date) || !/^\d{2}:\d{2}$/.test(input.time)) {
    return { error: "Informe data e horário." };
  }
  const { data: t } = await db.from("teams")
    .select("id, status, capacity, open_hours_before, confirm_hours_before, withdraw_hours_before")
    .eq("id", input.teamId).maybeSingle();
  if (!t || t.status !== "active") return { error: "Turma não encontrada ou inativa." };

  const start = new Date(`${input.date}T${input.time}:00-03:00`).getTime();
  const now = Date.now();
  if (!(start > now)) return { error: "O horário do jogo já passou." };
  if (input.capacity != null && !(input.capacity >= 2 && input.capacity <= 100)) return { error: "Vagas: entre 2 e 100." };
  if (input.fee != null && !(input.fee >= 0 && input.fee <= 1000)) return { error: "Valor inválido." };

  // prazos pelas regras da turma; o que já passou fica no horário do jogo
  const at = (hours: number) => start - hours * 3600e3;
  const confirmUntil = Math.max(at(t.confirm_hours_before), now + 60_000);
  const withdrawUntil = Math.max(at(t.withdraw_hours_before), now + 60_000);
  const opensAt = input.openNow ? now : Math.min(at(t.open_hours_before), start);

  const { data: g, error } = await db.from("games").insert({
    team_id: t.id, date: input.date, time: input.time,
    title: input.title?.trim() || null,
    address_override: input.address?.trim() || null,
    capacity_override: input.capacity ?? null,
    dropin_fee_override: input.fee ?? null,
    members_pay: input.membersPay,
    opens_at: new Date(opensAt).toISOString(),
    confirm_until: new Date(Math.min(confirmUntil, start)).toISOString(),
    withdraw_until: new Date(Math.min(withdrawUntil, start)).toISOString(),
    status: "scheduled", generated: false,
  }).select("id").single();
  if (error || !g) return { error: "Não foi possível criar o jogo: " + (error?.message ?? "") };

  return { ok: true, id: g.id };
}
