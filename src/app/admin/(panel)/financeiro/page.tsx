import { requireAdmin } from "@/lib/admin";
import { supabaseAdmin } from "@/lib/supabase/server";

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

export default async function FinancePage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  await requireAdmin();
  const { status } = await searchParams;
  const db = supabaseAdmin();

  let query = db
    .from("charges")
    .select("id, type, amount, status, due_date, created_at, players(name), teams(name), games(date)")
    .order("created_at", { ascending: false })
    .limit(100);
  if (status) query = query.eq("status", status);
  const { data: charges } = await query;

  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400_000).toISOString();
  const { data: recent } = await db
    .from("charges")
    .select("amount, status")
    .gte("created_at", thirtyDaysAgo);
  const receivedTotal = (recent ?? []).filter((c) => ["received", "confirmed"].includes(c.status)).reduce((s, c) => s + Number(c.amount), 0);
  const pendingTotal = (recent ?? []).filter((c) => ["pending", "overdue"].includes(c.status)).reduce((s, c) => s + Number(c.amount), 0);

  const filters = ["", "pending", "overdue", "received", "refunded"];

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Financeiro</h1>

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
        {filters.map((f) => (
          <a key={f} href={f ? `?status=${f}` : "?"}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium ${status === f || (!status && !f) ? "bg-[var(--brand)] text-white" : "text-[var(--ink-soft)]"}`}>
            {f ? STATUS_LABEL[f].label : "Todas"}
          </a>
        ))}
      </div>

      <div className="card divide-y divide-[var(--line)]">
        {(charges ?? []).map((c) => {
          const st = STATUS_LABEL[c.status] ?? { label: c.status, cls: "badge-neutral" };
          return (
            <div key={c.id} className="flex flex-col gap-1 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="font-medium">{(c.players as unknown as { name: string })?.name}</p>
                <p className="text-sm text-[var(--ink-soft)]">
                  {(c.teams as unknown as { name: string })?.name} · {c.type === "dropin" ? `Avulso ${(c.games as unknown as { date: string })?.date ? "— " + new Date(`${(c.games as unknown as { date: string }).date}T12:00:00`).toLocaleDateString("pt-BR") : ""}` : `Mensalidade${c.due_date ? ` — ${refMonth(c.due_date)} · vence ${new Date(`${c.due_date}T12:00:00`).toLocaleDateString("pt-BR")}` : ""}`}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="font-semibold">R$ {Number(c.amount).toFixed(2)}</span>
                <span className={`badge ${st.cls}`}>{st.label}</span>
              </div>
            </div>
          );
        })}
        {(charges ?? []).length === 0 && <p className="p-4 text-sm text-[var(--ink-soft)]">Nenhuma cobrança.</p>}
      </div>
    </div>
  );
}
