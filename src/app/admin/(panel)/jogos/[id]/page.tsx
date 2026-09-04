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
      splitter={<TeamSplitter gameId={game.id} confirmed={confirmedForSplit} hasWhatsApp={!!team.whatsapp_group_id} />}
    />
  );
}
