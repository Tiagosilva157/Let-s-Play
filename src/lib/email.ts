// E-mail transacional via Resend (API REST, sem SDK). Chave em RESEND_API_KEY;
// remetente em RESEND_FROM (padrão: domínio de teste do Resend, que só entrega
// para o e-mail do dono da conta).
export async function sendEmail(opts: { to: string; subject: string; html: string; text?: string }) {
  const key = (process.env.RESEND_API_KEY ?? "").trim();
  if (!key) throw new Error("RESEND_API_KEY não configurada");
  const from = (process.env.RESEND_FROM ?? "Let's Play <onboarding@resend.dev>").trim();
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: [opts.to], subject: opts.subject, html: opts.html, text: opts.text }),
    signal: AbortSignal.timeout(15_000),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`Resend ${res.status}: ${body.slice(0, 200)}`);
  return JSON.parse(body) as { id: string };
}

export function maskEmail(email: string) {
  const [u, d] = email.split("@");
  if (!d) return "***";
  return `${u.slice(0, 1)}***@${d}`;
}
