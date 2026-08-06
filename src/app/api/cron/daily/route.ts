// Cron diário: gera jogos futuros + conciliação de cobranças pendentes com o Asaas.
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { Asaas } from "@/lib/asaas";

export const maxDuration = 300;

export async function GET(req: NextRequest) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const db = supabaseAdmin();

  const { data: generated } = await db.rpc("fn_generate_games");

  // conciliação: charges pendentes há mais de 1h — consulta status real no Asaas
  const oneHourAgo = new Date(Date.now() - 3600_000).toISOString();
  const { data: stale } = await db
    .from("charges")
    .select("id, asaas_payment_id, type, game_id")
    .eq("status", "pending")
    .lt("created_at", oneHourAgo)
    .not("asaas_payment_id", "is", null)
    .limit(100);

  let reconciled = 0;
  for (const c of stale ?? []) {
    try {
      const p = await Asaas.getPayment(c.asaas_payment_id!);
      const map: Record<string, string> = {
        RECEIVED: "received", CONFIRMED: "confirmed", OVERDUE: "overdue",
        REFUNDED: "refunded", DELETED: "canceled",
      };
      const mapped = map[p.status];
      if (mapped) {
        await db.from("charges").update({ status: mapped }).eq("id", c.id);
        if ((mapped === "received" || mapped === "confirmed") && c.type === "dropin" && c.game_id) {
          await db.rpc("fn_confirm_dropin_payment", { p_charge_id: c.id });
        }
        reconciled++;
      }
    } catch { /* Asaas indisponível — tenta no próximo ciclo */ }
  }

  // lembrete: jogos de hoje ainda abertos → envia a lista no grupo pela manhã
  const today = new Date().toISOString().slice(0, 10);
  const { data: todayGames } = await db
    .from("games")
    .select("id, teams(id, whatsapp_group_id)")
    .eq("date", today)
    .in("status", ["open", "closed"]);
  let reminders = 0;
  const { buildListMessage } = await import("@/lib/messaging");
  for (const g of todayGames ?? []) {
    const team = g.teams as unknown as { id: string; whatsapp_group_id: string | null };
    if (!team.whatsapp_group_id) continue;
    const built = await buildListMessage(g.id);
    if (!built) continue;
    const dedupeKey = `reminder:${g.id}`;
    const { error } = await db.from("message_dispatches").insert({
      team_id: team.id, game_id: g.id, kind: "group",
      recipient: team.whatsapp_group_id,
      body: `⏰ *É hoje!*\n\n${built.body}`,
      dedupe_key: dedupeKey,
    });
    if (!error) reminders++;
  }

  return NextResponse.json({ ok: true, generated, reconciled, reminders });
}
