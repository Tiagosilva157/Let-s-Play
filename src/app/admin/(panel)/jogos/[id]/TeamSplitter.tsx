"use client";

import { useState, useTransition } from "react";
import Spinner from "@/components/Spinner";
import { balanceTeams, type BalancePlayer, type BalancedTeam } from "@/lib/balance";
import { sendTeamsToGroup } from "../actions";

export default function TeamSplitter({ gameId, confirmed, hasWhatsApp }: {
  gameId: string;
  confirmed: BalancePlayer[]; // jogadores confirmados, com o nível interno
  hasWhatsApp: boolean;
}) {
  const [perTeam, setPerTeam] = useState(6);
  const [teams, setTeams] = useState<BalancedTeam[] | null>(null);
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ type: "ok" | "error"; text: string } | null>(null);

  if (confirmed.length < 2) return null;

  const teamCount = Math.max(1, Math.ceil(confirmed.length / Math.max(1, perTeam)));

  function split() {
    setMsg(null);
    setTeams(balanceTeams(confirmed, Math.max(1, perTeam)));
  }

  /** Ajuste manual: move o jogador para outro time. */
  function movePlayer(playerId: string, toTeam: number) {
    if (!teams) return;
    const next = teams.map((t) => ({ ...t, players: t.players.filter((p) => p.id !== playerId) }));
    const player = confirmed.find((p) => p.id === playerId);
    if (!player) return;
    next[toTeam].players.push(player);
    setTeams(next.map((t) => ({
      ...t,
      avg: t.players.length
        ? Math.round((t.players.reduce((s, x) => s + x.skill, 0) / t.players.length) * 10) / 10
        : 0,
    })));
  }

  function send() {
    if (!teams) return;
    startTransition(async () => {
      const res = await sendTeamsToGroup(gameId, teams.map((t) => t.players.map((p) => p.id)));
      setMsg(res?.error ? { type: "error", text: res.error } : { type: "ok", text: "Times enviados ao grupo! (sem as estrelas — só os nomes)" });
    });
  }

  return (
    <section className="card space-y-3 p-4">
      <h2 className="font-bold">⚖️ Dividir times</h2>
      <p className="text-sm text-[var(--ink-soft)]">
        {confirmed.length} confirmados. A divisão equilibra os níveis técnicos (estrelas internas) — o grupo vê apenas os nomes.
      </p>

      <div className="flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="text-sm font-medium">Jogadores por time</span>
          <input type="number" min={1} max={confirmed.length} className="input mt-1 w-28"
            value={perTeam} onChange={(e) => setPerTeam(Number(e.target.value) || 1)} />
        </label>
        <span className="pb-2.5 text-sm text-[var(--ink-soft)]">
          = {teamCount} {teamCount === 1 ? "time" : "times"}
          {confirmed.length % perTeam !== 0 && teamCount > 1 && ` (último com ${confirmed.length - perTeam * (teamCount - 1)})`}
        </span>
        <button className="btn btn-primary btn-sm" onClick={split}>
          {teams ? "🔀 Reorganizar times" : "Dividir times"}
        </button>
      </div>

      {msg && (
        <p className={`rounded-lg px-3 py-2 text-sm ${msg.type === "ok" ? "bg-[var(--success-bg)] text-[var(--success)]" : "bg-[var(--danger-bg)] text-[var(--danger)]"}`}>
          {msg.text}
        </p>
      )}

      {teams && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {teams.map((t, ti) => (
              <div key={ti} className="rounded-xl border border-[var(--line)] bg-[var(--bg)] p-3">
                <p className="mb-2 flex items-center justify-between font-semibold">
                  <span>Time {ti + 1} ({t.players.length})</span>
                  <span className="text-xs font-normal text-[#f5a623]" title="Força média (interno)">★ {t.avg.toFixed(1)}</span>
                </p>
                <ul className="space-y-1.5">
                  {t.players.map((p) => (
                    <li key={p.id} className="flex items-center justify-between gap-2 text-sm">
                      <span className="min-w-0 truncate">
                        {p.name} <span className="text-xs text-[#f5a623]">{"★".repeat(p.skill)}</span>
                      </span>
                      {teams.length > 1 && (
                        <select
                          className="shrink-0 rounded-lg border border-[var(--line)] bg-[var(--surface)] px-1.5 py-0.5 text-xs"
                          value={ti}
                          onChange={(e) => movePlayer(p.id, Number(e.target.value))}
                          aria-label={`Mover ${p.name} de time`}
                        >
                          {teams.map((_, i) => <option key={i} value={i}>Time {i + 1}</option>)}
                        </select>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <p className="text-xs text-[var(--ink-soft)]">
            As estrelas e a força média aparecem só para você. Ajuste manualmente movendo jogadores entre os times, se quiser.
          </p>
          {hasWhatsApp && (
            <button className="btn btn-success btn-sm" disabled={pending} onClick={send}>
              {pending ? <><Spinner /> Enviando...</> : "📤 Enviar times ao grupo"}
            </button>
          )}
        </>
      )}
    </section>
  );
}
