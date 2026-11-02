"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveTeam } from "./actions";
import Spinner from "@/components/Spinner";

const WEEKDAYS = ["Domingo", "Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira", "Sábado"];

export interface TeamValues {
  id?: string; name?: string; slug?: string; weekday?: number; game_time?: string;
  address?: string; capacity?: number; monthly_fee?: number; dropin_fee?: number;
  open_hours_before?: number; confirm_hours_before?: number; withdraw_hours_before?: number;
  whatsapp_group_id?: string | null; message_mode?: string; individual_channel?: string;
  due_reminder_channel?: string; due_reminder_days?: number[] | null;
  release_invited_hours_before?: number | string | null;
}

/** Converte "horas antes do jogo" de volta para dia da semana + horário do prazo. */
function deadlineFromHours(gameWeekday: number, gameTime: string, hours: number) {
  const mins = Number(gameTime.slice(0, 2)) * 60 + Number(gameTime.slice(3, 5)) - Math.round(hours * 60);
  const week = 7 * 1440;
  const abs = ((gameWeekday * 1440 + mins) % week + week) % week;
  const wd = Math.floor(abs / 1440); const m = abs % 1440;
  return { weekday: wd, time: `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}` };
}

const REMINDER_DAYS: { d: number; label: string }[] = [
  { d: 7, label: "7 dias antes" }, { d: 5, label: "5 dias antes" }, { d: 3, label: "3 dias antes" },
  { d: 2, label: "2 dias antes" }, { d: 1, label: "1 dia antes" }, { d: 0, label: "No dia do vencimento" },
];

