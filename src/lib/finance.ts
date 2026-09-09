// Consulta do Financeiro — usada pela tela e pela exportação em Excel,
// para o arquivo exportado ser exatamente o que está na tela.
import { supabaseAdmin } from "@/lib/supabase/server";

export interface FinanceFilters {
  type?: string;   // subscription | dropin
  status?: string; // pending | overdue | received | refunded ...
  from?: string;   // AAAA-MM-DD (data da cobrança)
  to?: string;
  q?: string;      // nome do jogador
  team?: string;   // id da turma
}

export type FinanceRow =
  | {
      kind: "charge"; id: string; at: string;
      playerName: string; teamName: string; type: string; status: string; amount: number;
      gameDate: string | null; dueDate: string | null; asaasPaymentId: string | null;
    }
  | {
      kind: "credit_use"; id: string; at: string;
      playerName: string; teamName: string; amount: number;
      usedGameDate: string; originGameDate: string | null;
    };

export interface CreditRow {
  id: string; playerName: string; teamName: string; amount: number;
  status: string; reason: string; createdAt: string; usedGameDate: string | null;
  originGameDate: string | null; refundable: boolean;
}

export const STATUS_LABEL: Record<string, string> = {
  pending: "Pendente", received: "Recebido", confirmed: "Confirmado", overdue: "Vencido",
  refunded: "Estornado", canceled: "Cancelado", expired: "Expirado",
};
export const CREDIT_LABEL: Record<string, string> = { available: "Disponível", used: "Usado", revoked: "Revogado" };

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export async function loadTeams() {
  const db = supabaseAdmin();
  const { data } = await db.from("teams").select("id, name").order("name");
  return data ?? [];
}

export async function loadFinanceRows(f: FinanceFilters): Promise<FinanceRow[]> {
  const db = supabaseAdmin();
  let query = db
    .from("charges")
    .select("id, type, amount, status, due_date, created_at, asaas_payment_id, team_id, players(name), teams(name), games(date)")
    .order("created_at", { ascending: false })
    .limit(1000);
  if (f.status) query = query.eq("status", f.status);
  if (f.type === "subscription" || f.type === "dropin") query = query.eq("type", f.type);
  if (f.team) query = query.eq("team_id", f.team);
  if (f.from) query = query.gte("created_at", `${f.from}T00:00:00-03:00`);
  if (f.to) query = query.lte("created_at", `${f.to}T23:59:59-03:00`);
  const { data: charges } = await query;

  // vagas pagas com crédito (linhas informativas — o dinheiro entrou no jogo de origem)
  const showCreditUses = (!f.type || f.type === "dropin") && (!f.status || f.status === "received");
  let usedCredits: unknown[] = [];
  if (showCreditUses) {
    let cq = db.from("credits")
      .select("id, amount, used_at, team_id, players(name), teams(name), games:used_game_id(date), origin:origin_charge_id(games(date))")
      .eq("status", "used").not("used_game_id", "is", null)
      .order("used_at", { ascending: false }).limit(500);
    if (f.team) cq = cq.eq("team_id", f.team);
    if (f.from) cq = cq.gte("used_at", `${f.from}T00:00:00-03:00`);
    if (f.to) cq = cq.lte("used_at", `${f.to}T23:59:59-03:00`);
    usedCredits = (await cq).data ?? [];
  }

  const rows: FinanceRow[] = [
    ...(charges ?? []).map((c) => ({
      kind: "charge" as const, id: c.id, at: c.created_at as string,
      playerName: (c.players as unknown as { name: string })?.name ?? "?",
      teamName: (c.teams as unknown as { name: string })?.name ?? "?",
      type: c.type as string, status: c.status as string, amount: Number(c.amount),
      gameDate: (c.games as unknown as { date: string } | null)?.date ?? null,
      dueDate: (c.due_date as string | null) ?? null,
      asaasPaymentId: (c.asaas_payment_id as string | null) ?? null,
    })),
    ...(usedCredits as Array<Record<string, unknown>>).map((u) => ({
      kind: "credit_use" as const, id: "credit:" + u.id, at: (u.used_at as string) ?? "",
      playerName: (u.players as { name: string })?.name ?? "?",
      teamName: (u.teams as { name: string })?.name ?? "?",
      amount: Number(u.amount),
      usedGameDate: (u.games as { date: string })?.date ?? "",
      originGameDate: (u.origin as { games: { date: string } | null } | null)?.games?.date ?? null,
    })),
  ].sort((a, b) => b.at.localeCompare(a.at));

  const q = f.q ? norm(f.q.trim()) : "";
  return q ? rows.filter((r) => norm(r.playerName).includes(q)) : rows;
}

export async function loadCredits(opts: { only?: string; q?: string; team?: string }): Promise<CreditRow[]> {
  const db = supabaseAdmin();
  let query = db
    .from("credits")
    .select("id, amount, status, reason, refundable, created_at, team_id, players(name), teams(name), games:used_game_id(date), origin:origin_charge_id(asaas_payment_id, games(date))")
    .order("created_at", { ascending: false })
    .limit(500);
  if (opts.only === "available") query = query.eq("status", "available");
  if (opts.team) query = query.eq("team_id", opts.team);
  const { data } = await query;
  const q = opts.q ? norm(opts.q.trim()) : "";
  return (data ?? []).map((c) => {
    const origin = c.origin as unknown as { asaas_payment_id: string | null; games: { date: string } | null } | null;
    return {
      id: c.id,
      playerName: (c.players as unknown as { name: string })?.name ?? "?",
      teamName: (c.teams as unknown as { name: string })?.name ?? "?",
      amount: Number(c.amount),
      status: c.status,
      reason: c.reason ?? "",
      createdAt: c.created_at,
      usedGameDate: (c.games as unknown as { date: string } | null)?.date ?? null,
      originGameDate: origin?.games?.date ?? null,
      refundable: !!origin?.asaas_payment_id && c.refundable !== false,
    };
  }).filter((c) => !q || norm(c.playerName).includes(q));
}
