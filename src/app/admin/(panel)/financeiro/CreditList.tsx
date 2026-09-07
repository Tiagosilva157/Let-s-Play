"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { revokeCredit } from "./actions";
import Spinner from "@/components/Spinner";

export interface CreditRow {
  id: string; playerName: string; teamName: string; amount: number;
  status: string; reason: string; createdAt: string; usedGameDate: string | null;
}

const CREDIT_LABEL: Record<string, { label: string; cls: string }> = {
  available: { label: "Disponível", cls: "badge-success" },
  used: { label: "Usado", cls: "badge-neutral" },
  revoked: { label: "Revogado", cls: "badge-danger" },
};

export default function CreditList({ credits }: { credits: CreditRow[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");

  if (credits.length === 0) return null;
  const availableTotal = credits.filter((c) => c.status === "available").reduce((s, c) => s + Number(c.amount), 0);

  return (
    <section className="card p-4">
      <div className="mb-1 flex items-center justify-between">
        <h2 className="font-bold">🎫 Créditos de jogadores</h2>
        {availableTotal > 0 && (
          <span className="text-sm text-[var(--ink-soft)]">R$ {availableTotal.toFixed(2)} em aberto</span>
        )}
      </div>
      <p className="mb-2 text-xs text-[var(--ink-soft)]">
        Crédito disponível é usado automaticamente na próxima vez que o jogador garantir vaga — a presença é confirmada sem Pix.
      </p>
      {error && <p className="mb-2 rounded-lg bg-[var(--danger-bg)] px-3 py-2 text-sm text-[var(--danger)]">{error}</p>}
      <ul className="divide-y divide-[var(--line)]">
        {credits.map((c) => {
          const st = CREDIT_LABEL[c.status] ?? { label: c.status, cls: "badge-neutral" };
          return (
            <li key={c.id} className="flex flex-col gap-1 py-2.5 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="truncate font-medium">{c.playerName}</p>
                <p className="text-xs text-[var(--ink-soft)]">
                  {c.teamName} · {new Date(c.createdAt).toLocaleDateString("pt-BR")}
                  {c.reason ? ` · ${c.reason}` : ""}
                  {c.status === "used" && c.usedGameDate ? ` · usado no jogo de ${new Date(`${c.usedGameDate}T12:00:00`).toLocaleDateString("pt-BR")}` : ""}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="font-semibold">R$ {Number(c.amount).toFixed(2)}</span>
                <span className={`badge ${st.cls}`}>{st.label}</span>
                {c.status === "available" && (
                  <button className="btn btn-outline btn-sm" disabled={pending}
                    onClick={() => {
                      if (!confirm(`Revogar o crédito de R$ ${Number(c.amount).toFixed(2)} de ${c.playerName}? Ele deixará de valer.`)) return;
                      startTransition(async () => {
                        const res = await revokeCredit(c.id);
                        if (res?.error) { setError(res.error); return; }
                        setError("");
                        router.refresh();
                      });
                    }}>{pending ? <Spinner size={14} /> : "Revogar"}</button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