export default function TeamForm({ team }: { team?: TeamValues }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");

  function submit(formData: FormData) {
    startTransition(async () => {
      const res = await saveTeam(team?.id ?? null, formData);
      if (res?.error) { setError(res.error); return; }
      router.push("/admin/turmas");
    });
  }

  const t = team ?? {};
  const relHours = t.release_invited_hours_before != null ? Number(t.release_invited_hours_before) : null;
  const [gameWeekday, setGameWeekday] = useState(t.weekday ?? 1);
  const [gameTime, setGameTime] = useState(t.game_time?.slice(0, 5) ?? "20:00");
  const [releaseOn, setReleaseOn] = useState(relHours != null);
  const initial = relHours != null ? deadlineFromHours(t.weekday ?? 1, t.game_time?.slice(0, 5) ?? "20:00", relHours) : { weekday: t.weekday ?? 1, time: "12:00" };
  const [relWeekday, setRelWeekday] = useState(initial.weekday);
  const [relTime, setRelTime] = useState(initial.time);
  const mins = (x: string) => Number(x.slice(0, 2)) * 60 + Number(x.slice(3, 5));
  const previewHours = (((gameWeekday * 1440 + mins(gameTime)) - (relWeekday * 1440 + mins(relTime)) + 7 * 1440) % (7 * 1440)) / 60;
  return (
    <form action={submit} className="card max-w-xl space-y-4 p-6">
      {error && <p className="rounded-lg bg-[var(--danger-bg)] px-3 py-2 text-sm text-[var(--danger)]">{error}</p>}

      <Field label="Nome da turma"><input name="name" className="input" defaultValue={t.name} placeholder="Vôlei de segunda" required /></Field>
      <Field label="Link público (letras minúsculas e hífens)">
        <input name="slug" className="input" defaultValue={t.slug} placeholder="volei-segunda" pattern="[a-z0-9-]+" required />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Dia da semana">
          <select name="weekday" className="input" value={gameWeekday} onChange={(e) => setGameWeekday(Number(e.target.value))}>
            {WEEKDAYS.map((d, i) => <option key={i} value={i}>{d}</option>)}
          </select>
        </Field>
        <Field label="Horário"><input name="game_time" type="time" className="input" value={gameTime} onChange={(e) => setGameTime(e.target.value)} required /></Field>
      </div>
      <Field label="Endereço da quadra"><input name="address" className="input" defaultValue={t.address} required /></Field>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Capacidade"><input name="capacity" type="number" className="input" defaultValue={t.capacity ?? 18} min={2} required /></Field>
        <Field label="Mensalidade (R$)"><input name="monthly_fee" type="number" step="0.01" className="input" defaultValue={t.monthly_fee ?? 60} required /></Field>
        <Field label="Avulso (R$)"><input name="dropin_fee" type="number" step="0.01" className="input" defaultValue={t.dropin_fee ?? 15} required /></Field>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Abrir lista (horas antes)"><input name="open_hours_before" type="number" className="input" defaultValue={t.open_hours_before ?? 168} required /></Field>
        <Field label="Confirmar até (horas antes)"><input name="confirm_hours_before" type="number" className="input" defaultValue={t.confirm_hours_before ?? 2} required /></Field>
        <Field label="Desistir até (horas antes)"><input name="withdraw_hours_before" type="number" className="input" defaultValue={t.withdraw_hours_before ?? 1} required /></Field>
      </div>
      <Field label="ID do grupo do WhatsApp (opcional)">
        <input name="whatsapp_group_id" className="input" defaultValue={t.whatsapp_group_id ?? ""} placeholder="Configure depois se preferir" />
      </Field>
      <Field label="Envio de mensagens ao grupo">
        <select name="message_mode" className="input" defaultValue={t.message_mode ?? "batched"}>
          <option value="instant">A cada alteração</option>
          <option value="batched">Agrupado (a cada poucos minutos)</option>
          <option value="manual">Somente manual</option>
        </select>
      </Field>
      <Field label="Avisos individuais ao jogador">
        <select name="individual_channel" className="input" defaultValue={t.individual_channel ?? "whatsapp"}>
          <option value="whatsapp">WhatsApp no privado (Pix, confirmações, créditos, mensalidade)</option>
          <option value="portal">Só pelo link (WhatsApp apenas quando sobe da lista de espera)</option>
        </select>
        <p className="mt-1 text-xs text-[var(--ink-soft)]">"Só pelo link" reduz muito o volume de mensagens do número. O grupo continua recebendo a lista normalmente.</p>
      </Field>

      <div className="card space-y-2 p-3">
        <label className="flex items-center gap-2 text-sm font-medium">
          <input type="checkbox" name="release_enabled" checked={releaseOn} onChange={(e) => setReleaseOn(e.target.checked)} />
          Prazo limite de confirmação dos mensalistas
        </label>
        <p className="text-xs text-[var(--ink-soft)]">
          Quando o prazo chega, mensalistas que ainda não responderam passam para &quot;Não vai&quot; e as vagas deles são liberadas
          (lista de espera sobe, grupo recebe a lista atualizada). Quem já confirmou não é afetado. Depois do prazo o mensalista
          ainda pode confirmar se houver vaga, ou entrar na lista de espera.
        </p>
        {releaseOn && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Dia do prazo">
              <select name="release_weekday" className="input" value={relWeekday} onChange={(e) => setRelWeekday(Number(e.target.value))}>
                {WEEKDAYS.map((w, i) => <option key={i} value={i}>{w}</option>)}
              </select>
            </Field>
            <Field label="Horário do prazo">
              <input name="release_time" type="time" className="input" value={relTime} onChange={(e) => setRelTime(e.target.value)} />
            </Field>
            <p className="col-span-2 text-xs text-[var(--ink-soft)]">
              {previewHours > 0
                ? <>= {previewHours % 1 === 0 ? previewHours : previewHours.toFixed(1)} h antes do jogo ({WEEKDAYS[gameWeekday]} {gameTime}). Precisa ficar depois da abertura da lista e antes do &quot;Confirmar até&quot;.</>
                : <>O prazo precisa ser antes do horário do jogo.</>}
            </p>
          </div>
        )}
      </div>

      <Field label="Lembrete de mensalidade">
        <select name="due_reminder_channel" className="input" defaultValue={t.due_reminder_channel ?? "individual"}>
          <option value="group">Uma mensagem no grupo, com o link da turma (nada no privado)</option>
          <option value="individual">No privado de cada mensalista, com o Pix</option>
          <option value="off">Não enviar lembrete</option>
        </select>
        <p className="mt-1 text-xs text-[var(--ink-soft)]">
          No grupo: o mensalista abre o link, faz login e paga em &quot;Minha situação&quot;. A mensagem sai às 8h, uma por dia marcado, só se houver mensalidade em aberto.
        </p>
      </Field>
      <div className="block space-y-1">
        <span className="text-sm font-medium">Quando lembrar</span>
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {REMINDER_DAYS.map(({ d, label }) => (
            <label key={d} className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="due_reminder_days" value={d} defaultChecked={(t.due_reminder_days ?? [5, 0]).includes(d)} />
              {label}
            </label>
          ))}
        </div>
      </div>

      <button className="btn btn-primary" disabled={pending}>{pending ? <><Spinner /> Salvando...</> : team?.id ? "Salvar alterações" : "Criar turma"}</button>
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-sm font-medium">{label}</span>
      {children}
    </label>
  );
}
