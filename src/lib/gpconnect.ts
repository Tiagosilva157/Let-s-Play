// Cliente GP Connect — usado somente no servidor.
// Docs: base.connetchannelslite.com.br → APIs → Mensagem
//   Grupo (Pro):  POST https://api.gpconnect.com.br/api/messages/whatsmeow/sendTextGroupPRO
//   Individual:   POST https://api.gpconnect.com.br/api/messages/send
// Auth: Bearer {token cadastrado na conexão}

import { getSettings } from "@/lib/settings";

async function gp(path: string, body: Record<string, unknown>) {
  const s = await getSettings();
  const token = s.gpconnect_token || process.env.GPCONNECT_TOKEN || "";
  const baseUrl = s.gpconnect_base_url || process.env.GPCONNECT_BASE_URL || "https://api.gpconnect.com.br";
  if (!token) throw new Error("GP Connect não configurado: defina o token em Configurações.");
  const res = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`GP Connect ${res.status}: ${await res.text()}`);
  return res.json().catch(() => ({}));
}

export const GpConnect = {
  /** Mensagem de texto em grupo do WhatsApp. groupId no formato "1203...@g.us" */
  sendGroupMessage: (groupId: string, message: string) =>
    gp("/api/messages/whatsmeow/sendTextGroupPRO", {
      number: groupId,
      openTicket: "0",
      queueId: "0",
      body: message,
    }),

  /** Mensagem individual (OTP e avisos). phone: ddi+ddd+numero, só dígitos (ex.: 5511999999999) */
  sendTextMessage: (phone: string, message: string) =>
    gp("/api/messages/send", {
      number: phone,
      openTicket: "0",
      queueId: "0",
      body: message,
    }),
};
