"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveTeam } from "./actions";

const WEEKDAYS = ["Domingo", "Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira", "Sábado"];

export interface TeamValues {
  id?: string; name?: string; slug?: string; weekday?: number; game_time?: string;
  address?: string; capacity?: number; monthly_fee?: number; dropin_fee?: number;
  open_hours_before?: number; confirm_hours_before?: number; withdraw_hours_before?: number;
  whatsapp_group_id?: string | null; message_mode?: string;
}

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
  return (
    <form action={submit} className="card max-w-xl space-y-4 p-6">
      {error && <p className="rounded-lg bg-[var(--danger-bg)] px-3 py-2 text-sm text-[var(--danger)]">{error}</p>}

      <Field label="Nome da turma"><input name="name" className="input" defaultValue={t.name} placeholder="Vôlei de segunda" required /></Field>
      <Field label="Link público (letras minúsculas e hífens)">
        <input name="slug" className="input" defaultValue={t.slug} placeholder="volei-segunda" pattern="[a-z0-9-]+" required />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Dia da semana">
          <select name="weekday" className="input" defaultValue={t.weekday ?? 1}>
            {WEEKDAYS.map((d, i) => <option key={i} value={i}>{d}</option>)}
          </select>
        </Field>
        <Field label="Horário"><input name="game_time" type="time" className="input" defaultValue={t.game_time?.slice(0, 5) ?? "20:00"} required /></Field>
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

      <button className="btn btn-primary" disabled={pending}>{pending ? "Salvando..." : team?.id ? "Salvar alterações" : "Criar turma"}</button>
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
