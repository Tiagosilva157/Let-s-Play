"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveSettings, testAsaas, testGpConnect } from "./actions";
import Spinner from "@/components/Spinner";

interface Current {
  asaas_api_key: string; asaas_env: string; asaas_webhook_token: string;
  gpconnect_token: string; gpconnect_base_url: string;
}

export default function SettingsForm({ current, meIsOwner }: { current: Current; meIsOwner: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ type: "ok" | "error"; text: string } | null>(null);

  function submit(formData: FormData) {
    startTransition(async () => {
      const res = await saveSettings(formData);
      if (res?.error) { setMsg({ type: "error", text: res.error }); return; }
      setMsg({ type: "ok", text: res.saved ? "Configurações salvas." : "Nada para salvar (campos em branco mantêm o valor atual)." });
      router.refresh();
    });
  }

  function runTestAsaas() {
    startTransition(async () => {
      const res = await testAsaas();
      setMsg(res.error ? { type: "error", text: res.error } : { type: "ok", text: res.message! });
    });
  }

  function runTestGp(formData: FormData) {
    startTransition(async () => {
      const res = await testGpConnect(formData);
      setMsg(res.error ? { type: "error", text: res.error } : { type: "ok", text: res.message! });
    });
  }

  if (!meIsOwner) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Configurações</h1>
        <p className="card p-4 text-sm text-[var(--ink-soft)]">Apenas o administrador principal pode ver e alterar as integrações.</p>
      </div>
    );
  }

  return (
    <div className="max-w-xl space-y-5">
      <h1 className="text-2xl font-bold">Configurações</h1>
      <p className="text-sm text-[var(--ink-soft)]">
        Os tokens ficam guardados com segurança no servidor e nunca aparecem no navegador dos jogadores.
        Campos em branco mantêm o valor atual (mostrado mascarado).
      </p>

      {msg && (
        <p className={`rounded-lg px-3 py-2 text-sm ${msg.type === "ok" ? "bg-[var(--success-bg)] text-[var(--success)]" : "bg-[var(--danger-bg)] text-[var(--danger)]"}`}>
          {msg.text}
        </p>
      )}

      <form action={submit} className="card space-y-4 p-5">
        <h2 className="font-bold">💳 Asaas (pagamentos)</h2>
        <Field label={`Chave de API ${current.asaas_api_key ? `(atual: ${current.asaas_api_key})` : "(não configurada)"}`}>
          <input name="asaas_api_key" className="input" type="password" placeholder="Cole a nova chave para substituir" autoComplete="off" />
        </Field>
        <Field label="Ambiente">
          <select name="asaas_env" className="input" defaultValue={current.asaas_env}>
            <option value="sandbox">Sandbox (testes)</option>
            <option value="production">Produção (cobranças reais)</option>
          </select>
        </Field>
        <Field label={`Token do webhook ${current.asaas_webhook_token ? `(atual: ${current.asaas_webhook_token})` : "(não configurado)"}`}>
          <input name="asaas_webhook_token" className="input" type="password" placeholder="32 a 255 caracteres" autoComplete="off" />
        </Field>

        <h2 className="pt-2 font-bold">💬 GP Connect (WhatsApp)</h2>
        <Field label={`Token ${current.gpconnect_token ? `(atual: ${current.gpconnect_token})` : "(não configurado)"}`}>
          <input name="gpconnect_token" className="input" type="password" placeholder="Cole o novo token para substituir" autoComplete="off" />
        </Field>
        <Field label="URL base">
          <input name="gpconnect_base_url" className="input" defaultValue={current.gpconnect_base_url} />
        </Field>

        <button className="btn btn-primary" disabled={pending}>{pending ? <><Spinner /> Salvando...</> : "Salvar configurações"}</button>
      </form>

      <div className="card space-y-3 p-5">
        <h2 className="font-bold">🔍 Testar integrações</h2>
        <button className="btn btn-outline btn-sm" disabled={pending} onClick={runTestAsaas}>{pending && <Spinner />} Testar conexão com o Asaas</button>
        <form action={runTestGp} className="flex flex-col gap-2 sm:flex-row">
          <input name="test_phone" className="input sm:flex-1" type="tel" placeholder="Seu WhatsApp para teste: (11) 99999-9999" />
          <button className="btn btn-outline btn-sm" disabled={pending}>{pending && <Spinner />} Enviar mensagem de teste</button>
        </form>
      </div>
    </div>
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
