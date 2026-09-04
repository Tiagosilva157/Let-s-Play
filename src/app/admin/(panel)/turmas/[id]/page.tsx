import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/admin";
import { supabaseAdmin } from "@/lib/supabase/server";
import { formatPhoneBR } from "@/lib/phone";
import TeamForm from "../TeamForm";
import MemberManager from "./MemberManager";

export const dynamic = "force-dynamic";

export default async function TeamDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const db = supabaseAdmin();

  const { data: team } = await db.from("teams").select("*").eq("id", id).maybeSingle();
  if (!team) notFound();

  const { data: members } = await db
    .from("team_members")
    .select("id, monthly_fee_override, due_day, subscription_status, status, players(id, name, phone)")
    .eq("team_id", id)
    .eq("status", "active")
    .order("created_at");

  const memberList = (members ?? []).map((m) => ({
    id: m.id,
    name: (m.players as unknown as { name: string }).name,
    phone: formatPhoneBR((m.players as unknown as { phone: string }).phone),
    fee: m.monthly_fee_override ?? team.monthly_fee,
    dueDay: m.due_day,
    subscription: m.subscription_status,
  }));

  // todos os jogadores ativos — os mensalistas atuais chegam pré-marcados
  const memberPlayerIds = new Set((members ?? []).map((m) => (m.players as unknown as { id: string }).id));
  const { data: allPlayers } = await db
    .from("players")
    .select("id, name, phone, cpf_cnpj")
    .eq("active", true)
    .order("name");
  const availablePlayers = (allPlayers ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    phone: formatPhoneBR(p.phone),
    hasCpf: !!p.cpf_cnpj,
    isMember: memberPlayerIds.has(p.id),
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{team.name}</h1>
        <p className="text-sm text-[var(--ink-soft)]">
          Link público: <a className="text-[var(--brand)] underline" href={`/j/${team.slug}`} target="_blank">/j/{team.slug}</a>
        </p>
      </div>
      <MemberManager teamId={team.id} members={memberList} availablePlayers={availablePlayers} />
      <details className="card p-4">
        <summary className="cursor-pointer font-semibold">Configurações da turma</summary>
        <div className="pt-4">
          <TeamForm team={{ ...team, game_time: String(team.game_time) }} />
        </div>
      </details>
    </div>
  );
}
