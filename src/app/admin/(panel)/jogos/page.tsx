import Link from "next/link";
import { requireAdmin } from "@/lib/admin";
import { supabaseAdmin } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const STATUS: Record<string, { label: string; cls: string }> = {
  scheduled: { label: "Agendado", cls: "badge-neutral" },
  open: { label: "Lista aberta", cls: "badge-success" },
  closed: { label: "Lista fechada", cls: "badge-warn" },
  canceled: { label: "Cancelado", cls: "badge-danger" },
  done: { label: "Realizado", cls: "badge-neutral" },
};

export default async function GamesPage() {
  await requireAdmin();
  const db = supabaseAdmin();
  const today = new Date().toISOString().slice(0, 10);
  const { data: games } = await db
    .from("games")
    .select("id, date, time, status, teams(name, capacity), game_participants(status)")
    .gte("date", today)
    .order("date")
    .limit(30);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Jogos</h1>
      <div className="space-y-2">
        {(games ?? []).map((g) => {
          const parts = (g.game_participants ?? []) as { status: string }[];
          const confirmed = parts.filter((p) => p.status === "confirmed").length;
          const team = g.teams as unknown as { name: string; capacity: number };
          const st = STATUS[g.status] ?? { label: g.status, cls: "badge-neutral" };
          return (
            <Link key={g.id} href={`/admin/jogos/${g.id}`} className="card flex items-center justify-between p-4">
              <div>
                <p className="font-semibold">{team.name}</p>
                <p className="text-sm text-[var(--ink-soft)]">
                  {new Date(`${g.date}T12:00:00`).toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "2-digit" })} · {String(g.time).slice(0, 5)}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="badge badge-neutral">{confirmed}/{team.capacity}</span>
                <span className={`badge ${st.cls}`}>{st.label}</span>
              </div>
            </Link>
          );
        })}
        {(games ?? []).length === 0 && <p className="text-sm text-[var(--ink-soft)]">Nenhum jogo futuro.</p>}
      </div>
    </div>
  );
}
