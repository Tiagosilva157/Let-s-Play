"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addMember, removeMember, activateSubscription, cancelSubscription } from "../actions";

interface Member { id: string; name: string; phone: string; fee: number; dueDay: number; subscription: string }

const SUB_LABEL: Record<string, { label: string; cls: string }> = {
  none: { label: "Sem assinatura", cls: "badge-neutral" },
  active: { label: "Em dia", cls: "badge-success" },
  overdue: { label: "Inadimplente", cls: "badge-danger" },
  paused: { label: "Pausada", cls: "badge-warn" },
  canceled: { label: "Cancelada", cls: "badge-neutral" },
};

export default function MemberManager({ teamId, members }: { teamId: string; members: Member[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState("");

  function submit(formData: FormData) {
    startTransition(async () => {
      const res = await addMember(teamId, formData);
      if (res?.error) { setError(res.error); return; }
      setError("");
      setShowForm(false);
      router.refresh();
    });
  }

  function remove(id: string, name: string) {
    if (!confirm(`Remover ${name} dos mensalistas?`)) return;
    startTransition(async () => {
      await removeMember(id);
      router.refresh();
    });
  }

  return (
    <section className="card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-bold">Mensalistas ({members.length})</h2>
        <button className="btn btn-primary btn-sm" onClick={() => setShowForm(!showForm)}>+ Adicionar</button>
      </div>

      {showForm && (
        <form action={submit} className="mb-4 space-y-3 rounded-xl bg-[var(--bg)] p-4">
          {error && <p className="text-sm text-[var(--danger)]">{error}</p>}
          <input name="player_name" className="input" placeholder="Nome do jogador" required />
          <input name="player_phone" className="input" type="tel" placeholder="WhatsApp: (11) 99999-9999" required />
          <div className="grid grid-cols-2 gap-3">
            <input name="monthly_fee_override" className="input" type="number" step="0.01" placeholder="Valor (padrão da turma)" />
            <input name="due_day" className="input" type="number" min={1} max={28} defaultValue={10} placeholder="Dia do vencimento" />
          </div>
          <button className="btn btn-primary btn-sm" disabled={pending}>{pending ? "Salvando..." : "Adicionar mensalista"}</button>
        </form>
      )}

      <ul className="divide-y divide-[var(--line)]">
        {members.map((m) => (
          <li key={m.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-medium">{m.name}</p>
              <p className="text-sm text-[var(--ink-soft)]">{m.phone} · R$ {Number(m.fee).toFixed(2)} · vence dia {m.dueDay}</p>
            </div>
            <div className="flex items-center gap-2">
              <span className={`badge ${SUB_LABEL[m.subscription]?.cls ?? "badge-neutral"}`}>{SUB_LABEL[m.subscription]?.label ?? m.subscription}</span>
              {["none", "canceled"].includes(m.subscription) ? (
                <button className="btn btn-outline btn-sm" disabled={pending}
                  onClick={() => startTransition(async () => {
                    const res = await activateSubscription(m.id);
                    if (res?.error) setError(res.error); else router.refresh();
                  })}>Cobrar mensalidade</button>
              ) : (
                <button className="btn btn-outline btn-sm" disabled={pending}
                  onClick={() => {
                    if (!confirm(`Cancelar a assinatura de ${m.name}?`)) return;
                    startTransition(async () => {
                      const res = await cancelSubscription(m.id);
                      if (res?.error) setError(res.error); else router.refresh();
                    });
                  }}>Cancelar assinatura</button>
              )}
              <button className="btn btn-danger-soft btn-sm" onClick={() => remove(m.id, m.name)} disabled={pending}>Remover</button>
            </div>
          </li>
        ))}
        {members.length === 0 && <p className="py-2 text-sm text-[var(--ink-soft)]">Nenhum mensalista ainda.</p>}
      </ul>
    </section>
  );
}
