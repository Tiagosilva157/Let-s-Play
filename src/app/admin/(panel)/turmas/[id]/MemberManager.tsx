"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addMember, addMembersFromPlayers, removeMember, activateSubscription, cancelSubscription } from "../actions";
import Spinner from "@/components/Spinner";

interface Member { id: string; name: string; phone: string; fee: number; dueDay: number; subscription: string }
export interface AvailablePlayer { id: string; name: string; phone: string; hasCpf: boolean }

const SUB_LABEL: Record<string, { label: string; cls: string }> = {
  none: { label: "Sem assinatura", cls: "badge-neutral" },
  active: { label: "Em dia", cls: "badge-success" },
  overdue: { label: "Inadimplente", cls: "badge-danger" },
  paused: { label: "Pausada", cls: "badge-warn" },
  canceled: { label: "Cancelada", cls: "badge-neutral" },
};

export default function MemberManager({ teamId, members, availablePlayers }: {
  teamId: string; members: Member[]; availablePlayers: AvailablePlayer[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [showForm, setShowForm] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [pickerSearch, setPickerSearch] = useState("");
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");

  const filteredAvailable = availablePlayers.filter((p) =>
    p.name.toLowerCase().includes(pickerSearch.toLowerCase()) || p.phone.includes(pickerSearch)
  );

  function addSelected() {
    startTransition(async () => {
      const res = await addMembersFromPlayers(teamId, selected);
      if (res?.error) { setError(res.error); return; }
      setError("");
      setOk(`${res.added} jogador(es) adicionados como mensalistas.`);
      setSelected([]);
      setShowPicker(false);
      router.refresh();
    });
  }

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
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="font-bold">Mensalistas ({members.length})</h2>
        <div className="flex flex-wrap gap-2">
          <button className="btn btn-primary btn-sm"
            onClick={() => { setShowPicker(!showPicker); setShowForm(false); setError(""); setOk(""); }}>
            ☑ Escolher da lista
          </button>
          <button className="btn btn-outline btn-sm"
            onClick={() => { setShowForm(!showForm); setShowPicker(false); setError(""); setOk(""); }}>
            + Cadastrar novo
          </button>
        </div>
      </div>

      {/* mensagens sempre visíveis — inclusive as do botão "Cobrar mensalidade" */}
      {ok && (
        <p className="mb-3 rounded-lg bg-[var(--success-bg)] px-3 py-2 text-sm text-[var(--success)]">{ok}</p>
      )}
      {error && (
        <p className="mb-3 rounded-lg bg-[var(--danger-bg)] px-3 py-2 text-sm text-[var(--danger)]">{error}</p>
      )}

      {showPicker && (
        <div className="mb-4 space-y-3 rounded-xl bg-[var(--bg)] p-4">
          <p className="text-sm font-medium">Marque os jogadores que passam a ser mensalistas desta turma:</p>
          {availablePlayers.length === 0 ? (
            <p className="text-sm text-[var(--ink-soft)]">Todos os jogadores cadastrados já são mensalistas desta turma.</p>
          ) : (
            <>
              <input className="input" placeholder="🔍 Buscar jogador" value={pickerSearch}
                onChange={(e) => setPickerSearch(e.target.value)} />
              <div className="max-h-64 space-y-1 overflow-y-auto">
                {filteredAvailable.map((p) => (
                  <label key={p.id} className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 hover:bg-[var(--surface)]">
                    <input type="checkbox" className="h-4 w-4 shrink-0 accent-[var(--brand)]"
                      checked={selected.includes(p.id)}
                      onChange={(e) => setSelected(e.target.checked ? [...selected, p.id] : selected.filter((id) => id !== p.id))} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{p.name}</span>
                      <span className="block text-xs text-[var(--ink-soft)]">{p.phone}</span>
                    </span>
                    {!p.hasCpf && <span className="badge badge-warn shrink-0">Sem CPF</span>}
                  </label>
                ))}
                {filteredAvailable.length === 0 && <p className="px-2 text-sm text-[var(--ink-soft)]">Nenhum jogador encontrado.</p>}
              </div>
              <p className="text-xs text-[var(--ink-soft)]">
                Eles entram com o valor padrão da turma e vencimento dia 10 — dá para ajustar depois, antes de cobrar.
              </p>
              <button className="btn btn-primary btn-sm" disabled={pending || selected.length === 0} onClick={addSelected}>
                {pending ? <><Spinner /> Adicionando...</> : `Adicionar ${selected.length || ""} como mensalista${selected.length === 1 ? "" : "s"}`}
              </button>
            </>
          )}
        </div>
      )}

      {showForm && (
        <form action={submit} className="mb-4 space-y-3 rounded-xl bg-[var(--bg)] p-4">
          <input name="player_name" className="input" placeholder="Nome do jogador" required />
          <input name="player_phone" className="input" type="tel" placeholder="WhatsApp: (11) 99999-9999" required />
          <div className="grid gap-3 sm:grid-cols-2">
            <input name="player_email" className="input" type="email" placeholder="E-mail (para cobranças)" />
            <input name="player_cpf" className="input" inputMode="numeric" placeholder="CPF (obrigatório p/ cobrar)" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <input name="monthly_fee_override" className="input" type="number" step="0.01" placeholder="Valor (padrão da turma)" />
            <input name="due_day" className="input" type="number" min={1} max={28} defaultValue={10} placeholder="Dia do vencimento" />
          </div>
          <button className="btn btn-primary btn-sm" disabled={pending}>{pending ? <><Spinner /> Salvando...</> : "Adicionar mensalista"}</button>
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
