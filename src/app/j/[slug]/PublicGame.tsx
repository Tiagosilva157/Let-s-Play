"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Spinner from "@/components/Spinner";
import PhoneInput, { isCompleteMobile } from "@/components/PhoneInput";

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

export default function PublicGame({ game, participants, player, myStatus, isMember, credit = null }: {
  game: Game;
  participants: Participant[];
  player: Player | null;
  myStatus: { status: string; kind: string; promoted_from_waitlist?: boolean } | null;
  isMember: boolean;
  credit?: number | null; // crédito disponível do avulso nesta turma (cobre a taxa)
}) {
  // prazo de desistência avaliado já na renderização (não só ao clicar)
  const withdrawOpen = new Date(game.withdraw_until) > new Date();
  const withdrawDeadline = new Date(game.withdraw_until).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
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
  // o que a pessoa quis dizer ANTES de entrar: jogar ou avisar que não vai
  const [intent, setIntent] = useState<"play" | "skip" | null>(null);
  const [intentNote, setIntentNote] = useState("");
  const busy = loading || refreshing;

  // mantém o indicador girando até a tela realmente atualizar
  const refresh = () => startRefresh(() => router.refresh());

  const confirmed = participants.filter((p) => p.status === "confirmed");
  const waitlist = participants.filter((p) => p.status === "waitlist");
  const closed = game.status !== "open";

  const errorMessages: Record<string, string> = {
    full: "A lista está cheia.",
    promotion_expired: "Você subiu da lista de espera mas o prazo de pagamento terminou, então a vaga passou para o próximo. Não é possível entrar novamente neste jogo.",
    deadline_passed: "O prazo de confirmação já passou.",
    withdraw_deadline_passed: "O prazo para desistir já passou. Atualize a página e tente novamente.",
    list_not_open: "A lista ainda não está aberta.",
    wrong_code: "Código incorreto. Tente novamente.",
    code_expired: "Código expirado. Peça um novo.",
    too_many_requests: "Muitas tentativas. Aguarde alguns minutos.",
    too_many_attempts: "Muitas tentativas. Peça um novo código.",
    send_failed: "Não conseguimos enviar o código. Tente novamente.",
    payment_provider_error: "Erro ao gerar o Pix. Tente novamente.",
    invalid_phone: "Telefone inválido. Use DDD + número.",
    server_error: "O sistema encontrou um problema ao processar. Tente novamente em instantes.",
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
      // resposta sem JSON (erro do servidor/proxy) não é "sem conexão"
      const data = await res.json().catch(() => ({ error: "server_error" }));
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
    setStep("idle");
    // cumpre o que a pessoa escolheu na primeira tela ANTES de atualizar,
    // para não haver duas atualizações concorrentes (a antiga venceria)
    if (intent) {
      const wants = intent;
      setIntent(null);
      await fulfillIntent(wants);
      return;
    }
    refresh();
  }

  /**
   * Executa a intenção escolhida na tela inicial.
   * Mensalista: confirma/recusa direto. Avulso: o servidor recusa a ação de
   * mensalista e nós apenas orientamos — cobrança nunca é gerada sozinha.
   */
  async function fulfillIntent(wants: "play" | "skip") {
    setLoading(true);
    try {
      const res = await fetch("/api/public/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gameId: game.game_id, action: wants === "skip" ? "decline" : "confirm" }),
      });
      const data = await res.json().catch(() => null);
      if (!data?.ok) {
        // não é mensalista desta turma: seguimos pelo fluxo de avulso
        setIntentNote(wants === "skip"
          ? "Tudo certo! Você não é mensalista desta turma, então não precisa avisar nada — só entra na lista quem garante a vaga. Obrigado por avisar. 👍"
          : "Para garantir sua vaga, toque no botão abaixo — a vaga é confirmada após o pagamento do Pix.");
      }
    } catch {
      setError("Sem conexão. Verifique a internet.");
    } finally {
      setLoading(false);
    }
    // fora da transição: garante que a sessão recém-criada seja lida pelo servidor
    router.refresh();
  }

  async function doAction(action: string, billing?: { cpf: string; email: string }) {
    const data = await api("/api/public/action", { gameId: game.game_id, action, ...billing });
    if (!data) return;
    // o Asaas exige CPF para emitir a cobrança — pedimos na hora
    if (data.error === "needs_billing_data") { setStep("billing"); return; }
    if (data.waitlisted) { refresh(); return; }
    if (data.pix) { setPix(data.pix); setStep("idle"); return; }
    if (data.credit_granted) {
      setIntentNote(data.credit_late
        ? `✅ Desistência registrada após o prazo. Os ${fmtMoney(Number(data.credit_amount))} pagos viraram crédito (sem devolução em dinheiro) — na próxima vez que garantir vaga, a presença é confirmada sem pagar de novo.`
        : `✅ Desistência registrada. Os ${fmtMoney(Number(data.credit_amount))} que você pagou viraram crédito — na próxima vez que garantir vaga, a presença é confirmada sem pagar de novo.`);
    } else if (data.late) {
      setIntentNote("✅ Registrado: você avisou que não vem. Sua vaga foi liberada para outra pessoa.");
    }
    if (data.credit_used) {
      setIntentNote(`🎫 Vaga garantida usando seu crédito de ${fmtMoney(Number(data.amount))} — nada a pagar!`);
    }
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
            <>
              {closed && (
                <p className="rounded-lg bg-[var(--warn-bg)] px-3 py-2 text-sm text-[var(--warn)]">
                  {game.status === "canceled"
                    ? "Este jogo foi cancelado."
                    : "A lista deste jogo está fechada — as confirmações foram encerradas."}
                  {" "}Se você já estava na lista, entre abaixo para ver sua situação.
                </p>
              )}
              {closed ? (
                <button className="btn btn-primary" onClick={() => setStep("phone")}>
                  Entrar para ver minha situação
                </button>
              ) : (
                <>
                  <p className="text-sm font-medium">Você vem jogar {fmtDate(game.date).split(",")[0]}?</p>
                  <button className="btn btn-success" onClick={() => { setIntent("play"); setStep("phone"); }}>
                    ✓ Vou jogar
                  </button>
                  <button className="btn btn-outline" onClick={() => { setIntent("skip"); setStep("phone"); }}>
                    ❌ Não vou participar
                  </button>
                  <p className="text-center text-xs text-[var(--ink-soft)]">
                    Nos dois casos é rapidinho: confirmamos seu WhatsApp e registramos sua resposta.
                  </p>
                </>
              )}
            </>
          )}

          {step === "phone" && (
            <>
              <label className="text-sm font-medium">Seu WhatsApp</label>
              <PhoneInput value={phone} onChange={setPhone} autoFocus />
              <button className="btn btn-primary" onClick={requestOtp} disabled={busy || !isCompleteMobile(phone)}>
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
              {intentNote && (
                <p className="rounded-lg bg-[var(--bg)] px-3 py-2 text-sm text-[var(--ink-soft)]">{intentNote}</p>
              )}

              {myStatus?.status === "confirmed" && (
                <>
                  <p className="rounded-lg bg-[var(--success-bg)] px-3 py-2 text-sm font-semibold text-[var(--success)]">
                    ✓ Você está confirmado{myStatus.kind === "dropin" ? " (pago)" : ""}!
                  </p>
                  {/* o botão fica SEMPRE disponível; depois do prazo, avisa e o valor vira crédito (sem dinheiro) */}
                  <button className="btn btn-danger-soft" disabled={busy}
                    onClick={() => {
                      if (!withdrawOpen) {
                        const msg = myStatus.kind === "dropin"
                          ? `O prazo para desistir terminou em ${withdrawDeadline}.\n\nVocê ainda pode desistir: sua vaga será liberada e o valor pago (${fmtMoney(Number(game.dropin_fee))}) vira CRÉDITO para o próximo jogo — sem devolução em dinheiro.\n\nConfirmar a desistência?`
                          : `O prazo para desistir terminou em ${withdrawDeadline}.\n\nVocê ainda pode avisar que não vem — sua vaga será liberada para outra pessoa.\n\nConfirmar?`;
                        if (!confirm(msg)) return;
                      }
                      doAction(isMember ? "decline" : "withdraw");
                    }}>
                    {busy && <Spinner />} Desistir da vaga
                  </button>
                  <p className="text-xs text-center text-[var(--ink-soft)]">
                    {withdrawOpen
                      ? <>Você pode desistir até {withdrawDeadline}{myStatus.kind === "dropin" && " — desistindo no prazo, o valor pago vira crédito para o próximo jogo"}</>
                      : <>O prazo ({withdrawDeadline}) já passou{myStatus.kind === "dropin" ? " — desistindo agora, o valor pago vira crédito (sem devolução em dinheiro)" : " — mas você ainda pode avisar que não vem"}</>}
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
                <>
                  <p className="rounded-lg bg-[var(--warn-bg)] px-3 py-2 text-sm font-semibold text-[var(--warn)]">
                    Você está na lista de espera. Se abrir vaga, o Pix chega no seu WhatsApp e você tem <b>1 hora</b> para pagar!
                  </p>
                  <button className="btn btn-outline" onClick={() => doAction("withdraw")} disabled={busy}>
                    {busy && <Spinner />} Sair da lista de espera
                  </button>
                </>
              )}

              {myStatus?.status === "removed" && (
                <p className="rounded-lg bg-[var(--danger-bg)] px-3 py-2 text-sm text-[var(--danger)]">
                  {myStatus.promoted_from_waitlist
                    ? "Você subiu da lista de espera, mas o prazo de pagamento terminou e a vaga passou para o próximo. Não é possível entrar novamente neste jogo — até a próxima partida!"
                    : "Sua participação neste jogo foi removida pelo organizador. Em caso de dúvida, fale com ele."}
                </p>
              )}

              {myStatus?.status === "pending_review" && (
                <p className="rounded-lg bg-[var(--warn-bg)] px-3 py-2 text-sm text-[var(--warn)]">
                  Seu pagamento foi recebido, mas a lista já estava completa. O organizador vai entrar em contato
                  para devolver o valor ou transformá-lo em crédito para o próximo jogo.
                </p>
              )}

              {myStatus?.status === "reserved" && (
                <button className="btn btn-primary" onClick={() => doAction("reserve")} disabled={busy}>
                  {busy && <Spinner />} Ver Pix pendente
                </button>
              )}

              {(myStatus == null || ["declined", "withdrawn"].includes(myStatus.status)) && (
                isMember ? (
                  <>
                    {myStatus != null && (
                      <p className="rounded-lg bg-[var(--warn-bg)] px-3 py-2 text-sm text-[var(--warn)]">
                        Você avisou que não vem. Mudou de ideia? Confirme abaixo (se ainda houver vaga).
                      </p>
                    )}
                    <button className="btn btn-success" onClick={() => doAction("confirm")} disabled={busy || closed}>
                      {busy ? <Spinner /> : "✓"} Vou jogar
                    </button>
                    {myStatus == null && (
                      <button className="btn btn-outline" onClick={() => doAction("decline")} disabled={busy || closed}>
                        {busy && <Spinner />} ❌ Não vou participar
                      </button>
                    )}
                  </>
                ) : (
                  <>
                    {credit != null && (
                      <p className="rounded-lg bg-[var(--success-bg)] px-3 py-2 text-sm text-[var(--success)]">
                        🎫 Você tem um crédito de <b>{fmtMoney(credit)}</b> nesta turma — sua próxima vaga sai sem pagar.
                      </p>
                    )}
                    <button className="btn btn-primary" onClick={() => doAction("reserve")}
                      disabled={busy || closed || game.spots_available <= 0}>
                      {busy && <Spinner />} {credit != null
                        ? "Participar — usar meu crédito"
                        : `Participar — ${fmtMoney(Number(game.dropin_fee))} via Pix`}
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
