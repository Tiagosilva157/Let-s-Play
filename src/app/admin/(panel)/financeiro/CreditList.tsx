"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { revokeCredit, refundCreditInCash } from "./actions";
import Spinner from "@/components/Spinner";

export interface CreditRow {
  id: string; playerName: string; teamName: string; amount: number;
  status: string; reason: string; createdAt: string; usedGameDate: string | null;
  originGameDate: string | null; // jogo em que o pagamento foi feito
  refundable: boolean;           // tem pagamento no Asaas para devolver em dinheiro
}

const CREDIT_LABEL: Record<string, { label: string; cls: string }> = {
  available: { label: "Disponível", cls: "badge-success" },
  used: { label: "Usado", cls: "badge-neutral" },
  revoked: { label: "Revogado", cls: "badge-danger" },
};

const fmtDate = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString("pt-BR");

export default function CreditList({ credits }: { credits: CreditRow[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ type: "ok" | "error"; text: string } | null>(null);
  const [onlyAvailable, setOnlyAvailable] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  if (credits.length === 0) return null;

  // resumo por jogador (só o que está em aberto)
  const byPlayer = new Map<string, { count: number; total: number }>();
  for (const c of credits) {
    if (c.status !== "available") continue;
    const cur = byPlayer.get(c.playerName) ?? { count: 0, total: 0 };
    byPlayer.set(c.playerName, { count: cur.count + 1, total: cur.total + c.amount });
  }
  const availableTotal = [...byPlayer.values()].reduce((s, v) => s + v.total, 0);

  const shown = (onlyAvailable ? credits.filter((c) => c.status === "available") : credits)
    .slice()
    .sort((a, b) => a.playerName.localeCompare(b.playerName, "pt-BR") || b.createdAt.localeCompare(a.createdAt));

  function act(id: string, fn: () => Promise<{ error?: string; note?: string } | undefined>, okText: string) {
    setMsg(null);
    setBusyId(id);
    startTransition(async () => {
      const res = await fn();
      setBusyId(null);
      if (res?.error) { setMsg({ type: "error", text: res.error }); return; }
      setMsg({ type: "ok", text: res?.note ?? okText });
      router.refresh();
    });
  }

  return (
    <section className="card p-4">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-bold">🎫 Créditos de jogadores</h2>
        {availableTotal > 0 && (
          <span className="text-sm text-[var(--ink-soft)]">R$ {availableTotal.toFixed(2)} em aberto</span>
        )}
      </div>
      <p className="mb-3 text-xs text-[var(--ink-soft)]">
        Crédito disponível é usado automaticamente na próxima vez que o jogador garantir vaga — a presença é confirmada sem Pix.
        Se ele preferir o dinheiro, use <b>Estornar em dinheiro</b>: o Pix volta pelo Asaas e o crédito deixa de valer.
      </p>

      {byPlayer.size > 0 && (
        <div className="mb-3 flex flex-wrap gap-2">
          {[...byPlayer.entries()].sort((a, b) => a[0].localeCompare(b[0], "pt-BR")).map(([name, v]) => (
            <span key={name} className="badge badge-neutral">
              {name}: {v.count} {v.count === 1 ? "crédito" : "créditos"} · R$ {v.total.toFixed(2)}
            </span>
          ))}
        </div>
      )}

      {msg && (
        <p className={`mb-3 rounded-lg px-3 py-2 text-sm ${msg.type === "ok" ? "bg-[var(--success-bg)] text-[var(--success)]" : "bg-[var(--danger-bg)] text-[var(--danger)]"}`}>
          {msg.text}
        </p>
      )}

      <label className="mb-2 flex items-center gap-2 text-sm">
        <input type="checkbox" className="h-4 w-4 accent-[var(--brand)]" checked={onlyAvailable} onChange={(e) => setOnlyAvailable(e.target.checked)} />
        Mostrar só os disponíveis
      </label>

      <ul className="divide-y divide-[var(--line)]">
        {shown.map((c) => {
          const st = CREDIT_LABEL[c.status] ?? { label: c.status, cls: "badge-neutral" };
          const busy = pending && busyId === c.id;
          return (
            <li key={c.id} className="flex flex-col gap-1 py-2.5 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="truncate font-medium">{c.playerName}</p>
                <p className="text-xs text-[var(--ink-soft)]">
                  {c.teamName}
                  {c.originGameDate ? ` · pagamento do jogo de ${fmtDate(c.originGameDate)}` : ""}
                  {c.reason ? ` · ${c.reason}` : ""}
                  {" · gerado em "}{new Date(c.createdAt).toLocaleDateString("pt-BR")}
                  {c.status === "used" && c.usedGameDate ? ` · usado no jogo de ${fmtDate(c.usedGameDate)}` : ""}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">R$ {c.amount.toFixed(2)}</span>
                <span className={`badge ${st.cls}`}>{st.label}</span>
                {c.status === "available" && c.refundable && (
                  <button className="btn btn-outline btn-sm" disabled={pending}
                    onClick={() => {
                      if (!confirm(`Devolver R$ ${c.amount.toFixed(2)} em dinheiro para ${c.playerName}?\n\nO Pix volta pelo Asaas e este crédito deixa de valer.`)) return;
                      act(c.id, () => refundCreditInCash(c.id), "Estorno concluído — o crédito foi cancelado.");
                    }}>{busy ? <Spinner size={14} /> : "💸"} Estornar em dinheiro</button>
                )}
                {c.status === "available" && (
                  <button className="btn btn-outline btn-sm" disabled={pending}
                    onClick={() => {
                      if (!confirm(`Revogar o crédito de R$ ${c.amount.toFixed(2)} de ${c.playerName}? Ele deixará de valer (sem devolução).`)) return;
                      act(c.id, () => revokeCredit(c.id), "Crédito revogado.");
                    }}>{busy ? <Spinner size={14} /> : "Revogar"}</button>
                )}
              </div>
            </li>
          );
        })}
        {shown.length === 0 && <li className="py-2 text-sm text-[var(--ink-soft)]">Nenhum crédito disponível no momento.</li>}
      </ul>
    </section>
  );
}
