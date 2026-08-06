import { supabaseAdmin } from "@/lib/supabase/server";
import { getSessionPlayer } from "@/lib/session";
import { notFound } from "next/navigation";
import PublicGame from "./PublicGame";

export const dynamic = "force-dynamic";

export default async function PublicTeamPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const db = supabaseAdmin();

  // próximo jogo visível da turma
  const { data: game } = await db
    .from("public_game_view")
    .select("*")
    .eq("slug", slug)
    .gte("date", new Date().toISOString().slice(0, 10))
    .order("date", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!game) notFound();

  const { data: participants } = await db
    .from("public_game_participants_view")
    .select("*")
    .eq("game_id", game.game_id)
    .order("confirmed_at", { ascending: true });

  const player = await getSessionPlayer();
  let myStatus: { status: string; kind: string } | null = null;
  let isMember = false;
  if (player) {
    const { data: gp } = await db
      .from("game_participants")
      .select("status, kind")
      .eq("game_id", game.game_id)
      .eq("player_id", player.id)
      .maybeSingle();
    myStatus = gp ?? null;
    const { data: teamRow } = await db.from("teams").select("id").eq("slug", slug).single();
    if (teamRow) {
      const { data: m } = await db
        .from("team_members")
        .select("id")
        .eq("team_id", teamRow.id)
        .eq("player_id", player.id)
        .eq("status", "active")
        .maybeSingle();
      isMember = !!m;
    }
  }

  return (
    <PublicGame
      game={game}
      participants={participants ?? []}
      player={player}
      myStatus={myStatus}
      isMember={isMember}
    />
  );
}
