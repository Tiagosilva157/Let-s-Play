"use client";

import { useState } from "react";
import Spinner from "@/components/Spinner";
import type { Situation, SituationCharge } from "@/lib/my-situation";

function money(v: number) { return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }); }
function d(s: string | null) { return s ? s.split("-").reverse().join("/") : ""; }
function refMonth(due: string | null) {
  if (!due) return "";
  const [y, m] = due.split("-");
  return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
}

const STATUS: Record<string, { label: string; cls: string }> = {
  pending: { label: "Pendente", cls: "badge-warn" }, overdue: { label: "Vencido", cls: "badge-danger" },
  received: { label: "Pago", cls: "badge-success" }, confirmed: { label: "Pago", cls: "badge-success" },
  refunded: { label: "Estornado", cls: "badge-neutral" }, canceled: { label: "Cancelado", cls: "badge-neutral" },
  expired: { label: "Expirado", cls: "badge-neutral" },
};
const METHOD: Record<string, string> = { asaas_pix: "Pix", cash: "dinheiro", pix_manual: "Pix" };

function describe(c: SituationCharge) {
  return c.type === "subscription"
    ? `Mensalidade ${c.teamName} — ${refMonth(c.dueDate)}`
    : `Jogo ${c.teamName}${c.gameDate ? ` de ${d(c.gameDate)}` : ""}`;
}

/** Bloco "Minha situação": mensalidade, pendências, créditos e histórico, com Pix na hora. */
export default function MySituation({ s }: { s: Situation }) {
  const [open, setOpen] = useState(false);
  const [pix, setPix] = useState<{ chargeId: string; qr: string; copypaste: string; amount: number } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [err, setErr] = useState("");

  async function showPix(chargeId: string) {
    setBusy(chargeId); setErr(""); setCopied(false);
    try {
      const r = await fetch("/api/public/pix", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chargeId }) });
      const j = await r.json().catch(() => null);
      if (!j?.ok) { setErr("Não foi possível carregar o Pix agora. Tente de novo em instantes."); return; }
      setPix({ chargeId, ...j.pix });
    } finally { setBusy(null); }
  }

  function copy() {
    if (!pix) return;
    navigator.clipboard.writeText(pix.copypaste);
    setCopied(true); setTimeout(() => setCopied(false), 2000);
  }

  const subLabel: Record<string, { text: string; cls: string }> = {
    active: { text: "Mensalidade em dia ✅", cls: "bg-[var(--success-bg)] text-[var(--success)]" },
    overdue: { text: "Mensalidade em atraso ⚠️", cls: "bg-[var(--danger-bg)] text-[var(--danger)]" },
    none: { text: "Mensalista sem cobrança ativa", cls: "bg-[var(--warn-bg)] text-[var(--warn)]" },
    paused: { text: "Mensalidade pausada", cls: "bg-[var(--warn-bg)] text-[var(--warn)]" },
    canceled: { text: "Mensalidade cancelada", cls: "bg-[var(--warn-bg)] text-[var(--warn)]" },
  };
  const sub = s.isMember ? subLabel[s.subscriptionStatus ?? "none"] : null;

  return (
    <div className="card p-5 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-bold">💳 Minha situação</h2>
        <span className="text-xs text-[var(--ink-soft)]">{s.isMember ? "Mensalista" : "Não mensalista"}</span>
      </div>

      {sub && <p className={`rounded-lg px-3 py-2 text-sm font-medium ${sub.cls}`}>{sub.text}</p>}

      {s.credits.length > 0 && (
        <p className="rounded-lg bg-[var(--success-bg)] px-3 py-2 text-sm text-[var(--success)]">
          🎫 Crédito disponível: <b>{money(s.credits.reduce((a, c) => a + c.amount, 0))}</b> — sua próxima vaga sai sem pagar.
        </p>
      )}

      {s.openCharges.length > 0 ? (
        <div className="space-y-2">
          <p className="text-sm font-semibold">Em aberto: {money(s.totalDue)}</p>
          {s.openCharges.map((c) => (
            <div key={c.id} className="rounded-lg border border-[var(--line)] p-3 text-sm space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-medium">{describe(c)}</p>
                  <p className="text-xs text-[var(--ink-soft)]">{c.dueDate ? `Vence ${d(c.dueDate)}` : ""}</p>
                </div>
                <div className="text-right">
                  <p className="font-semibold">{money(c.amount)}</p>
                  <span className={`badge ${STATUS[c.status]?.cls ?? "badge-neutral"}`}>{STATUS[c.status]?.label ?? c.status}</span>
                </div>
              </div>
              {c.hasPix && pix?.chargeId !== c.id && (
                <button className="btn btn-primary btn-sm w-full" disabled={busy === c.id} onClick={() => showPix(c.id)}>
                  {busy === c.id ? <Spinner size={14} /> : "📱"} Pagar com Pix
                </button>
              )}
              {pix?.chargeId === c.id && (
                <div className="space-y-2 text-center">
                  {pix.qr && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={`data:image/png;base64,${pix.qr}`} alt="QR Code Pix" className="mx-auto h-44 w-44" />
                  )}
                  <button className="btn btn-primary btn-sm w-full" onClick={copy}>{copied ? "✓ Copiado!" : "Copiar código Pix"}</button>
                  <p className="text-xs text-[var(--ink-soft)]">Cole no app do seu banco. A baixa é automática em instantes.</p>
                </div>
              )}
            </div>
          ))}
          {err && <p className="text-sm text-[var(--danger)]">{err}</p>}
        </div>
      ) : (
        <p className="text-sm text-[var(--ink-soft)]">Nenhuma pendência. 👍</p>
      )}

      {s.history.length > 0 && (
        <div>
          <button type="button" className="text-xs underline text-[var(--ink-soft)]" onClick={() => setOpen(!open)}>
            {open ? "Ocultar histórico" : `Ver histórico (${s.history.length})`}
          </button>
          {open && (
            <ul className="mt-2 divide-y divide-[var(--line)] text-sm">
              {s.history.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-2 py-1.5">
                  <div className="min-w-0">
                    <p className="truncate">{describe(c)}</p>
                    <p className="text-xs text-[var(--ink-soft)]">
                      {c.paidAt ? `pago em ${new Date(c.paidAt).toLocaleDateString("pt-BR")}${c.method ? ` (${METHOD[c.method] ?? c.method})` : ""}` : c.dueDate ? `venc. ${d(c.dueDate)}` : ""}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p>{money(c.amount)}</p>
                    <span className={`badge ${STATUS[c.status]?.cls ?? "badge-neutral"}`}>{STATUS[c.status]?.label ?? c.status}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
