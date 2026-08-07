// Cron principal (1/min): expira reservas, abre/fecha listas, despacha a fila de mensagens.
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { Asaas } from "@/lib/asaas";
import { dispatchPending, enqueueListOpened } from "@/lib/messaging";

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
    const { data: parts } = await db
      .from("game_participants").select("charge_id").in("id", expired.expired);
    const chargeIds = (parts ?? []).map((r) => r.charge_id).filter(Boolean);
    if (chargeIds.length) {
      const { data: charges } = await db
        .from("charges").select("id, asaas_payment_id").in("id", chargeIds).eq("status", "pending");
      for (const c of charges ?? []) {
        if (c.asaas_payment_id) await Asaas.cancelPayment(c.asaas_payment_id).catch(() => {});
        await db.from("charges").update({ status: "expired" }).eq("id", c.id);
      }
    }
  }

  // 2. abrir listas e anunciar no grupo
  const { data: opened } = await db.rpc("fn_open_lists");
  report.opened = opened;
  for (const gameId of (opened?.opened ?? []) as string[]) {
    await enqueueListOpened(gameId).catch((e) => console.error("[whatsapp] abertura:", e));
  }

  // 3. fechar listas
  report.closed = (await db.rpc("fn_close_lists")).data;

  // 4. despachar mensagens pendentes (rede de segurança do envio imediato)
  report.messages = await dispatchPending();

  return NextResponse.json({ ok: true, ...report });
}
