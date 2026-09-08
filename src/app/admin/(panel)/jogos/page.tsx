import Link from "next/link";
import { requireAdmin } from "@/lib/admin";
import { supabaseAdmin } from "@/lib/supabase/server";
import { todayBR } from "@/lib/dates";

export const dynamic = "force-dynamic";

const STATUS: Record<string, { label: string; cls: string }> = {
  scheduled: { label: "Agendado", cls: "badge-neutral" },
  open: { label: "Lista aberta", cls: "badge-success" },
  closed: { label: "Lista fechada", cls: "badge-warn" },
  canceled: { label: "Cancelado", cls: "badge-danger" },
  done: { label: "Realizado", cls: "badge-neutral" },
};

export default async function GamesPage({ searchParams }: { searchParams: Promise<{ ver?: string }> }) {
  await requireAdmin();
  const { ver } = await searchParams;
  const past = ver === "anteriores";
  const db = supabaseAdmin();
  const today = todayBR();

  let query = db
    .from("games")
    .select("id, date, time, status, teams(name, capacity), game_participants(status, kind, charges(status))");
  query = past
    ? query.lt("date", today).order("date", { ascending: false }).limit(40)
    : query.gte("date", today).order("date").limit(30);
  const { data: games } = await query;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-bold">Jogos</h1>
        <div className="flex gap-1">
          <Link href="/admin/jogos" className={`rounded-lg px-3 py-1.5 text-sm font-medium ${!past ? "bg-[var(--brand)] text-white" : "text-[var(--ink-soft)]"}`}>Próximos</Link>
          <Link href="/admin/jogos?ver=anteriores" className={`rounded-lg px-3 py-1.5 text-sm font-medium ${past ? "bg-[var(--brand)] text-white" : "text-[var(--ink-soft)]"}`}>🕘 Anteriores</Link>
        </div>
      </div>
      {past && (
        <p className="text-sm text-[var(--ink-soft)]">
          Histórico dos jogos já realizados. Abra qualquer um para cancelar (jogo que não aconteceu), dar crédito ou estornar quem pagou — as mesmas ações de um jogo em andamento.
        </p>
      )}
      <div className="space-y-2">
        {(games ?? []).map((g) => {
          const parts = (g.game_participants ?? []) as unknown as { status: string; kind: string; charges: { status: string } | null }[];
          const confirmed = parts.filter((p) => p.status === "confirmed").length;
          const paidDropins = parts.filter((p) => p.kind === "dropin" && ["received", "confirmed"].includes(p.charges?.status ?? "")).length;
          const toDecide = parts.filter((p) => p.status === "pending_review" || (p.status === "withdrawn" && ["received", "confirmed"].includes(p.charges?.status ?? ""))).length;
          const team = g.teams as unknown as { name: string; capacity: number };
          const st = STATUS[g.status] ?? { label: g.status, cls: "badge-neutral" };
          return (
            <Link key={g.id} href={`/admin/jogos/${g.id}`} className="card flex items-center justify-between p-4">
              <div>
                <p className="font-semibold">{team.name}</p>
                <p className="text-sm text-[var(--ink-soft)]">
                  {new Date(`${g.date}T12:00:00`).toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "2-digit" })} · {String(g.time).slice(0, 5)}
                  {past && paidDropins > 0 && ` · ${paidDropins} avulso(s) pago(s)`}
                </p>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-2">
                {toDecide > 0 && <span className="badge badge-danger">{toDecide} a decidir</span>}
                <span className="badge badge-neutral">{confirmed}/{team.capacity}</span>
                <span className={`badge ${st.cls}`}>{st.label}</span>
              </div>
            </Link>
          );
        })}
        {(games ?? []).length === 0 && (
          <p className="text-sm text-[var(--ink-soft)]">{past ? "Nenhum jogo anterior." : "Nenhum jogo futuro."}</p>
        )}
      </div>
    </div>
  );
}
