// Cron principal (1/min via Vercel Cron): expira reservas, abre/fecha listas, envia fila de mensagens.
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { Asaas } from "@/lib/asaas";
import { GpConnect } from "@/lib/gpconnect";

export const maxDuration = 60;

export async function GET(req: NextRequest) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const db = supabaseAdmin();
  const report: Record<string, unknown> = {};

  // 1. expirar reservas + cancelar cobranças órfãs
  const { data: expired } = await db.rpc("fn_expire_reservations");
  report.expired = expired;
  if (expired?.expired?.length) {
    const { data: charges } = await db
      .from("charges")
      .select("id, asaas_payment_id")
      .in("id",
        (await db.from("game_participants").select("charge_id").in("id", expired.expired))
          .data?.map((r) => r.charge_id).filter(Boolean) ?? [])
      .eq("status", "pending");
    for (const c of charges ?? []) {
      if (c.asaas_payment_id) await Asaas.cancelPayment(c.asaas_payment_id).catch(() => {});
      await db.from("charges").update({ status: "expired" }).eq("id", c.id);
    }
  }

  // 2. abrir e fechar listas
  report.opened = (await db.rpc("fn_open_lists")).data;
  report.closed = (await db.rpc("fn_close_lists")).data;

  // 3. despachar mensagens pendentes
  const { data: pending } = await db
    .from("message_dispatches")
    .select("*")
    .eq("status", "queued")
    .lte("scheduled_for", new Date().toISOString())
    .order("created_at", { ascending: true })
    .limit(20);

  let sent = 0, failed = 0;
  for (const m of pending ?? []) {
    try {
      if (m.kind === "group") await GpConnect.sendGroupMessage(m.recipient, m.body);
      else await GpConnect.sendTextMessage(m.recipient, m.body);
      await db.from("message_dispatches").update({ status: "sent", sent_at: new Date().toISOString() }).eq("id", m.id);
      sent++;
    } catch (e) {
      failed++;
      const retries = m.retries + 1;
      await db.from("message_dispatches").update({
        status: retries >= 3 ? "failed" : "queued",
        retries,
        error: String(e),
        scheduled_for: new Date(Date.now() + retries * 2 * 60_000).toISOString(), // backoff
      }).eq("id", m.id);
    }
  }
  report.messages = { sent, failed };

  return NextResponse.json({ ok: true, ...report });
}
