"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createPlayer, updatePlayer, togglePlayerActive } from "./actions";
import Spinner from "@/components/Spinner";

export interface PlayerRow {
  id: string; name: string; phone: string; phoneRaw: string; notes: string;
  email: string; cpf: string; cpfRaw: string;
  active: boolean; teams: string[]; teamIds: string[];
}
export interface TeamOption { id: string; name: string }

export default function PlayerManager({ players, teams }: { players: PlayerRow[]; teams: TeamOption[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<PlayerRow | null>(null);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");

  const filtered = players.filter((p) =>
    p.name.toLowerCase().includes(search.toLowerCase()) || p.phone.includes(search)
  );

  function submit(formData: FormData) {
    startTransition(async () => {
      const res = editing ? await updatePlayer(editing.id, formData) : await createPlayer(formData);
      if (res?.error) { setError(res.error); return; }
      setError("");
      setShowForm(false);
      setEditing(null);
      router.refresh();
    });
  }

  function toggle(p: PlayerRow) {
    if (!confirm(p.active ? `Desativar ${p.name}? Ele não conseguirá mais confirmar presença.` : `Reativar ${p.name}?`)) return;
    startTransition(async () => {
      await togglePlayerActive(p.id, !p.active);
      router.refresh();
    });
  }

  const formVisible = showForm || editing !== null;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-bold">Jogadores</h1>
        <button className="btn btn-primary btn-sm" onClick={() => { setEditing(null); setShowForm(!showForm); setError(""); }}>
          + Novo jogador
        </button>
      </div>

      {formVisible && (
        <form key={editing?.id ?? "new"} action={submit} className="card space-y-3 p-4">
          <h2 className="font-bold">{editing ? `Editar ${editing.name}` : "Novo jogador"}</h2>
          {error && <p className="rounded-lg bg-[var(--danger-bg)] px-3 py-2 text-sm text-[var(--danger)]">{error}</p>}
          <input name="name" className="input" placeholder="Nome e sobrenome" defaultValue={editing?.name} required />
          <input name="phone" className="input" type="tel" placeholder="WhatsApp: (11) 99999-9999" defaultValue={editing?.phoneRaw} required />
          <div className="grid gap-3 sm:grid-cols-2">
            <input name="email" className="input" type="email" placeholder="E-mail (para cobranças)" defaultValue={editing?.email} />
            <input name="cpf_cnpj" className="input" inputMode="numeric" placeholder="CPF (obrigatório p/ cobrar)" defaultValue={editing?.cpfRaw} />
          </div>
          <input name="notes" className="input" placeholder="Observações (opcional)" defaultValue={editing?.notes} />

          <PlayerTypePicker teams={teams} initialTeamIds={editing?.teamIds ?? []} />
          <div className="flex flex-col gap-2 sm:flex-row">
            <button className="btn btn-primary btn-sm" disabled={pending}>{pending ? <><Spinner /> Salvando...</> : "Salvar"}</button>
            <button type="button" className="btn btn-outline btn-sm" onClick={() => { setShowForm(false); setEditing(null); }}>Cancelar</button>
          </div>
          {editing && (
            <p className="text-xs text-[var(--ink-soft)]">Ao trocar o telefone, o jogador precisará fazer login novamente pelo link público.</p>
          )}
        </form>
      )}

      <input className="input" placeholder="🔍 Buscar por nome ou telefone" value={search} onChange={(e) => setSearch(e.target.value)} />

      <div className="card divide-y divide-[var(--line)]">
        {filtered.map((p) => (
          <div key={p.id} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="font-medium">{p.name}</p>
              <p className="text-sm text-[var(--ink-soft)]">{p.phone}{p.email ? ` · ${p.email}` : ""}{p.cpf ? ` · ${p.cpf}` : ""}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {p.teams.length > 0
                ? <span className="badge badge-neutral">Mensalista: {p.teams.join(", ")}</span>
                : <span className="badge badge-neutral">Avulso</span>}
              {!p.cpfRaw && <span className="badge badge-warn" title="Sem CPF não é possível gerar cobrança">Sem CPF</span>}
              {!p.active && <span className="badge badge-danger">Inativo</span>}
              <button className="btn btn-outline btn-sm" disabled={pending} onClick={() => { setEditing(p); setShowForm(false); setError(""); window.scrollTo({ top: 0, behavior: "smooth" }); }}>Editar</button>
              <button className={`btn btn-sm ${p.active ? "btn-danger-soft" : "btn-outline"}`} disabled={pending} onClick={() => toggle(p)}>
                {p.active ? "Desativar" : "Reativar"}
              </button>
            </div>
          </div>
        ))}
        {filtered.length === 0 && <p className="p-4 text-sm text-[var(--ink-soft)]">Nenhum jogador encontrado.</p>}
      </div>
    </div>
  );
}

function PlayerTypePicker({ teams, initialTeamIds }: { teams: TeamOption[]; initialTeamIds: string[] }) {
  const [isMember, setIsMember] = useState(initialTeamIds.length > 0);
  const [selected, setSelected] = useState<string[]>(initialTeamIds);

  return (
    <div className="space-y-2 rounded-xl bg-[var(--bg)] p-3">
      <p className="text-sm font-medium">Tipo de jogador</p>
      <div className="flex gap-2">
        <button type="button" onClick={() => { setIsMember(false); setSelected([]); }}
          className={`btn btn-sm ${!isMember ? "btn-primary" : "btn-outline"}`}>Avulso</button>
        <button type="button" onClick={() => setIsMember(true)}
          className={`btn btn-sm ${isMember ? "btn-primary" : "btn-outline"}`}>Mensalista</button>
      </div>
      {isMember && (
        teams.length === 0 ? (
          <p className="text-sm text-[var(--ink-soft)]">Crie uma turma primeiro para vincular mensalistas.</p>
        ) : (
          <div className="space-y-1.5 pt-1">
            <p className="text-xs text-[var(--ink-soft)]">Mensalista de quais turmas?</p>
            {teams.map((t) => (
              <label key={t.id} className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="team_ids" value={t.id}
                  checked={selected.includes(t.id)}
                  onChange={(e) => setSelected(e.target.checked ? [...selected, t.id] : selected.filter((id) => id !== t.id))}
                  className="h-4 w-4 accent-[var(--brand)]" />
                {t.name}
              </label>
            ))}
            {selected.length === 0 && <p className="text-xs text-[var(--warn)]">Marque ao menos uma turma — ou o jogador ficará como avulso.</p>}
          </div>
        )
      )}
      <p className="text-xs text-[var(--ink-soft)]">
        {isMember
          ? "Mensalista tem vaga garantida na turma e paga mensalidade."
          : "Avulso participa quando há vaga, pagando por jogo via Pix."}
      </p>
    </div>
  );
}
