// Configurações dinâmicas (system_settings) com fallback para env vars.
// Tokens ficam no banco protegido por RLS (somente admins/service_role) — nunca chegam ao frontend.
import { supabaseAdmin } from "@/lib/supabase/server";

let cache: { at: number; values: Record<string, string> } | null = null;
const TTL_MS = 30_000;

export async function getSettings(): Promise<Record<string, string>> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.values;
  const db = supabaseAdmin();
  const { data } = await db.from("system_settings").select("key, value");
  const values: Record<string, string> = {};
  for (const row of data ?? []) values[row.key] = typeof row.value === "string" ? row.value : String(row.value ?? "");
  cache = { at: Date.now(), values };
  return values;
}

export function invalidateSettingsCache() {
  cache = null;
}

/** Config do Asaas: painel (system_settings) tem prioridade; env é fallback. */
export async function getAsaasConfig() {
  const s = await getSettings();
  return {
    apiKey: s.asaas_api_key || process.env.ASAAS_API_KEY || "",
    env: (s.asaas_env || process.env.ASAAS_ENV || "sandbox") as "sandbox" | "production",
    webhookToken: s.asaas_webhook_token || process.env.ASAAS_WEBHOOK_TOKEN || "",
  };
}
