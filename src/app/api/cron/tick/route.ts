// Cron principal (1/min): expira reservas, abre/fecha listas, despacha a fila de mensagens.
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { dispatchPending, enqueueListOpened, enqueueListUpdate } from "@/lib/messaging";
import { processExpirations, processPromotions, type ExpiredRow } from "@/lib/waitlist";

export const maxDuration = 60;

export async function GET(req: NextRequest) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const db = supabaseAdmin();
  const report: Record<string, unknown> = {};

  // 1. expirar reservas: cancela cobranças, avisa quem perdeu a vez
  //    e dispara a cascata (Pix + avisos) para quem subiu da fila
  const { data: expired } = await db.rpc("fn_expire_reservations");
  report.expired = expired;
  const expiredRows = (expired?.expired ?? []) as ExpiredRow[];
  await processExpirations(expiredRows).catch((e) => console.error("[waitlist] expiração:", e));
  const promotedIds = (expired?.promoted ?? []) as string[];
  if (promotedIds.length) {
    // agrupa por jogo para gerar Pix e anúncios corretos
    const { data: promotedParts } = await db
      .from("game_participants").select("id, game_id").in("id", promotedIds);
    const byGame = new Map<string, string[]>();
    for (const p of promotedParts ?? []) {
      byGame.set(p.game_id, [...(byGame.get(p.game_id) ?? []), p.id]);
    }
    for (const [gameId, ids] of byGame) {
      await processPromotions(gameId, ids).catch((e) => console.error("[waitlist] promoção:", e));
    }
  }

  // 2. abrir listas e anunciar no grupo
  const { data: opened } = await db.rpc("fn_open_lists");
  report.opened = opened;
  for (const gameId of (opened?.opened ?? []) as string[]) {
    await enqueueListOpened(gameId).catch((e) => console.error("[whatsapp] abertura:", e));
  }

  // 3. prazo dos mensalistas: libera as vagas de quem não respondeu (por turma, se configurado),
  //    sobe a lista de espera (Pix para avulso promovido) e atualiza a lista no grupo
  const { data: released } = await db.rpc("fn_release_invited");
  report.released = released;
  for (const r of (released?.released ?? []) as { game_id: string; released: number; promoted?: string[] | null }[]) {
    if (r.promoted?.length) await processPromotions(r.game_id, r.promoted).catch((e) => console.error("[prazo] promoção:", e));
    else await enqueueListUpdate(r.game_id).catch((e) => console.error("[prazo] lista:", e));
  }

  // 4. fechar listas
  report.closed = (await db.rpc("fn_close_lists")).data;

  // 5. despachar mensagens pendentes (rede de segurança do envio imediato)
  report.messages = await dispatchPending();

  return NextResponse.json({ ok: true, ...report });
}
