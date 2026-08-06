import { requireAdmin } from "@/lib/admin";
import { getSettings, getAsaasConfig } from "@/lib/settings";
import SettingsForm from "./SettingsForm";

export const dynamic = "force-dynamic";

function mask(v: string) {
  if (!v) return "";
  return v.length <= 8 ? "••••" : `${v.slice(0, 4)}••••${v.slice(-4)}`;
}

export default async function SettingsPage() {
  const me = await requireAdmin();
  const s = await getSettings();
  const asaas = await getAsaasConfig();

  return (
    <SettingsForm
      meIsOwner={me.role === "owner"}
      current={{
        asaas_api_key: mask(asaas.apiKey),
        asaas_env: asaas.env,
        asaas_webhook_token: mask(asaas.webhookToken),
        gpconnect_token: mask(s.gpconnect_token || process.env.GPCONNECT_TOKEN || ""),
        gpconnect_base_url: s.gpconnect_base_url || process.env.GPCONNECT_BASE_URL || "https://api.gpconnect.com.br",
      }}
    />
  );
}
