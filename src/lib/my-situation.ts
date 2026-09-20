// "Minha situação" do jogador no link público: o que ele deve, o que já pagou,
// créditos e mensalidade — para não depender de aviso no WhatsApp.
import { supabaseAdmin } from "@/lib/supabase/server";

export interface SituationCharge {
  id: string; type: "subscription" | "dropin"; amount: number; status: string;
  dueDate: string | null; gameDate: string | null; teamName: string; paidAt: string | null;
  method: string | null; hasPix: boolean;
}
export interface Situation {
  isMember: boolean;
  subscriptionStatus: string | null;           // none | active | overdue | canceled | paused
  openCharges: SituationCharge[];              // pendentes/vencidas (todas as turmas, para o jogador ver tudo que deve)
  history: SituationCharge[];                  // últimas 8 cobranças desta turma
  credits: { amount: number; reason: string | null }[];
  totalDue: number;
}

export async function loadSituation(playerId: string, teamId: string): Promise<Situation> {
  const db = supabaseAdmin();
  const [{ data: member }, { data: open }, { data: hist }, { data: creds }] = await Promise.all([
    db.from("team_members").select("subscription_status").eq("team_id", teamId).eq("player_id", playerId).eq("status", "active").maybeSingle(),
    db.from("charges")
      .select("id, type, amount, status, due_date, paid_at, payment_method, pix_copypaste, asaas_payment_id, teams(name), games(date)")
      .eq("player_id", playerId).in("status", ["pending", "overdue"]).order("due_date", { ascending: true }).limit(20),
    db.from("charges")
      .select("id, type, amount, status, due_date, paid_at, payment_method, pix_copypaste, asaas_payment_id, teams(name), games(date)")
      .eq("player_id", playerId).eq("team_id", teamId).order("created_at", { ascending: false }).limit(8),
    db.from("credits").select("amount, reason").eq("player_id", playerId).eq("team_id", teamId).eq("status", "available"),
  ]);

  const map = (c: NonNullable<typeof open>[number]): SituationCharge => ({
    id: c.id, type: c.type as "subscription" | "dropin", amount: Number(c.amount), status: c.status,
    dueDate: c.due_date ?? null,
    gameDate: (c.games as unknown as { date: string } | null)?.date ?? null,
    teamName: (c.teams as unknown as { name: string } | null)?.name ?? "",
    paidAt: c.paid_at ?? null, method: c.payment_method ?? null,
    hasPix: !!(c.pix_copypaste || c.asaas_payment_id),
  });

  // Pix de avulso pendente é da reserva atual (já mostrado na tela) — aqui só mensalidades
  // e cobranças de jogos já vencidas para o jogador enxergar o que ficou para trás.
  const openCharges = (open ?? []).map(map).filter((c) => c.type === "subscription" || c.status === "overdue");
  return {
    isMember: !!member,
    subscriptionStatus: member?.subscription_status ?? null,
    openCharges,
    history: (hist ?? []).map(map),
    credits: (creds ?? []).map((c) => ({ amount: Number(c.amount), reason: c.reason ?? null })),
    totalDue: openCharges.reduce((s, c) => s + c.amount, 0),
  };
}
