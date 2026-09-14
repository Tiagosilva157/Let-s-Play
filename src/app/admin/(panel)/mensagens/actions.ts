"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin, auditAdmin } from "@/lib/admin";
import { supabaseAdmin } from "@/lib/supabase/server";

/** Coloca uma mensagem que falhou de volta na fila (nova tentativa imediata). */
export async function resendDispatch(id: string) {
  const admin = await requireAdmin();
  const db = supabaseAdmin();
  const { data: row } = await db.from("message_dispatches").select("id, status").eq("id", id).maybeSingle();
  if (!row) return { error: "Mensagem não encontrada." };
  if (row.status !== "failed") return { error: "Essa mensagem não está com falha." };
  await db.from("message_dispatches")
    .update({ status: "queued", retries: 0, error: null, scheduled_for: new Date().toISOString() })
    .eq("id", id);
  await auditAdmin(admin.id, "resend_dispatch", "message_dispatches", id);
  const { dispatchPending } = await import("@/lib/messaging");
  const r = await dispatchPending(5).catch(() => null);
  revalidatePath("/admin");
  if (r && r.failed > 0 && r.sent === 0) return { error: "Tentei reenviar e falhou de novo. Confira a conexão do WhatsApp na GP Connect." };
  return { ok: true };
}

/** Marca uma falha como vista (some do painel, fica no histórico). */
export async function dismissDispatch(id: string) {
  const admin = await requireAdmin();
  const db = supabaseAdmin();
  await db.from("message_dispatches").update({ status: "canceled" }).eq("id", id).eq("status", "failed");
  await auditAdmin(admin.id, "dismiss_dispatch", "message_dispatches", id);
  revalidatePath("/admin");
  return { ok: true };
}

/** Envia uma mensagem de teste para o número informado (confere a conexão). */
export async function testWhatsApp(phone: string) {
  await requireAdmin();
  const { normalizePhone } = await import("@/lib/phone");
  const n = normalizePhone(phone);
  if (!n) return { error: "Telefone inválido." };
  const { GpConnect, connectionNameFrom } = await import("@/lib/gpconnect");
  try {
    const res = await GpConnect.sendTextMessage(n, "✅ Teste do Let's Play: o envio individual pelo WhatsApp está funcionando.");
    const conn = connectionNameFrom(res);
    return { ok: true, note: conn ? `Enviado pela conexão "${conn}".` : "Enviado." };
  } catch (e) {
    return { error: "Falhou: " + String(e).slice(0, 200) };
  }
}
