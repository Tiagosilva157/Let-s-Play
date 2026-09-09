import { requireAdmin } from "@/lib/admin";
import { supabaseAdmin } from "@/lib/supabase/server";
import { loadFinanceRows, loadCredits, loadTeams, STATUS_LABEL, METHOD_LABEL } from "@/lib/finance";
import CreditList from "./CreditList";
import ChargeActions from "./ChargeActions";

export const dynamic = "force-dynamic";

const STATUS_CLS: Record<string, string> = {
  pending: "badge-warn", received: "badge-success", confirmed: "badge-success", overdue: "badge-danger",
  refunded: "badge-neutral", canceled: "badge-neutral", expired: "badge-neutral",
};

const TYPE_FILTERS = [
  { label: "Todas as cobranças", value: "" },
  { label: "Mensalidades", value: "subscription" },
  { label: "Avulsos", value: "dropin" },
];
const STATUS_FILTERS = ["", "pending", "overdue", "received", "refunded"];

function refMonth(dueDate: string) {
  const m = new Date(`${dueDate}T12:00:00`).toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  return m.charAt(0).toUpperCase() + m.slice(1);
}
const fmtDay = (d: string | null | undefined) => d ? new Date(`${d}T12:00:00`).toLocaleDateString("pt-BR") : "";

type Params = { status?: string; type?: string; from?: string; to?: string; q?: string; team?: string };

/** Monta a query string preservando os filtros atuais, trocando só os informados. */
function qs(cur: Params, patch: Partial<Params>) {
  const merged: Record<string, string> = {};
  for (const [k, v] of Object.entries({ ...cur, ...patch })) if (v) merged[k] = v;
  const s = new URLSearchParams(merged).toString();
  return s ? `?${s}` : "?";
}

export default async function FinancePage({ searchParams }: { searchParams: Promise<Params> }) {
  await requireAdmin();
  const sp = await searchParams;
  const cur: Params = { status: sp.status, type: sp.type, from: sp.from, to: sp.to, q: sp.q, team: sp.team };
  const db = supabaseAdmin();

  const [rows, credits, teams] = await Promise.all([
    loadFinanceRows(cur),
    loadCredits({ team: cur.team }),
    loadTeams(),
  ]);

  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400_000).toISOString();
  const { data: recent } = await db.from("charges").select("amount, status").gte("created_at", thirtyDaysAgo);
  const receivedTotal = (recent ?? []).filter((c) => ["received", "confirmed"].includes(c.status)).reduce((s, c) => s + Number(c.amount), 0);
  const pendingTotal = (recent ?? []).filter((c) => ["pending", "overdue"].includes(c.status)).reduce((s, c) => s + Number(c.amount), 0);

  // espelho do saldo no Asaas — se a consulta falhar, a página continua funcionando
  const { Asaas } = await import("@/lib/asaas");
  const { getAsaasConfig } = await import("@/lib/settings");
  const asaasEnv = (await getAsaasConfig()).env;
  const balance = await Asaas.getBalance().then((b) => Number(b.balance)).catch(() => null);

  const filteredTotal = rows.reduce((s, r) => s + r.amount, 0);
  const hasFilter = !!(cur.status || cur.type || cur.from || cur.to || cur.q || cur.team);
  const exportHref = `/admin/financeiro/export${qs(cur, {})}${qs(cur, {}) === "?" ? "" : "&"}what=charges`;

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Financeiro</h1>

      <div className="card p-4">
        <p className="text-2xl font-bold text-[var(--brand)]">{balance == null ? "—" : `R$ ${balance.toFixed(2)}`}</p>
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

      {/* ---- filtros ---- */}
      <div className="card space-y-3 p-4">
        <div className="flex gap-1 overflow-x-auto">
          {TYPE_FILTERS.map((t) => (
            <a key={t.value} href={qs(cur, { type: t.value })}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium ${(cur.type ?? "") === t.value ? "bg-[var(--brand)] text-white" : "text-[var(--ink-soft)]"}`}>
              {t.label}
            </a>
          ))}
        </div>
        <div className="flex gap-1 overflow-x-auto">
          {STATUS_FILTERS.map((f) => (
            <a key={f} href={qs(cur, { status: f })}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium ${(cur.status ?? "") === f ? "bg-[var(--brand)] text-white" : "text-[var(--ink-soft)]"}`}>
              {f ? STATUS_LABEL[f] : "Todas"}
            </a>
          ))}
        </div>
        <form method="get" className="grid gap-2 sm:grid-cols-5">
          {cur.type && <input type="hidden" name="type" value={cur.type} />}
          {cur.status && <input type="hidden" name="status" value={cur.status} />}
          <input name="q" className="input sm:col-span-2" placeholder="🔍 Nome do jogador" defaultValue={cur.q ?? ""} />
          <select name="team" className="input" defaultValue={cur.team ?? ""}>
            <option value="">Todas as turmas</option>
            {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <input name="from" type="date" className="input" defaultValue={cur.from ?? ""} title="De" />
          <input name="to" type="date" className="input" defaultValue={cur.to ?? ""} title="Até" />
          <div className="flex flex-wrap gap-2 sm:col-span-5">
            <button className="btn btn-primary btn-sm">Filtrar</button>
            {hasFilter && <a href="/admin/financeiro" className="btn btn-outline btn-sm">Limpar filtros</a>}
            <a href={exportHref} className="btn btn-outline btn-sm" title="Baixa em Excel exatamente o que está listado abaixo">
              📥 Exportar Excel ({rows.length})
            </a>
          </div>
        </form>
        <p className="text-xs text-[var(--ink-soft)]">
          {rows.length} {rows.length === 1 ? "linha" : "linhas"} · total R$ {filteredTotal.toFixed(2)}
          {hasFilter ? " (resultado filtrado)" : ""}
        </p>
      </div>

      {/* ---- lista ---- */}
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
          return (
            <div key={r.id} className="flex flex-col gap-1 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="font-medium">{r.playerName}</p>
                <p className="text-sm text-[var(--ink-soft)]">
                  {r.teamName} · {r.type === "dropin"
                    ? `Avulso${r.gameDate ? " — " + fmtDay(r.gameDate) : ""}`
                    : `Mensalidade${r.dueDate ? ` — ${refMonth(r.dueDate)} · vence ${fmtDay(r.dueDate)}` : ""}`}
                </p>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-2">
                <span className="font-semibold">R$ {r.amount.toFixed(2)}</span>
                <span className={`badge ${STATUS_CLS[r.status] ?? "badge-neutral"}`}>
                  {STATUS_LABEL[r.status] ?? r.status}
                  {["received", "confirmed"].includes(r.status) && r.paymentMethod ? ` · ${METHOD_LABEL[r.paymentMethod] ?? r.paymentMethod}` : ""}
                </span>
                <ChargeActions chargeId={r.id} status={r.status} playerName={r.playerName} amount={r.amount} type={r.type} />
              </div>
            </div>
          );
        })}
        {rows.length === 0 && <p className="p-4 text-sm text-[var(--ink-soft)]">Nenhuma cobrança com esses filtros.</p>}
      </div>

      <CreditList credits={credits} team={cur.team ?? ""} />
    </div>
  );
}
