import Link from "next/link";
import { requireAdmin } from "@/lib/admin";
import { supabaseAdmin } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const WEEKDAYS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];

export default async function TeamsPage() {
  await requireAdmin();
  const db = supabaseAdmin();
  const { data: teams } = await db
    .from("teams")
    .select("*, team_members(count)")
    .order("weekday");

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Turmas</h1>
        <Link href="/admin/turmas/nova" className="btn btn-primary btn-sm">+ Nova turma</Link>
      </div>
      <div className="space-y-2">
        {(teams ?? []).map((t) => (
          <Link key={t.id} href={`/admin/turmas/${t.id}`} className="card flex items-center justify-between p-4">
            <div>
              <p className="font-semibold">{t.name}</p>
              <p className="text-sm text-[var(--ink-soft)]">
                {WEEKDAYS[t.weekday]} · {String(t.game_time).slice(0, 5)} · {t.capacity} vagas · /j/{t.slug}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="badge badge-neutral">{(t.team_members as { count: number }[])[0]?.count ?? 0} mensalistas</span>
              <span className={`badge ${t.status === "active" ? "badge-success" : "badge-danger"}`}>
                {t.status === "active" ? "Ativa" : "Inativa"}
              </span>
            </div>
          </Link>
        ))}
        {(teams ?? []).length === 0 && <p className="text-sm text-[var(--ink-soft)]">Nenhuma turma ainda.</p>}
      </div>
    </div>
  );
}
