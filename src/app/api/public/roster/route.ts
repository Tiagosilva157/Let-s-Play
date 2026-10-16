// Lista ao vivo do jogo (o link consulta a cada 15 s).
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { getSessionPlayer } from "@/lib/session";
import { loadPublicRoster } from "@/lib/public-roster";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const gameId = req.nextUrl.searchParams.get("game") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(gameId)) return NextResponse.json({ error: "invalid" }, { status: 400 });

  // só jogos que o link público já mostra (turma ativa, jogo não cancelado)
  const db = supabaseAdmin();
  const { data: visible } = await db.from("public_game_view").select("game_id").eq("game_id", gameId).maybeSingle();
  if (!visible) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const player = await getSessionPlayer();
  const roster = await loadPublicRoster(gameId, !!player);
  if (!roster) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json(roster, { headers: { "Cache-Control": "no-store" } });
}
