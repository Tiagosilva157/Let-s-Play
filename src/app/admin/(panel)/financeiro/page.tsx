import { requireAdmin } from "@/lib/admin";
import { supabaseAdmin } from "@/lib/supabase/server";
import CreditList from "./CreditList";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  pending: { label: "Pendente", cls: "badge-warn" },
  received: { label: "Recebido", cls: "badge-success" },
  confirmed: { label: "Confirmado", cls: "badge-success" },
  overdue: { label: "Vencido", cls: "badge-danger" },
  refunded: { label: "Estornado", cls: "badge-neutral" },
  canceled: { label: "Cancelado", cls: "badge-neutral" },
  expired: { label: "Expirado", cls: "badge-neutral" },
};

function refMonth(dueDate: string) {
  const m = new Date(`${dueDate}T12:00:00`).toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  return m.charAt(0).toUpperCase() + m.slice(1);
}

const TYPE_FILTERS: Record<string, { label: string; value: string }> = {
  "": { label: "Todas as cobranças", value: "" },
  subscription: { label: "Mensalidades", value: "subscription" },
  dropin: { label: "Avulsos", value: "dropin" },
};

export default async function FinancePage({ searchParams }: { searchParams: Promise<{ status?: string; type?: string }> }) {
  await requireAdmin();
  const { status, type } = await searchParams;
  const db = supabaseAdmin();

  let query = db
    .from("charges")
    .select("id, type, amount, status, due_date, created_at, players(name), teams(name), games(date)")
    .order("created_at", { ascending: false })
    .limit(100);
  if (status) query = query.eq("status", status);
  if (type && TYPE_FILTERS[type]) query = query.eq("type", type);
  const { data: charges } = await query;

  const { data: creditRows } = await db
    .from("credits")
    .select("id, amount, status, reason, refundable, created_at, players(name), teams(name), games:used_game_id(date), origin:origin_charge_id(asaas_payment_id, games(date))")
    .order("created_at", { ascending: false })
    .limit(100);
  const credits = (creditRows ?? []).map((c) => {
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
      // desistência após o prazo: crédito vale, mas não vira dinheiro
      refundable: !!origin?.asaas_payment_id && c.refundable !== false,
    };
  });

  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400_000).toISOString();
  const { data: recent } = await db
    .from("charges")
    .select("amount, status")
    .gte("created_at", thirtyDaysAgo);
  const receivedTotal = (recent ?? []).filter((c) => ["received", "confirmed"].includes(c.status)).reduce((s, c) => s + Number(c.amount), 0);
  const pendingTotal = (recent ?? []).filter((c) => ["pending", "overdue"].includes(c.status)).reduce((s, c) => s + Number(c.amount), 0);

  const filters = ["", "pending", "overdue", "received", "refunded"];

  // vagas pagas com crédito: entram na lista como linhas informativas, para o
  // jogo em que o crédito foi usado "fechar a conta" (o dinheiro entrou no jogo de origem)
  type Row =
    | { kind: "charge"; id: string; at: string; charge: NonNullable<typeof charges>[number] }
    | { kind: "credit_use"; id: string; at: string; playerName: string; teamName: string; amount: number; usedGameDate: string; originGameDate: string | null };
  const showCreditUses = (!type || type === "dropin") && (!status || status === "received");
  const { data: usedCredits } = showCreditUses
    ? await db.from("credits")
        .select("id, amount, used_at, players(name), teams(name), games:used_game_id(date), origin:origin_charge_id(games(date))")
        .eq("status", "used").not("used_game_id", "is", null)
        .order("used_at", { ascending: false }).limit(100)
    : { data: [] };
  const rows: Row[] = [
    ...(charges ?? []).map((c) => ({ kind: "charge" as const, id: c.id, at: c.created_at as string, charge: c })),
    ...(usedCredits ?? []).map((u) => ({
      kind: "credit_use" as const, id: "credit:" + u.id, at: (u.used_at as string) ?? "",
      playerName: (u.players as unknown as { name: string })?.name ?? "?",
      teamName: (u.teams as unknown as { name: string })?.name ?? "?",
      amount: Number(u.amount),
      usedGameDate: (u.games as unknown as { date: string })?.date ?? "",
      originGameDate: (u.origin as unknown as { games: { date: string } | null } | null)?.games?.date ?? null,
    })),
  ].sort((a, b) => b.at.localeCompare(a.at));
  const fmtDay = (d: string) => d ? new Date(`${d}T12:00:00`).toLocaleDateString("pt-BR") : "";

  // espelho do saldo no Asaas — se a consulta falhar, a página continua funcionando
  const { Asaas } = await import("@/lib/asaas");
  const { getAsaasConfig } = await import("@/lib/settings");
  const asaasEnv = (await getAsaasConfig()).env;
  const balance = await Asaas.getBalance().then((b) => Number(b.balance)).catch(() => null);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Financeiro</h1>

      <div className="card p-4">
        <p className="text-2xl font-bold text-[var(--brand)]">
          {balance == null ? "—" : `R$ ${balance.toFixed(2)}`}
        </p>
        <p className="text-sm text-[var(--ink-soft)]">
          Saldo Atual no Asaas{asaasEnv === "sandbox" ? " (sandbox)" : ""}
          {balance == null && " · indisponível agora (verifique a chave em Configurações)"}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="card p-4">
          <p className="text-2xl font-bold text-[var(--success)]">R$ {receivedTotal.toFixed(2)}</p>
          <p className="text-sm text-[var(--ink-soft)]">Recebido (30 dias)</p>
        </div>
        <div className="card p-4">
          <p className="text-2xl font-bold text-[var(--warn)]">R$ {pendingTotal.toFixed(2)}</p>
          <p className="text-sm text-[var(--ink-soft)]">Pendente/vencido (30 dias)</p>
        </div>
      </div>

      <div className="flex gap-1 overflow-x-auto">
        {Object.values(TYPE_FILTERS).map((t) => (
          <a key={t.value} href={`?${new URLSearchParams({ ...(status ? { status } : {}), ...(t.value ? { type: t.value } : {}) })}`}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium ${(type ?? "") === t.value ? "bg-[var(--brand)] text-white" : "text-[var(--ink-soft)]"}`}>
            {t.label}
          </a>
        ))}
      </div>

      <div className="flex gap-1 overflow-x-auto">
        {filters.map((f) => (
          <a key={f} href={`?${new URLSearchParams({ ...(f ? { status: f } : {}), ...(type ? { type } : {}) })}`}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium ${status === f || (!status && !f) ? "bg-[var(--brand)] text-white" : "text-[var(--ink-soft)]"}`}>
            {f ? STATUS_LABEL[f].label : "Todas"}
          </a>
        ))}
      </div>

      <div className="card divide-y divide-[var(--line)]">
        {rows.map((r) => {
          if (r.kind === "credit_use") {
            return (
              <div key={r.id} className="flex flex-col gap-1 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="font-medium">{r.playerName}</p>
                  <p className="text-sm text-[var(--ink-soft)]">
                    {r.teamName} · Avulso — {fmtDay(r.usedGameDate)} · pago com crédito{r.originGameDate ? ` do jogo de ${fmtDay(r.originGameDate)}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-semibold">R$ {r.amount.toFixed(2)}</span>
                  <span className="badge badge-neutral" title="Vaga paga com crédito — o dinheiro entrou no jogo de origem">🎫 Crédito</span>
                </div>
              </div>
            );
          }
          const c = r.charge;
          const st = STATUS_LABEL[c.status] ?? { label: c.status, cls: "badge-neutral" };
          return (
            <div key={c.id} className="flex flex-col gap-1 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="font-medium">{(c.players as unknown as { name: string })?.name}</p>
                <p className="text-sm text-[var(--ink-soft)]">
                  {(c.teams as unknown as { name: string })?.name} · {c.type === "dropin" ? `Avulso ${(c.games as unknown as { date: string })?.date ? "— " + fmtDay((c.games as unknown as { date: string }).date) : ""}` : `Mensalidade${c.due_date ? ` — ${refMonth(c.due_date)} · vence ${fmtDay(c.due_date)}` : ""}`}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="font-semibold">R$ {Number(c.amount).toFixed(2)}</span>
                <span className={`badge ${st.cls}`}>{st.label}</span>
              </div>
            </div>
          );
        })}
        {rows.length === 0 && <p className="p-4 text-sm text-[var(--ink-soft)]">Nenhuma cobrança.</p>}
      </div>

      <CreditList credits={credits} />
    </div>
  );
}
