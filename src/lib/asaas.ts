// Cliente Asaas — usado somente no servidor.
// Docs: https://docs.asaas.com/reference/comece-por-aqui
// Token e ambiente vêm do painel (Configurações) com fallback para env vars.
import { getAsaasConfig } from "@/lib/settings";

async function asaas<T>(path: string, init?: RequestInit): Promise<T> {
  const cfg = await getAsaasConfig();
  if (!cfg.apiKey) throw new Error("Asaas não configurado: defina a chave de API em Configurações.");
  const baseUrl = cfg.env === "production"
    ? "https://api.asaas.com/v3"
    : "https://api-sandbox.asaas.com/v3";
  const res = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      access_token: cfg.apiKey,
      ...init?.headers,
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Asaas ${res.status} ${path}: ${body}`);
  }
  return res.json() as Promise<T>;
}

export interface AsaasCustomer { id: string; name: string; mobilePhone?: string }
export interface AsaasPayment {
  id: string; status: string; value: number; dueDate: string;
  invoiceUrl?: string;
}
export interface AsaasPixQr { encodedImage: string; payload: string; expirationDate?: string }

export const Asaas = {
  createCustomer: (data: { name: string; mobilePhone: string; cpfCnpj?: string; externalReference?: string }) =>
    asaas<AsaasCustomer>("/customers", { method: "POST", body: JSON.stringify(data) }),

  createPixPayment: (data: {
    customer: string; value: number; dueDate: string; description: string; externalReference: string;
  }) =>
    asaas<AsaasPayment>("/payments", {
      method: "POST",
      body: JSON.stringify({ ...data, billingType: "PIX" }),
    }),

  getPixQr: (paymentId: string) => asaas<AsaasPixQr>(`/payments/${paymentId}/pixQrCode`),

  getPayment: (paymentId: string) => asaas<AsaasPayment>(`/payments/${paymentId}`),

  cancelPayment: (paymentId: string) =>
    asaas<{ deleted: boolean }>(`/payments/${paymentId}`, { method: "DELETE" }),

  refundPayment: (paymentId: string) =>
    asaas<AsaasPayment>(`/payments/${paymentId}/refund`, { method: "POST", body: "{}" }),

  createSubscription: (data: {
    customer: string; value: number; nextDueDate: string; description: string; externalReference: string;
  }) =>
    asaas<{ id: string; status: string }>("/subscriptions", {
      method: "POST",
      body: JSON.stringify({ ...data, billingType: "PIX", cycle: "MONTHLY" }),
    }),

  updateSubscription: (id: string, data: Partial<{ value: number; status: "ACTIVE" | "INACTIVE" }>) =>
    asaas<{ id: string }>(`/subscriptions/${id}`, { method: "PUT", body: JSON.stringify(data) }),

  cancelSubscription: (id: string) =>
    asaas<{ deleted: boolean }>(`/subscriptions/${id}`, { method: "DELETE" }),

  // Cria o webhook via API (rodar uma vez no setup)
  createWebhook: (data: { url: string; authToken: string; email: string }) =>
    asaas<{ id: string }>("/webhooks", {
      method: "POST",
      body: JSON.stringify({
        name: "volei-manager",
        url: data.url,
        email: data.email,
        enabled: true,
        interrupted: false,
        apiVersion: 3,
        authToken: data.authToken,
        sendType: "SEQUENTIALLY",
        events: [
          "PAYMENT_CREATED", "PAYMENT_RECEIVED", "PAYMENT_CONFIRMED",
          "PAYMENT_OVERDUE", "PAYMENT_REFUNDED", "PAYMENT_DELETED",
          "PAYMENT_UPDATED",
        ],
      }),
    }),
};
