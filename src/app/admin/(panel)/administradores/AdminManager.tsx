"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createAdmin, resetAdminPassword, deleteAdmin } from "./actions";
import Spinner from "@/components/Spinner";

export interface AdminRow { id: string; name: string; email: string; role: string; isMe: boolean }

export default function AdminManager({ admins, meIsOwner }: { admins: AdminRow[]; meIsOwner: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [showForm, setShowForm] = useState(false);
  const [resetFor, setResetFor] = useState<AdminRow | null>(null);
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");

  function submitCreate(formData: FormData) {
    startTransition(async () => {
      const res = await createAdmin(formData);
      if (res?.error) { setError(res.error); return; }
      setError(""); setOk("Administrador criado com sucesso.");
      setShowForm(false);
      router.refresh();
    });
  }

  function submitReset(formData: FormData) {
    if (!resetFor) return;
    startTransition(async () => {
      const res = await resetAdminPassword(resetFor.id, formData);
      if (res?.error) { setError(res.error); return; }
      setError(""); setOk(`Senha de ${resetFor.name} alterada.`);
      setResetFor(null);
    });
  }

  function remove(a: AdminRow) {
    if (!confirm(`Remover o administrador ${a.name}? Ele perderá o acesso ao painel imediatamente.`)) return;
    startTransition(async () => {
      const res = await deleteAdmin(a.id);
      if (res?.error) { setError(res.error); return; }
      setError(""); setOk("Administrador removido.");
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-bold">Administradores</h1>
        {meIsOwner && (
          <button className="btn btn-primary btn-sm" onClick={() => { setShowForm(!showForm); setResetFor(null); setError(""); setOk(""); }}>
            + Novo administrador
          </button>
        )}
      </div>

      {ok && <p className="rounded-lg bg-[var(--success-bg)] px-3 py-2 text-sm text-[var(--success)]">{ok}</p>}
      {error && <p className="rounded-lg bg-[var(--danger-bg)] px-3 py-2 text-sm text-[var(--danger)]">{error}</p>}

      {showForm && (
        <form action={submitCreate} className="card space-y-3 p-4">
          <h2 className="font-bold">Novo administrador</h2>
          <input name="name" className="input" placeholder="Nome" required />
          <input name="email" className="input" type="email" placeholder="E-mail de acesso" required />
          <input name="password" className="input" type="password" placeholder="Senha (mínimo 8 caracteres)" minLength={8} required />
          <div className="flex flex-col gap-2 sm:flex-row">
            <button className="btn btn-primary btn-sm" disabled={pending}>{pending ? <><Spinner /> Criando...</> : "Criar administrador"}</button>
            <button type="button" className="btn btn-outline btn-sm" onClick={() => setShowForm(false)}>Cancelar</button>
          </div>
        </form>
      )}

      {resetFor && (
        <form action={submitReset} className="card space-y-3 p-4">
          <h2 className="font-bold">Alterar senha de {resetFor.name}</h2>
          <input name="password" className="input" type="password" placeholder="Nova senha (mínimo 8 caracteres)" minLength={8} required autoFocus />
          <div className="flex flex-col gap-2 sm:flex-row">
            <button className="btn btn-primary btn-sm" disabled={pending}>{pending ? <><Spinner /> Salvando...</> : "Salvar nova senha"}</button>
            <button type="button" className="btn btn-outline btn-sm" onClick={() => setResetFor(null)}>Cancelar</button>
          </div>
        </form>
      )}

      <div className="card divide-y divide-[var(--line)]">
        {admins.map((a) => (
          <div key={a.id} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="font-medium">{a.name} {a.isMe && <span className="text-xs text-[var(--ink-soft)]">(você)</span>}</p>
              <p className="text-sm text-[var(--ink-soft)]">{a.email}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className={`badge ${a.role === "owner" ? "badge-success" : "badge-neutral"}`}>
                {a.role === "owner" ? "Principal" : "Administrador"}
              </span>
              {(meIsOwner || a.isMe) && (
                <button className="btn btn-outline btn-sm" disabled={pending} onClick={() => { setResetFor(a); setShowForm(false); setError(""); setOk(""); }}>
                  Alterar senha
                </button>
              )}
              {meIsOwner && !a.isMe && a.role !== "owner" && (
                <button className="btn btn-danger-soft btn-sm" disabled={pending} onClick={() => remove(a)}>Remover</button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
