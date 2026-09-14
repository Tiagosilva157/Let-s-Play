"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Spinner from "@/components/Spinner";
import { resendDispatch, dismissDispatch, testWhatsApp } from "./actions";

export interface FailedRow {
  id: string; kind: string; recipient: string; recipientName: string | null;
  body: string; error: string | null; createdAt: string;
}

/** Painel de mensagens de WhatsApp que falharam nas últimas 48h, com reenvio. */
export default function FailedMessages({ rows, adminPhone }: { rows: FailedRow[]; adminPhone: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ type: "ok" | "error"; text: string } | null>(null);
  const [phone, setPhone] = useState(adminPhone);

  function run(id: string | null, fn: () => Promise<{ ok?: boolean; error?: string; note?: string } | undefined>, okText: string) {
    setMsg(null); setBusyId(id);
    startTransition(async () => {
      const res = await fn();
      setBusyId(null);
      if (res?.error) { setMsg({ type: "error", text: res.error }); return; }
      setMsg({ type: "ok", text: res?.note ?? okText });
      router.refresh();
    });
  }

  const individualFails = rows.filter((r) => r.kind === "individual").length;
  const looksDisconnected = individualFails >= 2 && rows.some((r) => /Users|Expired Session|inacess/i.test(r.error ?? ""));

  return (
    <section className="card space-y-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-bold">📵 Mensagens de WhatsApp com falha (48h)</h2>
        <span className="badge badge-warn">{rows.length}</span>
      </div>

      {looksDisconnected && (
        <p className="rounded-lg bg-[var(--danger-bg)] px-3 py-2 text-sm text-[var(--danger)]">
          Várias mensagens individuais falharam com erro da GP Connect. Isso normalmente significa que a
          <b> conexão do WhatsApp está desconectada</b>. Reconecte no painel da GP Connect e use o teste abaixo.
        </p>
      )}

      <div className="flex flex-wrap items-end gap-2">
        <label className="block text-xs text-[var(--ink-soft)]">
          Testar envio para
          <input className="input mt-1 w-44" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(31) 9XXXX-XXXX" />
        </label>
        <button className="btn btn-outline btn-sm" disabled={pending}
          onClick={() => run("test", () => testWhatsApp(phone), "Teste enviado.")}>
          {pending && busyId === "test" ? <Spinner size={14} /> : "📲"} Testar WhatsApp
        </button>
        {msg && <span className={`text-sm ${msg.type === "ok" ? "text-[var(--success)]" : "text-[var(--danger)]"}`}>{msg.text}</span>}
      </div>

      {rows.length > 0 && (
        <ul className="max-h-96 divide-y divide-[var(--line)] overflow-y-auto">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-col gap-2 py-2.5 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0 text-sm">
                <p className="font-medium">
                  {r.kind === "group" ? "👥 Grupo" : `👤 ${r.recipientName ?? r.recipient}`}
                  <span className="ml-2 text-xs text-[var(--ink-soft)]">
                    {new Date(r.createdAt).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                  </span>
                </p>
                <p className="truncate text-[var(--ink-soft)]" title={r.body}>{r.body.replace(/\s+/g, " ").slice(0, 90)}</p>
                {r.error && <p className="truncate text-xs text-[var(--danger)]" title={r.error}>{r.error.slice(0, 120)}</p>}
              </div>
              <div className="flex shrink-0 gap-1">
                <button className="btn btn-outline btn-sm" disabled={pending}
                  onClick={() => run(r.id, () => resendDispatch(r.id), "Reenviada.")}>
                  {pending && busyId === r.id ? <Spinner size={14} /> : "🔁"} Reenviar
                </button>
                <button className="btn btn-outline btn-sm" disabled={pending} title="Some do painel, fica no histórico"
                  onClick={() => run(r.id, () => dismissDispatch(r.id), "Ok, ignorada.")}>
                  {pending && busyId === r.id ? <Spinner size={14} /> : "✕"}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
