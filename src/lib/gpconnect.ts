// Cliente GP Connect — motor de todas as notificações do sistema (grupos e individuais).
// Docs: base.connetchannelslite.com.br → APIs → Mensagem
//   Grupo (Pro):  POST https://api.gpconnect.com.br/api/messages/whatsmeow/sendTextGroupPRO
//   Individual:   POST https://api.gpconnect.com.br/api/messages/send
// Auth: Bearer {token cadastrado na conexão}
import { getSettings } from "@/lib/settings";

const DEFAULT_BASE = "https://api.gpconnect.com.br";

async function gp(path: string, body: Record<string, unknown>) {
  const s = await getSettings();
  const token = (s.gpconnect_token || process.env.GPCONNECT_TOKEN || "").trim();
  const baseUrl = (s.gpconnect_base_url || process.env.GPCONNECT_BASE_URL || DEFAULT_BASE)
    .trim()
    .replace(/\/$/, "");

  if (!token) throw new Error("GP Connect sem token: configure em Configurações.");

  let res: Response;
  try {
    res = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (e) {
    throw new Error(`GP Connect inacessível (${baseUrl}): ${String(e).slice(0, 120)}`);
  }

  const text = await res.text();
  if (!res.ok) throw new Error(`GP Connect ${res.status}: ${text.slice(0, 300)}`);

  // a API responde 200 mesmo em alguns erros de negócio — inspecionamos o corpo
  let json: Record<string, unknown> = {};
  try { json = JSON.parse(text); } catch { /* resposta não-JSON */ }
  const message = String(json.mensagem ?? json.message ?? "");
  if (/erro|error|inv[aá]lid|n[aã]o encontrad|failed/i.test(message)) {
    throw new Error(`GP Connect recusou o envio: ${message.slice(0, 200)}`);
  }
  return json;
}

/** Telefone individual: apenas dígitos com DDI (ex.: 5511999999999). */
function cleanPhone(phone: string) {
  return phone.replace(/\D/g, "");
}

/** ID de grupo do WhatsApp: número longo terminado em @g.us. */
export function isGroupId(id: string) {
  return /^\d{10,}@g\.us$/.test(id.trim());
}

/**
 * Nome da conexão (número do WhatsApp) que a GP Connect usou para enviar.
 * Serve para conferir se o token configurado é o da conexão certa — um token
 * errado não dá erro, apenas envia por outro número.
 */
export function connectionNameFrom(response: unknown): string | null {
  const r = response as { retorno?: { ticket?: { whatsapp?: { name?: string; status?: string } } } };
  return r?.retorno?.ticket?.whatsapp?.name ?? null;
}

export const GpConnect = {
  /** Mensagem de texto em grupo do WhatsApp. */
  sendGroupMessage: (groupId: string, message: string) => {
    const id = groupId.trim();
    if (!isGroupId(id)) {
      throw new Error(`ID de grupo inválido: "${id}". Use o formato 1203...@g.us`);
    }
    return gp("/api/messages/whatsmeow/sendTextGroupPRO", {
      number: id,
      openTicket: "0",
      queueId: "0",
      body: message,
    });
  },

  /** Mensagem individual (OTP, Pix do avulso, confirmações). */
  sendTextMessage: (phone: string, message: string) => {
    const number = cleanPhone(phone);
    if (number.length < 12) throw new Error(`Telefone inválido para envio: "${phone}"`);
    return gp("/api/messages/send", {
      number,
      openTicket: "0",
      queueId: "0",
      body: message,
    });
  },
};
