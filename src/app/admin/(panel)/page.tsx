import Link from "next/link";
import { requireAdmin } from "@/lib/admin";
import { supabaseAdmin } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function Dashboard() {
  await requireAdmin();
  const db = supabaseAdmin();
  const today = new Date().toISOString().slice(0, 10);

  const [teams, games, overdue, pendingReview, failedMsgs] = await Promise.all([
    db.from("teams").select("id", { count: "exact", head: true }).eq("status", "active"),
    db.from("games").select("id, date, time, status, teams(name)").gte("date", today).in("status", ["scheduled", "open", "closed"]).order("date").limit(6),
    db.from("team_members").select("id", { count: "exact", head: true }).eq("subscription_status", "overdue"),
    db.from("game_participants").select("id", { count: "exact", head: true }).eq("status", "pending_review"),
    db.from("message_dispatches").select("id", { count: "exact", head: true }).eq("status", "failed"),
  ]);

  const gameIds = (games.data ?? []).map((g) => g.id);
  const { data: counts } = gameIds.length
    ? await db.from("game_participants").select("game_id, status").in("game_id", gameIds).eq("status", "confirmed")
    : { data: [] };

  const alerts: { text: string; href: string }[] = [];
  if ((overdue.count ?? 0) > 0) alerts.push({ text: `${overdue.count} mensalista(s) inadimplente(s)`, href: "/admin/financeiro" });
  if ((pendingReview.count ?? 0) > 0) alerts.push({ text: `${pendingReview.count} pagamento(s) recebido(s) com lista cheia — decidir crédito/estorno`, href: "/admin/jogos" });
  if ((failedMsgs.count ?? 0) > 0) alerts.push({ text: `${failedMsgs.count} mensagem(ns) de WhatsApp falharam`, href: "/admin/jogos" });

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Visão geral</h1>

      {alerts.length > 0 && (
        <div className="space-y-2">
          {alerts.map((a, i) => (
            <Link key={i} href={a.href} className="block rounded-xl bg-[var(--warn-bg)] px-4 py-3 text-sm font-medium text-[var(--warn)]">
              ⚠️ {a.text}
            </Link>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div className="card p-4"><p className="text-2xl font-bold">{teams.count ?? 0}</p><p className="text-sm text-[var(--ink-soft)]">Turmas ativas</p></div>
        <div className="card p-4"><p className="text-2xl font-bold">{games.data?.length ?? 0}</p><p className="text-sm text-[var(--ink-soft)]">Próximos jogos</p></div>
        <div className="card p-4"><p className="text-2xl font-bold">{overdue.count ?? 0}</p><p className="text-sm text-[var(--ink-soft)]">Inadimplentes</p></div>
      </div>

      <section>
        <h2 className="mb-3 font-bold">Próximos jogos</h2>
        <div className="space-y-2">
          {(games.data ?? []).map((g) => {
            const c = (counts ?? []).filter((x) => x.game_id === g.id).length;
            return (
              <Link key={g.id} href={`/admin/jogos/${g.id}`} className="card flex items-center justify-between p-4">
                <div>
                  <p className="font-semibold">{(g.teams as unknown as { name: string }).name}</p>
                  <p className="text-sm text-[var(--ink-soft)]">
                    {new Date(`${g.date}T12:00:00`).toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit" })} · {String(g.time).slice(0, 5)}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="badge badge-success">{c} confirmados</span>
                  <span className={`badge ${g.status === "open" ? "badge-success" : "badge-neutral"}`}>
                    {({ scheduled: "Agendado", open: "Aberto", closed: "Fechado" } as Record<string, string>)[g.status] ?? g.status}
                  </span>
                </div>
              </Link>
            );
          })}
          {(games.data ?? []).length === 0 && <p className="text-sm text-[var(--ink-soft)]">Nenhum jogo futuro. Crie uma turma para gerar jogos automaticamente.</p>}
        </div>
      </section>
    </div>
  );
}
