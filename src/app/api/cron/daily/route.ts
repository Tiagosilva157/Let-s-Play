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

  // "hoje" no fuso do Brasil (o servidor roda em UTC)
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });

  /** Já enviamos (ou estamos enviando) uma mensagem com essa chave? Protege
   *  contra duplicata quando o servidor reinicia depois das 06h. */
  async function alreadyDispatched(dedupeKey: string) {
    const { data } = await db.from("message_dispatches")
      .select("id").eq("dedupe_key", dedupeKey)
      .in("status", ["queued", "sending", "sent"]).limit(1).maybeSingle();
    return !!data;
  }

  // lembrete de vencimento: mensalidades que vencem HOJE → Pix no WhatsApp
  const { data: dueToday } = await db
    .from("charges")
    .select("id, amount, due_date, asaas_payment_id, team_id, players(name, phone), teams(name)")
    .eq("type", "subscription")
    .in("status", ["pending", "overdue"])
    .eq("due_date", today)
    .not("asaas_payment_id", "is", null)
    .limit(200);
  let dueReminders = 0;
  const { sendMembershipDueReminder } = await import("@/lib/messaging");
  for (const c of dueToday ?? []) {
    if (await alreadyDispatched(`sub_due:${c.id}`)) continue;
    const pl = c.players as unknown as { name: string; phone: string };
    const tm = c.teams as unknown as { name: string };
    if (!pl?.phone) continue;
    try {
      const qr = await Asaas.getPixQr(c.asaas_payment_id!);
      await sendMembershipDueReminder({
        teamId: c.team_id, phone: pl.phone, playerName: pl.name, teamName: tm?.name ?? "",
        amount: Number(c.amount), dueDate: c.due_date, copypaste: qr.payload, chargeId: c.id,
      });
      dueReminders++;
    } catch (e) {
      console.error("[cron] lembrete de mensalidade falhou:", c.id, String(e).slice(0, 150));
    }
  }

  // lembrete: jogos de hoje ainda abertos → envia a lista no grupo pela manhã
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
    if (await alreadyDispatched(dedupeKey)) continue;
    const { error } = await db.from("message_dispatches").insert({
      team_id: team.id, game_id: g.id, kind: "group",
      recipient: team.whatsapp_group_id,
      body: `⏰ *É hoje!*\n\n${built.body}`,
      dedupe_key: dedupeKey,
    });
    if (!error) reminders++;
  }

  return NextResponse.json({ ok: true, generated, reconciled, reminders, dueReminders });
}
