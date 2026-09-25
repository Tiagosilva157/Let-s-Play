"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Spinner from "@/components/Spinner";
import { createOneOffGame } from "./actions";

interface TeamOpt { id: string; name: string; capacity: number; dropin_fee: number; address: string; game_time: string }

/** "⭐ Criar jogo único": jogo extra, fora da recorrência da turma. */
export default function OneOffGameForm({ teams, today }: { teams: TeamOpt[]; today: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [teamId, setTeamId] = useState(teams[0]?.id ?? "");
  const team = teams.find((t) => t.id === teamId);

  const [title, setTitle] = useState("");
  const [date, setDate] = useState(today);
  const [time, setTime] = useState(team?.game_time?.slice(0, 5) ?? "20:00");
  const [address, setAddress] = useState("");
  const [capacity, setCapacity] = useState("");
  const [fee, setFee] = useState("");
  const [membersPay, setMembersPay] = useState(false);
  const [openNow, setOpenNow] = useState(true);

  function submit() {
    setError("");
    startTransition(async () => {
      const res = await createOneOffGame({
        teamId, date, time, title, address,
        capacity: capacity ? Number(capacity) : null,
        fee: fee ? Number(fee.replace(",", ".")) : null,
        membersPay, openNow,
      });
      if ("error" in res) { setError(res.error); return; }
      router.push(`/admin/jogos/${res.id}`);
    });
  }

  if (!open) {
    return (
      <button className="btn btn-outline btn-sm" onClick={() => setOpen(true)} disabled={teams.length === 0}>
        ⭐ Criar jogo único
      </button>
    );
  }

  return (
    <section className="card space-y-3 p-4">
      <div className="flex items-center justify-between">
        <h2 className="font-bold">⭐ Novo jogo único</h2>
        <button type="button" className="text-sm text-[var(--ink-soft)]" onClick={() => setOpen(false)}>Fechar</button>
      </div>
      <p className="text-xs text-[var(--ink-soft)]">
        Um jogo extra, fora do dia fixo da turma. Usa o grupo e os prazos da turma escolhida.
        O jogo normal da semana continua existindo.
      </p>

      <div className="grid gap-2 sm:grid-cols-2">
        <label className="block text-xs text-[var(--ink-soft)] sm:col-span-2">Turma (grupo que será avisado)
          <select className="input mt-1" value={teamId} onChange={(e) => setTeamId(e.target.value)}>
            {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </label>
        <label className="block text-xs text-[var(--ink-soft)] sm:col-span-2">Nome do jogo (opcional)
          <input className="input mt-1" value={title} maxLength={60} placeholder="Ex.: Jogo extra na praia"
            onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label className="block text-xs text-[var(--ink-soft)]">Data
          <input className="input mt-1 w-full min-w-0" type="date" value={date} min={today} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label className="block text-xs text-[var(--ink-soft)]">Horário
          <input className="input mt-1 w-full min-w-0" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        </label>
        <label className="block text-xs text-[var(--ink-soft)] sm:col-span-2">Local (vazio = local da turma)
          <input className="input mt-1" value={address} placeholder={team?.address ?? ""} onChange={(e) => setAddress(e.target.value)} />
        </label>
        <label className="block text-xs text-[var(--ink-soft)]">Vagas (vazio = {team?.capacity})
          <input className="input mt-1" inputMode="numeric" value={capacity} onChange={(e) => setCapacity(e.target.value.replace(/\D/g, ""))} />
        </label>
        <label className="block text-xs text-[var(--ink-soft)]">Valor avulso R$ (vazio = {team?.dropin_fee.toFixed(2).replace(".", ",")})
          <input className="input mt-1" inputMode="decimal" value={fee} onChange={(e) => setFee(e.target.value.replace(/[^\d,.]/g, ""))} />
        </label>
      </div>

      <fieldset className="space-y-1 text-sm">
        <legend className="text-xs text-[var(--ink-soft)]">Mensalistas neste jogo</legend>
        <label className="flex items-start gap-2">
          <input type="radio" className="mt-1" checked={!membersPay} onChange={() => setMembersPay(false)} />
          <span>Têm vaga garantida, como no jogo normal (confirmam sem pagar)</span>
        </label>
        <label className="flex items-start gap-2">
          <input type="radio" className="mt-1" checked={membersPay} onChange={() => setMembersPay(true)} />
          <span>Pagam como todos (ninguém tem vaga garantida; entra quem pagar o Pix)</span>
        </label>
      </fieldset>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={openNow} onChange={(e) => setOpenNow(e.target.checked)} />
        Abrir a lista agora e avisar o grupo (em até 1 minuto)
      </label>
      {!openNow && <p className="text-xs text-[var(--ink-soft)]">A lista abre sozinha no prazo de abertura da turma.</p>}

      {error && <p className="rounded-lg bg-[var(--danger-bg)] px-3 py-2 text-sm text-[var(--danger)]">{error}</p>}
      <button className="btn btn-primary btn-sm" disabled={pending || !teamId || !date || !time} onClick={submit}>
        {pending ? <><Spinner size={14} /> Criando...</> : "Criar jogo"}
      </button>
    </section>
  );
}
