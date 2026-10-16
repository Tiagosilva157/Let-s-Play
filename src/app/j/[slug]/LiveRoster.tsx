"use client";

import { useCallback, useEffect, useState } from "react";
import type { PublicRoster } from "@/lib/public-roster";

const POLL_MS = 15_000;

function memberMark(status: string) {
  if (status === "confirmed") return { icon: "✅", note: "", cls: "" };
  if (status === "invited") return { icon: "⏳", note: "aguardando", cls: "text-[var(--ink-soft)]" };
  return { icon: "❌", note: "não vem — vaga liberada", cls: "text-[var(--ink-soft)] line-through decoration-1" };
}

function ago(iso: string, now: number) {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 10) return "agora";
  if (s < 60) return `há ${s} s`;
  return `há ${Math.round(s / 60)} min`;
}

/**
 * Lista do jogo ao vivo — mesma estrutura da mensagem do grupo (Mensalistas /
 * Não mensalistas / Lista de espera / vagas). Atualiza sozinha a cada 15 s e
 * quando a pessoa volta para a aba; se o WhatsApp cair, a lista continua aqui.
 */
export default function LiveRoster({ gameId, initial }: { gameId: string; initial: PublicRoster | null }) {
  const [r, setR] = useState<PublicRoster | null>(initial);
  const [offline, setOffline] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/public/roster?game=${gameId}`, { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      setR(await res.json());
      setOffline(false);
    } catch {
      setOffline(true);
    }
  }, [gameId]);

  useEffect(() => {
    const tick = () => { if (document.visibilityState === "visible") load(); };
    const id = setInterval(tick, POLL_MS);
    const clock = setInterval(() => setNow(Date.now()), 5_000);
    const onVis = () => { if (document.visibilityState === "visible") load(); };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", onVis);
    // o restante da página pede atualização logo após uma ação (confirmar, pagar, desistir)
    window.addEventListener("roster:refresh", load);
    return () => {
      clearInterval(id); clearInterval(clock);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", onVis);
      window.removeEventListener("roster:refresh", load);
    };
  }, [load]);

  if (!r) return null;
  const dropinLabel = r.membersPay ? "Jogadores" : "Não mensalistas";

  return (
    <div className="card p-5 space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-bold">📋 Lista do jogo</h2>
        <span className={`flex items-center gap-1.5 text-xs ${offline ? "text-[var(--warn)]" : "text-[var(--ink-soft)]"}`}>
          <span className={`inline-block h-2 w-2 rounded-full ${offline ? "bg-[var(--warn)]" : "bg-[var(--success)] animate-pulse"}`} />
          {offline ? "sem conexão — tentando de novo" : `ao vivo · atualizada ${ago(r.updatedAt, now)}`}
        </span>
      </div>

      {!r.membersPay && (
        <section>
          <h3 className="text-sm font-semibold">Mensalistas <span className="font-normal text-[var(--ink-soft)]">({r.membersHolding} de {r.members.length} na lista)</span></h3>
          {r.members.length === 0
            ? <p className="text-sm text-[var(--ink-soft)]">nenhum mensalista cadastrado nesta turma</p>
            : (
              <ol className="mt-1 space-y-0.5 text-sm">
                {r.members.map((m, i) => {
                  const k = memberMark(m.status);
                  return (
                    <li key={i} className={k.cls}>
                      {i + 1}. {m.name} {k.icon}{k.note && <span className="text-xs italic"> ({k.note})</span>}
                    </li>
                  );
                })}
              </ol>
            )}
        </section>
      )}

      <section>
        <h3 className="text-sm font-semibold">{dropinLabel} <span className="font-normal text-[var(--ink-soft)]">({r.dropinsOccupying} de {r.dropinSlots} {r.dropinSlots === 1 ? "vaga" : "vagas"})</span></h3>
        {r.dropins.length === 0
          ? <p className="text-sm text-[var(--ink-soft)]">ninguém ainda</p>
          : (
            <ol className="mt-1 space-y-0.5 text-sm">
              {r.dropins.map((d, i) => (
                <li key={i}>
                  {i + 1}. {d.name}{" "}
                  {d.status === "confirmed"
                    ? <>✅ <span className="text-xs italic text-[var(--ink-soft)]">(pago)</span></>
                    : <>💰 <span className="text-xs italic text-[var(--warn)]">(aguardando pagamento)</span></>}
                </li>
              ))}
            </ol>
          )}
      </section>

      {r.waitlist.length > 0 && (
        <section>
          <h3 className="text-sm font-semibold">Lista de espera</h3>
          <ol className="mt-1 space-y-0.5 text-sm">
            {r.waitlist.map((w, i) => <li key={i}>{i + 1}. {w.name}</li>)}
          </ol>
        </section>
      )}

      <div className={`rounded-lg px-3 py-2 text-sm ${r.dropinSlotsFree > 0 ? "bg-[var(--success-bg)] text-[var(--success)]" : "bg-[var(--danger-bg)] text-[var(--danger)]"}`}>
        <p className="font-semibold">
          {r.dropinSlotsFree > 0
            ? (r.membersPay
              ? `🟢 Ainda ${r.dropinSlotsFree === 1 ? "cabe 1 jogador" : `cabem ${r.dropinSlotsFree} jogadores`}`
              : `🟢 Ainda ${r.dropinSlotsFree === 1 ? "cabe 1 não mensalista" : `cabem ${r.dropinSlotsFree} não mensalistas`}`)
            : "🔴 Lista completa — quem entrar agora vai para a lista de espera"}
        </p>
        <p className="text-xs opacity-90">
          {r.dropinSlotsFree > 0
            ? (r.membersPay ? "A vaga é garantida com o pagamento do Pix." : "Cada mensalista que avisar que não vem libera mais uma vaga.")
            : `Abriu vaga? O 1º da espera é avisado no WhatsApp e tem ${r.waitlistMinutes >= 60 ? `${Math.floor(r.waitlistMinutes / 60)}h${r.waitlistMinutes % 60 ? String(r.waitlistMinutes % 60).padStart(2, "0") : ""}` : `${r.waitlistMinutes} min`} para pagar o Pix.`}
        </p>
      </div>
      {!r.fullNames && <p className="text-xs text-[var(--ink-soft)]">Entre com seu telefone para ver os nomes completos.</p>}
    </div>
  );
}
