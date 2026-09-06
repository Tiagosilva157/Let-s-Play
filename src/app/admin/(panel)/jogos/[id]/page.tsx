import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/admin";
import { supabaseAdmin } from "@/lib/supabase/server";
import { formatPhoneBR } from "@/lib/phone";
import GameManager from "./GameManager";
import TeamSplitter from "./TeamSplitter";

export const dynamic = "force-dynamic";

export default async function GameDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const db = supabaseAdmin();

  const { data: game } = await db
    .from("games")
    .select("*, teams(name, capacity, whatsapp_group_id)")
    .eq("id", id)
    .maybeSingle();
  if (!game) notFound();

  const { data: parts } = await db
    .from("game_participants")
    .select("id, kind, status, reserved_until, confirmed_at, players(id, name, phone, skill_level), charges(status, amount)")
    .eq("game_id", id)
    .order("confirmed_at", { ascending: true });

  const team = game.teams as unknown as { name: string; capacity: number; whatsapp_group_id: string | null };

  const participants = (parts ?? []).map((p) => ({
    id: p.id,
    playerId: (p.players as unknown as { id: string }).id,
    name: (p.players as unknown as { name: string }).name,
    phone: formatPhoneBR((p.players as unknown as { phone: string }).phone),
    kind: p.kind as "member" | "dropin",
    status: p.status,
    chargeStatus: (p.charges as unknown as { status: string } | null)?.status ?? null,
  }));

  // jogadores que o admin pode colocar manualmente na lista
  const [{ data: allPlayers }, { data: activeMembers }] = await Promise.all([
    db.from("players").select("id, name, phone").eq("active", true).order("name"),
    db.from("team_members").select("player_id").eq("team_id", game.team_id).eq("status", "active"),
  ]);
  const memberIds = new Set((activeMembers ?? []).map((m) => m.player_id));
  const inListIds = new Set((parts ?? [])
    .filter((p) => ["confirmed", "invited", "reserved", "waitlist"].includes(p.status))
    .map((p) => (p.players as unknown as { id: string }).id));
  const addable = (allPlayers ?? [])
    .filter((p) => !inListIds.has(p.id))
    .map((p) => ({ id: p.id, name: p.name, phone: formatPhoneBR(p.phone), isMember: memberIds.has(p.id) }));

  const { data: history } = await db
    .from("audit_logs")
    .select("action, created_at, after")
    .eq("entity", "games").eq("entity_id", id)
    .order("created_at", { ascending: false })
    .limit(12);

  const savedSplit = (game.teams_split as { teams?: string[][] } | null)?.teams ?? null;

  const confirmedForSplit = (parts ?? [])
    .filter((p) => p.status === "confirmed")
    .map((p) => {
      const pl = p.players as unknown as { id: string; name: string; skill_level: number };
      return { id: pl.id, name: pl.name, skill: pl.skill_level ?? 3 };
    });

  return (
    <GameManager
      game={{
        id: game.id,
        teamName: team.name,
        date: game.date,
        time: String(game.time),
        status: game.status,
        capacity: game.capacity_override ?? team.capacity,
        hasWhatsApp: !!team.whatsapp_group_id,
      }}
      participants={participants}
      addable={addable}
      splitter={<TeamSplitter gameId={game.id} confirmed={confirmedForSplit} hasWhatsApp={!!team.whatsapp_group_id} savedSplit={savedSplit} />}
      history={(history ?? []).map((h) => ({ action: h.action, at: h.created_at }))}
    />
  );
}
