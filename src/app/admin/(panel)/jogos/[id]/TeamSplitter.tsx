"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Spinner from "@/components/Spinner";
import { balanceTeams, type BalancePlayer, type BalancedTeam } from "@/lib/balance";
import { sendTeamsToGroup, saveTeamsSplit } from "../actions";

interface Suggestion { teams: BalancedTeam[] }

function avgOf(ps: BalancePlayer[]) {
  return ps.length ? Math.round((ps.reduce((s, x) => s + x.skill, 0) / ps.length) * 10) / 10 : 0;
}

export default function TeamSplitter({ gameId, confirmed, hasWhatsApp, savedSplit }: {
  gameId: string;
  confirmed: BalancePlayer[]; // confirmados, com o nível interno
  hasWhatsApp: boolean;
  savedSplit: string[][] | null; // divisão oficial salva no jogo
}) {
  const router = useRouter();
  const byId = new Map(confirmed.map((p) => [p.id, p]));

  // reconstrói a divisão salva (ignora quem não está mais confirmado)
  const initial: BalancedTeam[] | null = savedSplit
    ? savedSplit.map((ids) => {
        const players = ids.map((id) => byId.get(id)).filter(Boolean) as BalancePlayer[];
        return { players, size: players.length, avg: avgOf(players) };
      }).filter((t) => t.players.length > 0)
    : null;

  const [perTeam, setPerTeam] = useState(6);
  const [howMany, setHowMany] = useState(3);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [official, setOfficial] = useState<BalancedTeam[] | null>(initial);
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ type: "ok" | "error"; text: string } | null>(null);

  if (confirmed.length < 2) return null;

  const teamCount = Math.max(1, Math.ceil(confirmed.length / Math.max(1, perTeam)));
  const missingFromSaved = savedSplit
    ? savedSplit.flat().filter((id) => !byId.has(id)).length
    : 0;

  function generate() {
    setMsg(null);
    const n = Math.min(5, Math.max(1, howMany));
    setSuggestions(Array.from({ length: n }, () => ({ teams: balanceTeams(confirmed, Math.max(1, perTeam)) })));
  }

  /** Escolhe a sugestão como divisão oficial e salva no jogo. */
  function choose(s: Suggestion) {
    persist(s.teams, "Divisão escolhida e salva neste jogo.");
    setSuggestions([]);
  }

  function persist(teams: BalancedTeam[], okText: string) {
    setOfficial(teams);
    startTransition(async () => {
      const res = await saveTeamsSplit(gameId, teams.map((t) => t.players.map((p) => p.id)));
      setMsg(res?.error
        ? { type: "error", text: res.error }
        : { type: "ok", text: okText });
      router.refresh();
    });
  }

  /** Ajuste manual na divisão oficial (salva automaticamente). */
  function movePlayer(playerId: string, toTeam: number) {
    if (!official) return;
    const player = byId.get(playerId);
    if (!player) return;
    const next = official.map((t) => ({ ...t, players: t.players.filter((p) => p.id !== playerId) }));
    next[toTeam].players.push(player);
    persist(next.map((t) => ({ ...t, avg: avgOf(t.players), size: t.players.length })), "Ajuste salvo.");
  }

  function send() {
    if (!official) return;
    startTransition(async () => {
      const res = await sendTeamsToGroup(gameId, official.map((t) => t.players.map((p) => p.id)));
      setMsg(res?.error
        ? { type: "error", text: res.error }
        : { type: "ok", text: "✓ Times enviados ao grupo com sucesso (só os nomes — sem as estrelas)." });
    });
  }

  const renderTeams = (teams: BalancedTeam[], editable: boolean) => (
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
                {editable && teams.length > 1 && (
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
  );

  return (
    <section className="card space-y-4 p-4">
      <h2 className="font-bold">⚖️ Dividir times</h2>
      <p className="text-sm text-[var(--ink-soft)]">
        {confirmed.length} confirmados. As estrelas são internas — o grupo vê apenas nomes e times.
      </p>

      {msg && (
        <p className={`rounded-lg px-3 py-2 text-sm ${msg.type === "ok" ? "bg-[var(--success-bg)] text-[var(--success)]" : "bg-[var(--danger-bg)] text-[var(--danger)]"}`}>
          {msg.text}
        </p>
      )}

      <div className="flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="text-sm font-medium">Jogadores por time</span>
          <input type="number" min={1} max={confirmed.length} className="input mt-1 w-24"
            value={perTeam} onChange={(e) => setPerTeam(Number(e.target.value) || 1)} />
        </label>
        <label className="block">
          <span className="text-sm font-medium">Sugestões</span>
          <input type="number" min={1} max={5} className="input mt-1 w-20"
            value={howMany} onChange={(e) => setHowMany(Number(e.target.value) || 1)} />
        </label>
        <span className="pb-2.5 text-sm text-[var(--ink-soft)]">
          = {teamCount} {teamCount === 1 ? "time" : "times"}
          {confirmed.length % perTeam !== 0 && teamCount > 1 && ` (último com ${confirmed.length - perTeam * (teamCount - 1)})`}
        </span>
        <button className="btn btn-primary btn-sm" onClick={generate}>
          {suggestions.length || official ? "🔀 Gerar novas sugestões" : "Gerar sugestões"}
        </button>
      </div>

      {suggestions.length > 0 && (
        <div className="space-y-4">
          {suggestions.map((s, si) => (
            <div key={si} className="rounded-xl border-2 border-dashed border-[var(--line)] p-3">
              <div className="mb-2 flex items-center justify-between">
                <p className="font-semibold">Sugestão {si + 1}</p>
                <button className="btn btn-success btn-sm" disabled={pending} onClick={() => choose(s)}>
                  {pending ? <Spinner size={14} /> : "✓"} Usar esta divisão
                </button>
              </div>
              {renderTeams(s.teams, false)}
            </div>
          ))}
        </div>
      )}

      {official && suggestions.length === 0 && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-semibold text-[var(--success)]">✓ Divisão oficial deste jogo (salva)</p>
          </div>
          {missingFromSaved > 0 && (
            <p className="rounded-lg bg-[var(--warn-bg)] px-3 py-2 text-xs text-[var(--warn)]">
              {missingFromSaved} jogador(es) da divisão salva não estão mais confirmados e foram retirados dos times.
            </p>
          )}
          {renderTeams(official, true)}
          <p className="text-xs text-[var(--ink-soft)]">
            Ajustes manuais são salvos automaticamente. A divisão fica vinculada a este jogo até você trocar por outra sugestão.
          </p>
          {hasWhatsApp && (
            <button className="btn btn-success btn-sm" disabled={pending} onClick={send}>
              {pending ? <><Spinner /> Enviando...</> : "📤 Enviar times ao grupo"}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
