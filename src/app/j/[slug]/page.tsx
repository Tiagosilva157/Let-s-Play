import { supabaseAdmin } from "@/lib/supabase/server";
import { getSessionPlayer } from "@/lib/session";
import { todayBR } from "@/lib/dates";
import { notFound } from "next/navigation";
import PublicGame from "./PublicGame";
import { loadSituation, type Situation } from "@/lib/my-situation";

export const dynamic = "force-dynamic";

export default async function PublicTeamPage({ params, searchParams }: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ jogo?: string }>;
}) {
  const { slug } = await params;
  const { jogo } = await searchParams;
  const db = supabaseAdmin();

  // próximos jogos visíveis da turma (recorrentes + jogos únicos)
  const { data: upcoming } = await db
    .from("public_game_view")
    .select("*")
    .eq("slug", slug)
    .gte("date", todayBR())
    .order("date", { ascending: true })
    .order("time", { ascending: true })
    .limit(6);

  // ?jogo=ID abre um jogo específico (ex.: jogo único); sem isso, o próximo da turma
  const game = (upcoming ?? []).find((g) => g.game_id === jogo) ?? (upcoming ?? [])[0];
  if (!game) notFound();
  const otherGames = (upcoming ?? []).filter((g) => g.game_id !== game.game_id)
    .map((g) => ({ id: g.game_id as string, date: g.date as string, time: String(g.time), title: (g.title as string | null) ?? null, oneOff: g.generated === false }));

  const { data: participants } = await db
    .from("public_game_participants_view")
    .select("*")
    .eq("game_id", game.game_id)
    .order("confirmed_at", { ascending: true });

  const player = await getSessionPlayer();
  let myStatus: { status: string; kind: string; promoted_from_waitlist?: boolean } | null = null;
  let isMember = false;
  let credit: number | null = null;
  // Pix em aberto (reserva ou promoção da fila): mostrado direto na tela — o
  // jogador não depende de mensagem no WhatsApp para pagar
  let pendingPix: { qr: string; copypaste: string; amount: number; expiresAt: string | null } | null = null;
  let situation: Situation | null = null;
  if (player) {
    const { data: gp } = await db
      .from("game_participants")
      .select("status, kind, promoted_from_waitlist")
      .eq("game_id", game.game_id)
      .eq("player_id", player.id)
      .maybeSingle();
    myStatus = gp ?? null;
    if (gp?.status === "reserved") {
      const { data: ch } = await db.from("charges")
        .select("pix_qr, pix_copypaste, amount, expires_at")
        .eq("game_id", game.game_id).eq("player_id", player.id).eq("status", "pending")
        .order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (ch?.pix_copypaste) pendingPix = { qr: ch.pix_qr ?? "", copypaste: ch.pix_copypaste, amount: Number(ch.amount), expiresAt: ch.expires_at ?? null };
    }
    const { data: teamRow } = await db.from("teams").select("id").eq("slug", slug).single();
    if (teamRow) {
      const { data: m } = await db
        .from("team_members")
        .select("id")
        .eq("team_id", teamRow.id)
        .eq("player_id", player.id)
        .eq("status", "active")
        .maybeSingle();
      // jogo em que mensalista paga: ele vê e age como avulso
      isMember = !!m && !game.members_pay;
      situation = await loadSituation(player.id, teamRow.id);
      if (!isMember) {
        const { peekCredit } = await import("@/lib/credits");
        const c = await peekCredit(player.id, teamRow.id, Number(game.dropin_fee));
        credit = c ? Number(c.amount) : null;
      }
    }
  }

  return (
    <PublicGame
      game={game}
      participants={participants ?? []}
      player={player}
      myStatus={myStatus}
      isMember={isMember}
      credit={credit}
      pendingPix={pendingPix}
      slug={slug}
      situation={situation}
      otherGames={otherGames}
    />
  );
}
