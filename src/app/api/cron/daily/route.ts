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
   *  contra duplicata quando o servidor reinicia depois das 08h. */
  async function alreadyDispatched(dedupeKey: string) {
    const { data } = await db.from("message_dispatches")
      .select("id").eq("dedupe_key", dedupeKey)
      .in("status", ["queued", "sending", "sent"]).limit(1).maybeSingle();
    return !!data;
  }

  // lembretes de mensalidade, conforme a configuração de cada turma:
  //   individual → Pix no privado de cada mensalista (nos dias escolhidos)
  //   group      → UMA mensagem no grupo com o link da turma (nada no privado)
  //   off        → nada
  const { sendMembershipDueReminder, enqueueMembershipGroupReminder } = await import("@/lib/messaging");
  const plusDays = (n: number) => new Date(new Date(today + "T12:00:00-03:00").getTime() + n * 86400e3)
    .toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
  let dueReminders = 0;
  const { data: teamsCfg } = await db.from("teams")
    .select("id, name, slug, whatsapp_group_id, due_reminder_channel, due_reminder_days")
    .eq("status", "active");
  for (const t of teamsCfg ?? []) {
    const channel = (t.due_reminder_channel as string) ?? "individual";
    if (channel === "off") continue;
    const days = Array.from(new Set(((t.due_reminder_days as number[] | null) ?? [5, 0]).filter((d) => d >= 0 && d <= 30)));
    for (const daysBefore of days) {
      const dueDate = plusDays(daysBefore);
      const { data: due } = await db
        .from("charges")
        .select("id, amount, due_date, asaas_payment_id, team_id, players(name, phone)")
        .eq("type", "subscription")
        .eq("team_id", t.id)
        .in("status", ["pending", "overdue"])
        .eq("due_date", dueDate)
        .not("asaas_payment_id", "is", null)
        .limit(200);
      if (!due?.length) continue;

      if (channel === "group") {
        if (!t.whatsapp_group_id) continue;
        const key = `sub_due_group:${t.id}:${dueDate}:${daysBefore}`;
        if (await alreadyDispatched(key)) continue;
        try {
          await enqueueMembershipGroupReminder({
            teamId: t.id, groupId: t.whatsapp_group_id, teamName: t.name, slug: t.slug,
            dueDate, daysBefore, pendingCount: due.length,
          });
          dueReminders++;
        } catch (e) {
          console.error("[cron] lembrete de mensalidade no grupo falhou:", t.id, String(e).slice(0, 150));
        }
        continue;
      }

      for (const c of due) {
        const key = daysBefore === 0 ? `sub_due:${c.id}` : `sub_due${daysBefore}:${c.id}`;
        if (await alreadyDispatched(key)) continue;
        const pl = c.players as unknown as { name: string; phone: string };
        if (!pl?.phone) continue;
        try {
          const qr = await Asaas.getPixQr(c.asaas_payment_id!);
          await sendMembershipDueReminder({
            teamId: c.team_id, phone: pl.phone, playerName: pl.name, teamName: t.name,
            amount: Number(c.amount), dueDate: c.due_date, copypaste: qr.payload, chargeId: c.id, daysBefore,
          });
          dueReminders++;
        } catch (e) {
          console.error("[cron] lembrete de mensalidade falhou:", c.id, String(e).slice(0, 150));
        }
      }
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
