"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { adminConfirm, adminRemove, cancelGame, toggleList, sendListNow, resolvePendingReview } from "../actions";

interface Participant {
  id: string; playerId: string; name: string; phone: string;
  kind: "member" | "dropin"; status: string; chargeStatus: string | null;
}
interface Game {
  id: string; teamName: string; date: string; time: string; status: string;
  capacity: number; hasWhatsApp: boolean;
}

const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  invited: { label: "Aguardando resposta", cls: "badge-warn" },
  confirmed: { label: "Confirmado", cls: "badge-success" },
  declined: { label: "Não vai", cls: "badge-neutral" },
  reserved: { label: "Aguardando Pix", cls: "badge-warn" },
  waitlist: { label: "Lista de espera", cls: "badge-neutral" },
  withdrawn: { label: "Desistiu", cls: "badge-neutral" },
  no_show: { label: "Faltou", cls: "badge-danger" },
  removed: { label: "Removido", cls: "badge-neutral" },
  pending_review: { label: "Pagou sem vaga — decidir", cls: "badge-danger" },
};

export default function GameManager({ game, participants }: { game: Game; participants: Participant[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState("");

  const confirmed = participants.filter((p) => p.status === "confirmed");
  const invited = participants.filter((p) => p.status === "invited");
  const others = participants.filter((p) => !["confirmed", "invited"].includes(p.status) && p.status !== "removed");

  function run(fn: () => Promise<unknown>, successMsg?: string) {
    startTransition(async () => {
      const res = (await fn()) as { error?: string } | undefined;
      if (res?.error) { setMsg(res.error); return; }
      if (successMsg) setMsg(successMsg);
      router.refresh();
    });
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold">{game.teamName}</h1>
        <p className="text-sm text-[var(--ink-soft)]">
          {new Date(`${game.date}T12:00:00`).toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "2-digit" })} · {game.time.slice(0, 5)} · {confirmed.length}/{game.capacity} confirmados
        </p>
      </div>

      {msg && <p className="rounded-lg bg-[var(--success-bg)] px-3 py-2 text-sm text-[var(--success)]">{msg}</p>}

      <div className="flex flex-wrap gap-2">
        {game.status === "scheduled" && (
          <button className="btn btn-primary btn-sm" disabled={pending} onClick={() => run(() => toggleList(game.id, true))}>Abrir lista agora</button>
        )}
        {game.status === "open" && (
          <button className="btn btn-outline btn-sm" disabled={pending} onClick={() => run(() => toggleList(game.id, false))}>Fechar lista</button>
        )}
        {game.status === "closed" && (
          <button className="btn btn-outline btn-sm" disabled={pending} onClick={() => run(() => toggleList(game.id, true))}>Reabrir lista</button>
        )}
        {game.hasWhatsApp && (
          <button className="btn btn-outline btn-sm" disabled={pending}
            onClick={() => run(() => sendListNow(game.id), "Lista enviada ao grupo!")}>📤 Enviar lista ao grupo</button>
        )}
        {game.status !== "canceled" && (
          <button className="btn btn-danger-soft btn-sm" disabled={pending}
            onClick={() => {
              const reason = prompt("Motivo do cancelamento (opcional):");
              if (reason !== null) run(() => cancelGame(game.id, reason));
            }}>Cancelar jogo</button>
        )}
      </div>

      <Section title={`Confirmados (${confirmed.length})`}>
        {confirmed.map((p) => (
          <Row key={p.id} p={p} pending={pending}
            actions={<button className="btn btn-danger-soft btn-sm" onClick={() => run(() => adminRemove(game.id, p.playerId))}>Remover</button>} />
        ))}
      </Section>

      {invited.length > 0 && (
        <Section title={`Mensalistas sem resposta (${invited.length})`}>
          {invited.map((p) => (
            <Row key={p.id} p={p} pending={pending}
              actions={<button className="btn btn-outline btn-sm" onClick={() => run(() => adminConfirm(game.id, p.playerId, "member"))}>Confirmar</button>} />
          ))}
        </Section>
      )}

      {others.length > 0 && (
        <Section title="Outros">
          {others.map((p) => (
            <Row key={p.id} p={p} pending={pending}
              actions={
                p.status === "pending_review" ? (
                  <div className="flex gap-1">
                    <button className="btn btn-outline btn-sm" onClick={() => run(() => resolvePendingReview(p.id, "credit"), "Crédito gerado.")}>Crédito</button>
                    <button className="btn btn-outline btn-sm" onClick={() => run(() => resolvePendingReview(p.id, "refund"), "Estorno solicitado.")}>Estornar</button>
                  </div>
                ) : ["waitlist", "declined", "withdrawn"].includes(p.status) ? (
                  <button className="btn btn-outline btn-sm" onClick={() => run(() => adminConfirm(game.id, p.playerId, p.kind))}>Confirmar manualmente</button>
                ) : null
              } />
          ))}
        </Section>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="card p-4">
      <h2 className="mb-2 font-bold">{title}</h2>
      <ul className="divide-y divide-[var(--line)]">{children}</ul>
    </section>
  );
}

function Row({ p, actions }: { p: Participant; pending: boolean; actions: React.ReactNode }) {
  const st = STATUS_LABEL[p.status] ?? { label: p.status, cls: "badge-neutral" };
  return (
    <li className="flex flex-col gap-2 py-2.5 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="truncate font-medium">{p.name} <span className="text-xs text-[var(--ink-soft)]">({p.kind === "member" ? "mensalista" : "avulso"})</span></p>
        <p className="text-xs text-[var(--ink-soft)]">{p.phone}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className={`badge ${st.cls}`}>{st.label}</span>
        {actions}
      </div>
    </li>
  );
}
