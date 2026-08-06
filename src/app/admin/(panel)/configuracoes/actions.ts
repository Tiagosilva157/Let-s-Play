"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin, auditAdmin } from "@/lib/admin";
import { supabaseAdmin } from "@/lib/supabase/server";
import { invalidateSettingsCache, getAsaasConfig } from "@/lib/settings";

const ALLOWED_KEYS = new Set([
  "asaas_api_key", "asaas_env", "asaas_webhook_token",
  "gpconnect_token", "gpconnect_base_url",
]);

export async function saveSettings(formData: FormData) {
  const admin = await requireAdmin();
  if (admin.role !== "owner") return { error: "Apenas o administrador principal pode alterar as integrações." };

  const db = supabaseAdmin();
  const saved: string[] = [];
  for (const [key, raw] of formData.entries()) {
    if (!ALLOWED_KEYS.has(key)) continue;
    const value = String(raw).trim();
    if (value === "") continue; // campo em branco = manter o valor atual
    if (key === "asaas_env" && !["sandbox", "production"].includes(value)) continue;
    await db.from("system_settings").upsert({ key, value, updated_at: new Date().toISOString() });
    saved.push(key);
  }
  invalidateSettingsCache();
  await auditAdmin(admin.id, "update_settings", "system_settings", null as unknown as string, { keys: saved });
  revalidatePath("/admin/configuracoes");
  return { ok: true, saved: saved.length };
}

/** Testa a conexão com o Asaas usando a config atual. */
export async function testAsaas() {
  await requireAdmin();
  const cfg = await getAsaasConfig();
  if (!cfg.apiKey) return { error: "Nenhuma chave de API configurada." };
  const baseUrl = cfg.env === "production" ? "https://api.asaas.com/v3" : "https://api-sandbox.asaas.com/v3";
  try {
    const res = await fetch(`${baseUrl}/customers?limit=1`, {
      headers: { access_token: cfg.apiKey },
    });
    if (res.status === 401) return { error: `Chave inválida para o ambiente ${cfg.env}.` };
    if (!res.ok) return { error: `Asaas respondeu ${res.status}.` };
    return { ok: true, message: `Conexão OK com o Asaas (${cfg.env}).` };
  } catch {
    return { error: "Não foi possível conectar ao Asaas." };
  }
}

/** Testa o GP Connect enviando uma mensagem para o telefone informado. */
export async function testGpConnect(formData: FormData) {
  await requireAdmin();
  const { normalizePhone } = await import("@/lib/phone");
  const phone = normalizePhone(String(formData.get("test_phone") ?? ""));
  if (!phone) return { error: "Informe um telefone válido para o teste." };
  try {
    const { GpConnect } = await import("@/lib/gpconnect");
    await GpConnect.sendTextMessage(phone, "✅ Teste de integração do Let's Play — GP Connect funcionando!");
    return { ok: true, message: "Mensagem de teste enviada! Confira o WhatsApp." };
  } catch (e) {
    return { error: `Falha no envio: ${String(e).slice(0, 120)}` };
  }
}
