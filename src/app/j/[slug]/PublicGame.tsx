"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Spinner from "@/components/Spinner";

interface Game {
  game_id: string; team_name: string; date: string; time: string; address: string;
  capacity: number; status: string; confirm_until: string; withdraw_until: string;
  dropin_fee: number; spots_available: number;
}
interface Participant { display_name: string; kind: string; status: string }
interface Player { id: string; name: string }
interface Pix { qr: string; copypaste: string; amount: number }

function fmtDate(d: string) {
  return new Date(`${d}T12:00:00`).toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "2-digit" });
}
function fmtMoney(v: number) {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export default function PublicGame({ game, participants, player, myStatus, isMember }: {
  game: Game;
  participants: Participant[];
  player: Player | null;
  myStatus: { status: string; kind: string } | null;
  isMember: boolean;
}) {
  const router = useRouter();
  const [step, setStep] = useState<"idle" | "phone" | "code" | "name" | "billing">("idle");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [cpf, setCpf] = useState("");
  const [email, setEmail] = useState("");
  const [pix, setPix] = useState<Pix | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, startRefresh] = useTransition();
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const busy = loading || refreshing;

  // mantém o indicador girando até a tela realmente atualizar
  const refresh = () => startRefresh(() => router.refresh());

  const confirmed = participants.filter((p) => p.status === "confirmed");
  const waitlist = participants.filter((p) => p.status === "waitlist");
  const closed = game.status !== "open";

  const errorMessages: Record<string, string> = {
    full: "A lista está cheia.",
    deadline_passed: "O prazo de confirmação já passou.",
    withdraw_deadline_passed: "O prazo para desistir já passou. O valor do dia continua devido.",
    list_not_open: "A lista ainda não está aberta.",
    wrong_code: "Código incorreto. Tente novamente.",
    code_expired: "Código expirado. Peça um novo.",
    too_many_requests: "Muitas tentativas. Aguarde alguns minutos.",
    too_many_attempts: "Muitas tentativas. Peça um novo código.",
    send_failed: "Não conseguimos enviar o código. Tente novamente.",
    payment_provider_error: "Erro ao gerar o Pix. Tente novamente.",
    invalid_phone: "Telefone inválido. Use DDD + número.",
  };

  async function api(path: string, body: unknown) {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      // não é erro: o sistema precisa de CPF/e-mail para emitir a cobrança
      if (data?.error === "needs_billing_data") return data;
      if (!res.ok || data.error) {
        setError(errorMessages[data.error] ?? "Algo deu errado. Tente novamente.");
        return null;
      }
      return data;
    } catch {
      setError("Sem conexão. Verifique a internet.");
      return null;
    } finally {
      setLoading(false);
    }
  }

  async function requestOtp() {
    const data = await api("/api/auth/otp/request", { phone });
    if (data) setStep("code");
  }

  async function verifyOtp(withName?: string) {
    const data = await api("/api/auth/otp/verify", { phone, code, name: withName });
    if (!data) return;
    if (data.needs_name) { setStep("name"); return; }
    refresh();
    setStep("idle");
  }

  async function doAction(action: string, billing?: { cpf: string; email: string }) {
    const data = await api("/api/public/action", { gameId: game.game_id, action, ...billing });
    if (!data) return;
    // o Asaas exige CPF para emitir a cobrança — pedimos na hora
    if (data.error === "needs_billing_data") { setStep("billing"); return; }
    if (data.waitlisted) { refresh(); return; }
    if (data.pix) { setPix(data.pix); setStep("idle"); return; }
    refresh();
  }

  function copyPix() {
    if (!pix) return;
    navigator.clipboard.writeText(pix.copypaste);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <main className="mx-auto max-w-md px-4 py-6 space-y-4">
      {/* Cabeçalho do jogo */}
      <div className="card p-5 space-y-1">
        <p className="text-sm font-semibold text-[var(--brand)]">🏐 {game.team_name}</p>
        <h1 className="text-xl font-bold capitalize">{fmtDate(game.date)} · {game.time.slice(0, 5)}</h1>
        <p className="text-sm text-[var(--ink-soft)]">📍 {game.address}</p>
        <div className="flex gap-2 pt-2">
          {closed
            ? <span className="badge badge-neutral">Lista fechada</span>
            : game.spots_available > 0
              ? <span className="badge badge-success">{game.spots_available} {game.spots_available === 1 ? "vaga" : "vagas"}</span>
              : <span className="badge badge-danger">Lista cheia</span>}
          {!closed && (
            <span className="badge badge-neutral">
              Confirmar até {new Date(game.confirm_until).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
            </span>
          )}
        </div>
      </div>

      {/* Pix pendente */}
      {pix && (
        <div className="card p-5 space-y-3 text-center">
          <h2 className="font-bold text-lg">Pague para garantir sua vaga</h2>
          <p className="text-sm text-[var(--ink-soft)]">Sua vaga fica reservada por <b>15 minutos</b>.</p>
          <p className="text-2xl font-bold">{fmtMoney(Number(pix.amount))}</p>
          {pix.qr && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={`data:image/png;base64,${pix.qr}`} alt="QR Code Pix" className="mx-auto w-52 h-52" />
          )}
          <button className="btn btn-primary" onClick={copyPix}>
            {copied ? "✓ Copiado!" : "Copiar código Pix"}
          </button>
          <p className="text-xs text-[var(--ink-soft)]">Após o pagamento, sua presença é confirmada automaticamente.</p>
          <button className="btn btn-outline" onClick={() => { setPix(null); router.refresh(); }}>Já paguei</button>
        </div>
      )}

      {/* Bloco de ação */}
      {!pix && (
        <div className="card p-5 space-y-3">
          {error && <p className="rounded-lg bg-[var(--danger-bg)] px-3 py-2 text-sm text-[var(--danger)]">{error}</p>}

          {!player && step === "idle" && (
            <button className="btn btn-primary" onClick={() => setStep("phone")} disabled={closed && game.spots_available <= 0}>
              Confirmar presença
            </button>
          )}

          {step === "phone" && (
            <>
              <label className="text-sm font-medium">Seu WhatsApp</label>
              <input className="input" type="tel" inputMode="tel" placeholder="(11) 99999-9999"
                value={phone} onChange={(e) => setPhone(e.target.value)} autoFocus />
              <button className="btn btn-primary" onClick={requestOtp} disabled={busy || phone.replace(/\D/g, "").length < 10}>
                {busy ? <><Spinner /> Enviando...</> : "Receber código no WhatsApp"}
              </button>
            </>
          )}

          {step === "code" && (
            <>
              <label className="text-sm font-medium">Código recebido no WhatsApp</label>
              <input className="input text-center text-2xl tracking-[0.5em]" type="text" inputMode="numeric" maxLength={6}
                value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} autoFocus />
              <button className="btn btn-primary" onClick={() => verifyOtp()} disabled={busy || code.length !== 6}>
                {busy ? <><Spinner /> Verificando...</> : "Entrar"}
              </button>
              <button className="btn btn-outline" onClick={requestOtp} disabled={busy}>Reenviar código</button>
            </>
          )}

          {step === "billing" && (
            <>
              <p className="text-sm font-medium">Falta pouco! Precisamos destes dados para gerar seu Pix:</p>
              <input className="input" inputMode="numeric" placeholder="CPF (somente números)"
                value={cpf} onChange={(e) => setCpf(e.target.value.replace(/\D/g, "").slice(0, 14))} autoFocus />
              <input className="input" type="email" placeholder="Seu e-mail"
                value={email} onChange={(e) => setEmail(e.target.value)} />
              <button className="btn btn-primary"
                onClick={() => doAction("reserve", { cpf, email })}
                disabled={busy || cpf.replace(/\D/g, "").length < 11 || !email.includes("@")}>
                {busy ? <><Spinner /> Gerando Pix...</> : "Gerar Pix e reservar vaga"}
              </button>
              <p className="text-xs text-[var(--ink-soft)]">
                O CPF é exigido pelo banco para emitir a cobrança Pix. Seus dados não aparecem para os outros jogadores.
              </p>
            </>
          )}

          {step === "name" && (
            <>
              <label className="text-sm font-medium">Como podemos te chamar?</label>
              <input className="input" placeholder="Nome e sobrenome" value={name}
                onChange={(e) => setName(e.target.value)} autoFocus />
              <button className="btn btn-primary" onClick={() => verifyOtp(name)} disabled={busy || name.trim().length < 2}>
                {busy && <Spinner />} Continuar
              </button>
            </>
          )}

          {player && step !== "billing" && (
            <>
              <p className="text-sm">Olá, <b>{player.name.split(" ")[0]}</b>! 👋</p>

              {myStatus?.status === "confirmed" && (
                <>
                  <p className="rounded-lg bg-[var(--success-bg)] px-3 py-2 text-sm font-semibold text-[var(--success)]">
                    ✓ Você está confirmado{myStatus.kind === "dropin" ? " (pago)" : ""}!
                  </p>
                  <button className="btn btn-danger-soft" onClick={() => doAction(isMember ? "decline" : "withdraw")} disabled={busy}>
                    {busy && <Spinner />} Desistir da vaga
                  </button>
                  <p className="text-xs text-center text-[var(--ink-soft)]">
                    Desistência sem cobrança até {new Date(game.withdraw_until).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                  </p>
                </>
              )}

              {myStatus?.status === "invited" && (
                <>
                  <p className="text-sm text-[var(--ink-soft)]">Você é mensalista. Vai jogar?</p>
                  <button className="btn btn-success" onClick={() => doAction("confirm")} disabled={busy || closed}>
                    {busy ? <Spinner /> : "✓"} Vou jogar
                  </button>
                  <button className="btn btn-outline" onClick={() => doAction("decline")} disabled={busy}>
                    {busy && <Spinner />} Não vou este dia
                  </button>
                </>
              )}

              {myStatus?.status === "waitlist" && (
                <p className="rounded-lg bg-[var(--warn-bg)] px-3 py-2 text-sm font-semibold text-[var(--warn)]">
                  Você está na lista de espera. Avisaremos se abrir vaga!
                </p>
              )}

              {myStatus?.status === "reserved" && (
                <button className="btn btn-primary" onClick={() => doAction("reserve")} disabled={busy}>
                  {busy && <Spinner />} Ver Pix pendente
                </button>
              )}

              {(myStatus == null || ["declined", "withdrawn"].includes(myStatus.status)) && (
                isMember ? (
                  <button className="btn btn-success" onClick={() => doAction("confirm")} disabled={busy || closed}>
                    {busy ? <Spinner /> : "✓"} Vou jogar
                  </button>
                ) : (
                  <>
                    <button className="btn btn-primary" onClick={() => doAction("reserve")}
                      disabled={busy || closed || game.spots_available <= 0}>
                      {busy && <Spinner />} Participar — {fmtMoney(Number(game.dropin_fee))} via Pix
                    </button>
                    {game.spots_available <= 0 && !closed && (
                      <button className="btn btn-outline" onClick={() => doAction("reserve")} disabled={busy}>
                        {busy && <Spinner />} Entrar na lista de espera
                      </button>
                    )}
                  </>
                )
              )}
            </>
          )}
        </div>
      )}

      {/* Lista de confirmados */}
      <div className="card p-5">
        <h2 className="mb-3 font-bold">Confirmados ({confirmed.length}/{game.capacity})</h2>
        {confirmed.length === 0 && <p className="text-sm text-[var(--ink-soft)]">Ninguém confirmou ainda. Seja o primeiro!</p>}
        <ol className="space-y-2">
          {confirmed.map((p, i) => (
            <li key={i} className="flex items-center justify-between text-sm">
              <span>{i + 1}. {p.display_name}</span>
              <span className={`badge ${p.kind === "member" ? "badge-neutral" : "badge-success"}`}>
                {p.kind === "member" ? "Mensalista" : "Avulso"}
              </span>
            </li>
          ))}
        </ol>
        {waitlist.length > 0 && (
          <>
            <h3 className="mb-2 mt-4 text-sm font-bold text-[var(--ink-soft)]">Lista de espera</h3>
            <ol className="space-y-1">
              {waitlist.map((p, i) => (
                <li key={i} className="text-sm text-[var(--ink-soft)]">{i + 1}. {p.display_name}</li>
              ))}
            </ol>
          </>
        )}
      </div>
    </main>
  );
}
