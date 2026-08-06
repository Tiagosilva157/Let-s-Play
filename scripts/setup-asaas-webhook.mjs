// Cria o webhook no Asaas apontando para /api/webhooks/asaas.
// Uso: node scripts/setup-asaas-webhook.mjs
// Requer no ambiente: ASAAS_ENV, ASAAS_API_KEY, ASAAS_WEBHOOK_TOKEN, NEXT_PUBLIC_APP_URL, ADMIN_EMAIL

const BASE = process.env.ASAAS_ENV === "production"
  ? "https://api.asaas.com/v3"
  : "https://api-sandbox.asaas.com/v3";

const res = await fetch(`${BASE}/webhooks`, {
  method: "POST",
  headers: { "Content-Type": "application/json", access_token: process.env.ASAAS_API_KEY },
  body: JSON.stringify({
    name: "volei-manager",
    url: `${process.env.NEXT_PUBLIC_APP_URL}/api/webhooks/asaas`,
    email: process.env.ADMIN_EMAIL ?? "suporte@connectchannels.com.br",
    enabled: true,
    interrupted: false,
    apiVersion: 3,
    authToken: process.env.ASAAS_WEBHOOK_TOKEN,
    sendType: "SEQUENTIALLY",
    events: [
      "PAYMENT_CREATED", "PAYMENT_RECEIVED", "PAYMENT_CONFIRMED",
      "PAYMENT_OVERDUE", "PAYMENT_REFUNDED", "PAYMENT_DELETED", "PAYMENT_UPDATED",
    ],
  }),
});
console.log(res.status, await res.text());
