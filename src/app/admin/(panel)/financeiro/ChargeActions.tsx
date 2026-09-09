"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cancelCharge, restoreCharge } from "./actions";
import Spinner from "@/components/Spinner";

/** Botões de cancelar / restaurar cobrança, com resultado na própria linha. */
export default function ChargeActions({ chargeId, status, playerName, amount, type }: {
  chargeId: string; status: string; playerName: string; amount: number; type: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ type: "ok" | "error"; text: string } | null>(null);

  const canCancel = status === "pending" || status === "overdue";
  const canRestore = status === "canceled";
  if (!canCancel && !canRestore) return null;

  function run(fn: () => Promise<{ error?: string; note?: string } | undefined>, okText: string) {
    setMsg(null);
    startTransition(async () => {
      const res = await fn();
      if (res?.error) { setMsg({ type: "error", text: res.error }); return; }
      setMsg({ type: "ok", text: res?.note ?? okText });
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      {canCancel && (
        <button className="btn btn-danger-soft btn-sm" disabled={pending}
          onClick={() => {
            const reason = prompt(
              `Cancelar a cobrança de R$ ${amount.toFixed(2)} de ${playerName}?\n\n` +
              `• Cancela no Asaas — o Pix deixa de valer\n` +
              (type === "dropin" ? `• A vaga do jogo é liberada\n` : `• A assinatura continua; só esta parcela é cancelada\n`) +
              `• Dá para restaurar depois, se for engano\n\nMotivo (opcional):`,
              "Pago em dinheiro"
            );
            if (reason === null) return;
            run(() => cancelCharge(chargeId, reason), "Cobrança cancelada.");
          }}>
          {pending ? <Spinner size={14} /> : "✕"} Cancelar cobrança
        </button>
      )}
      {canRestore && (
        <button className="btn btn-outline btn-sm" disabled={pending}
          onClick={() => {
            if (!confirm(`Restaurar a cobrança de R$ ${amount.toFixed(2)} de ${playerName}? Ela volta a valer com o mesmo Pix.`)) return;
            run(() => restoreCharge(chargeId), "Cobrança restaurada.");
          }}>
          {pending ? <Spinner size={14} /> : "♻️"} Restaurar
        </button>
      )}
      {msg && (
        <span className={`text-xs ${msg.type === "ok" ? "text-[var(--success)]" : "text-[var(--danger)]"}`}>{msg.text}</span>
      )}
    </div>
  );
}
