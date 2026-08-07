import { requireAdmin } from "@/lib/admin";
import { supabaseAdmin } from "@/lib/supabase/server";
import { formatPhoneBR } from "@/lib/phone";
import { formatCpfCnpj } from "@/lib/asaas-customer";
import PlayerManager, { type PlayerRow, type TeamOption } from "./PlayerManager";

export const dynamic = "force-dynamic";

export default async function PlayersPage() {
  await requireAdmin();
  const db = supabaseAdmin();
  const [{ data: players }, { data: teams }] = await Promise.all([
    db.from("players")
      .select("id, name, phone, email, cpf_cnpj, notes, active, team_members(status, team_id, teams(name))")
      .order("name"),
    db.from("teams").select("id, name").eq("status", "active").order("name"),
  ]);

  const rows: PlayerRow[] = (players ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    phone: formatPhoneBR(p.phone),
    phoneRaw: p.phone,
    email: p.email ?? "",
    cpf: formatCpfCnpj(p.cpf_cnpj),
    cpfRaw: p.cpf_cnpj ?? "",
    notes: p.notes ?? "",
    active: p.active,
    teams: ((p.team_members as unknown as { status: string; teams: { name: string } }[] | null) ?? [])
      .filter((m) => m.status === "active")
      .map((m) => m.teams?.name)
      .filter(Boolean),
    teamIds: ((p.team_members as unknown as { status: string; team_id: string }[] | null) ?? [])
      .filter((m) => m.status === "active")
      .map((m) => m.team_id),
  }));

  return <PlayerManager players={rows} teams={(teams ?? []) as TeamOption[]} />;
}
