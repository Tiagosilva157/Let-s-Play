"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { adminConfirm, adminRemove, adminAddPlayer, cancelGame, toggleList, sendListNow, resolvePendingReview, resetGame, restoreGame, backToScheduled } from "../actions";
import Spinner from "@/components/Spinner";

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
  withdrawn_paid: { label: "Desistiu já pago — decidir", cls: "badge-danger" },
  no_show: { label: "Faltou", cls: "badge-danger" },
  removed: { label: "Removido", cls: "badge-neutral" },
  pending_review: { label: "Pagou sem vaga — decidir", cls: "badge-danger" },
};

const ACTION_LABEL: Record<string, string> = {
  open_list: "Lista aberta",
  close_list: "Lista fechada",
  cancel_game: "Jogo cancelado",
  restore_game: "Jogo restaurado",
  back_to_scheduled: "Voltou para Agendado (disparo automático reativado)",
  reset_game: "Lista resetada",
  save_teams_split: "Divisão de times salva",
  send_teams: "Times enviados ao grupo",
};

interface Addable { id: string; name: string; phone: string; isMember: boolean }

export default function GameManager({ game, participants, addable = [], splitter, history }: { game: Game; participants: Participant[]; addable?: Addable[]; splitter?: React.ReactNode; history?: { action: string; at: string }[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ type: "ok" | "error"; text: string } | null>(null);
  const [search, setSearch] = useState("");

  const confirmed = participants.filter((p) => p.status === "confirmed");
  const invited = participants.filter((p) => p.status === "invited");
  const others = participants.filter((p) => !["confirmed", "invited"].includes(p.status) && p.status !== "removed");

  function run(fn: () => Promise<unknown>, successMsg?: string) {
    setMsg(null);
    startTransition(async () => {
      const res = (await fn()) as { error?: string; note?: string } | undefined;
      if (res?.error) { setMsg({ type: "error", text: res.error }); return; }
      if (res?.note) setMsg({ type: "ok", text: res.note });
      else if (successMsg) setMsg({ type: "ok", text: successMsg });
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

      {msg && (
        <p className={`rounded-lg px-3 py-2 text-sm ${msg.type === "ok" ? "bg-[var(--success-bg)] text-[var(--success)]" : "bg-[var(--danger-bg)] text-[var(--danger)]"}`}>
          {msg.text}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {game.status === "scheduled" && (
          <button className="btn btn-primary btn-sm" disabled={pending} onClick={() => run(() => toggleList(game.id, true))}>{pending && <Spinner size={14} />} Abrir lista agora</button>
        )}
        {game.status === "open" && (
          <button className="btn btn-outline btn-sm" disabled={pending} onClick={() => run(() => toggleList(game.id, false))}>{pending && <Spinner size={14} />} Fechar lista</button>
        )}
        {game.status === "closed" && (
          <button className="btn btn-outline btn-sm" disabled={pending} onClick={() => run(() => toggleList(game.id, true))}>{pending && <Spinner size={14} />} Reabrir lista</button>
        )}
        {["closed", "open"].includes(game.status) && (
          <button className="btn btn-outline btn-sm" disabled={pending} title="Devolve o jogo ao disparo automático: a lista abre sozinha na hora certa"
            onClick={() => run(() => backToScheduled(game.id))}>{pending && <Spinner size={14} />} ↩️ Voltar para Agendado</button>
        )}
        {game.hasWhatsApp && (
          <button className="btn btn-outline btn-sm" disabled={pending}
            onClick={() => run(() => sendListNow(game.id), "Lista enviada ao grupo!")}>{pending ? <Spinner size={14} /> : "📤"} Enviar lista ao grupo</button>
        )}
        {game.status === "canceled" && (
          <button className="btn btn-primary btn-sm" disabled={pending}
            onClick={() => run(() => restoreGame(game.id), "Jogo restaurado! A lista voltou ao estado normal.")}>
            {pending && <Spinner size={14} />} ♻️ Restaurar jogo
          </button>
        )}
        {game.status !== "canceled" && participants.length > 0 && (
          <button className="btn btn-danger-soft btn-sm" disabled={pending}
            onClick={() => {
              const paid = participants.filter((p) => p.status === "confirmed" && p.kind === "dropin" && ["received", "confirmed"].includes(p.chargeStatus ?? "")).length;
              const msg = `Resetar a lista deste jogo?\n\n` +
                `• Todas as ${participants.length} participações serão apagadas\n` +
                `• Cobranças Pix pendentes serão canceladas\n` +
                (paid > 0 ? `• ATENÇÃO: ${paid} avulso(s) JÁ PAGARAM — os pagamentos ficam no Financeiro para você dar crédito ou estornar\n` : "") +
                `• Mensalistas voltam como "aguardando resposta" (se a lista estiver aberta)\n` +
                `• O grupo será avisado\n\nEssa ação não pode ser desfeita.`;
              if (confirm(msg)) run(() => resetGame(game.id), "Lista resetada.");
            }}>🔄 Resetar lista</button>
        )}
        {game.status !== "canceled" && (
          <button className="btn btn-danger-soft btn-sm" disabled={pending}
            onClick={() => {
              const reason = prompt("Motivo do cancelamento (opcional):");
              if (reason !== null) run(() => cancelGame(game.id, reason));
            }}>Cancelar jogo</button>
        )}
      </div>

      {game.status !== "canceled" && addable.length > 0 && (
        <details className="card p-4">
          <summary className="cursor-pointer text-sm font-semibold">➕ Adicionar jogador na lista</summary>
          <p className="mt-2 text-xs text-[var(--ink-soft)]">
            Coloca o jogador direto como confirmado. Avulso adicionado assim entra <b>sem cobrança</b> (ex.: pagou em dinheiro). O grupo é avisado e recebe a lista atualizada.
          </p>
          <input className="input mt-3 w-full" placeholder="Buscar por nome ou telefone..."
            value={search} onChange={(e) => setSearch(e.target.value)} />
          <ul className="mt-2 max-h-64 divide-y divide-[var(--line)] overflow-y-auto">
            {addable
              .filter((p) => !search || p.name.toLowerCase().includes(search.toLowerCase()) || p.phone.includes(search))
              .slice(0, 30)
              .map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-2 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{p.name} <span className="text-xs text-[var(--ink-soft)]">({p.isMember ? "mensalista" : "avulso"})</span></p>
                    <p className="text-xs text-[var(--ink-soft)]">{p.phone}</p>
                  </div>
                  <button className="btn btn-outline btn-sm shrink-0" disabled={pending}
                    onClick={() => run(() => adminAddPlayer(game.id, p.id), `${p.name} confirmado na lista — o grupo foi avisado.`)}>
                    {pending ? <Spinner size={14} /> : "Adicionar"}
                  </button>
                </li>
              ))}
          </ul>
        </details>
      )}

      {splitter}

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
                p.status === "pending_review" ||
                (p.status === "withdrawn" && ["received", "confirmed"].includes(p.chargeStatus ?? "")) ? (
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
      {history && history.length > 0 && (
        <details className="card p-4">
          <summary className="cursor-pointer text-sm font-semibold">🕘 Histórico de ações deste jogo</summary>
          <ul className="mt-3 space-y-1.5">
            {history.map((h, i) => (
              <li key={i} className="text-sm text-[var(--ink-soft)]">
                {new Date(h.at).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                {" — "}{ACTION_LABEL[h.action] ?? h.action}
              </li>
            ))}
          </ul>
        </details>
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
  const key = p.status === "withdrawn" && ["received", "confirmed"].includes(p.chargeStatus ?? "")
    ? "withdrawn_paid"
    : p.status;
  const st = STATUS_LABEL[key] ?? { label: p.status, cls: "badge-neutral" };
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
