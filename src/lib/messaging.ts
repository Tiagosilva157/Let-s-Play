// Fila de mensagens WhatsApp (GP Connect) com debounce por dedupe_key.
//
// O despacho acontece de duas formas:
//  1. imediatamente, em processo, logo após enfileirar (dispatchPending);
//  2. pelo cron (/api/cron/tick), que serve de rede de segurança para
//     mensagens agrupadas, agendadas e para novas tentativas após falha.
// Assim o envio nunca depende de o cron estar funcionando.
import { supabaseAdmin } from "@/lib/supabase/server";
import { formatPhoneBR } from "@/lib/phone";
import { GpConnect } from "@/lib/gpconnect";

function fmtDate(d: string) {
  const [y, m, day] = d.split("-");
  return `${day}/${m}/${y.slice(2)}`;
}

function fmtMoney(v: number) {
  return Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

interface TeamInfo {
  id: string; name: string; address: string; capacity: number; dropin_fee: number;
  whatsapp_group_id: string | null; message_mode: string; batch_minutes: number; slug: string;
}

async function loadGame(gameId: string) {
  const db = supabaseAdmin();
  const { data: g } = await db
    .from("games")
    .select("id, date, time, address_override, capacity_override, status, confirm_until, teams(id, name, address, capacity, dropin_fee, whatsapp_group_id, message_mode, batch_minutes, slug)")
    .eq("id", gameId)
    .maybeSingle();
  if (!g) return null;
  return { game: g, team: g.teams as unknown as TeamInfo };
}

export function publicLink(slug: string) {
  // extrai apenas a URL — protege contra valores colados com o nome da
  // variável junto (ex.: "NEXT_PUBLIC_APP_URL=https://...")
  const raw = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const base = (raw.match(/https?:\/\/[^\s"']+/)?.[0] ?? "").replace(/\/+$/, "");
  return base ? `${base}/j/${slug}` : "";
}

interface RosterEntry { name: string; status: string }
export interface Roster {
  capacity: number;
  members: RosterEntry[];      // mensalistas da turma (sempre listados)
  dropins: RosterEntry[];      // avulsos que entraram
  waitlist: RosterEntry[];
  membersHolding: number;      // mensalistas que ainda ocupam vaga
  dropinsOccupying: number;    // avulsos pagos + aguardando pagamento
  dropinSlots: number;         // vagas destinadas a avulsos hoje
  dropinSlotsFree: number;     // quantas dessas ainda estão livres
  confirmedTotal: number;
}

/**
 * Monta a fotografia do jogo.
 *
 * Regra de vagas: o mensalista segura a vaga dele até responder. Enquanto
 * está "aguardando" ou "confirmado", a vaga é dele. Se disser que não vem,
 * a vaga é liberada na hora e vira vaga de avulso.
 * Exemplo: 18 vagas, 10 mensalistas → 8 para avulsos. Se um mensalista
 * disser que não vem → 9 mensalistas segurando → 9 vagas para avulsos.
 */
export async function buildRoster(gameId: string): Promise<{ roster: Roster; game: { date: string; time: string; address: string; confirm_until: string }; team: TeamInfo } | null> {
  const loaded = await loadGame(gameId);
  if (!loaded) return null;
  const { game: g, team: t } = loaded;
  const db = supabaseAdmin();
  const capacity = g.capacity_override ?? t.capacity;

  const [{ data: teamMembers }, { data: parts }] = await Promise.all([
    db.from("team_members").select("player_id, players(name)").eq("team_id", t.id).eq("status", "active"),
    db.from("game_participants").select("player_id, kind, status, confirmed_at, created_at, players(name)").eq("game_id", gameId),
  ]);

  const byPlayer = new Map((parts ?? []).map((p) => [p.player_id, p]));
  const memberIds = new Set((teamMembers ?? []).map((m) => m.player_id));

  // mensalistas: sempre aparecem, mesmo antes de responder
  const members: RosterEntry[] = (teamMembers ?? []).map((m) => {
    const part = byPlayer.get(m.player_id);
    const status = part?.status ?? "invited";
    return { name: (m.players as unknown as { name: string }).name, status };
  }).sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));

  const membersHolding = members.filter((m) => m.status === "invited" || m.status === "confirmed").length;

  // avulsos: quem não é mensalista da turma
  const dropinParts = (parts ?? [])
    .filter((p) => !memberIds.has(p.player_id) && ["confirmed", "reserved"].includes(p.status))
    .sort((a, b) => String(a.confirmed_at ?? a.created_at).localeCompare(String(b.confirmed_at ?? b.created_at)));
  const dropins: RosterEntry[] = dropinParts.map((p) => ({
    name: (p.players as unknown as { name: string }).name, status: p.status,
  }));

  const waitlist: RosterEntry[] = (parts ?? [])
    .filter((p) => p.status === "waitlist")
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
    .map((p) => ({ name: (p.players as unknown as { name: string }).name, status: p.status }));

  const dropinsOccupying = dropins.length;
  const dropinSlots = Math.max(0, capacity - membersHolding);
  const dropinSlotsFree = Math.max(0, dropinSlots - dropinsOccupying);
  const confirmedTotal =
    members.filter((m) => m.status === "confirmed").length +
    dropins.filter((d) => d.status === "confirmed").length;

  return {
    roster: { capacity, members, dropins, waitlist, membersHolding, dropinsOccupying, dropinSlots, dropinSlotsFree, confirmedTotal },
    game: {
      date: g.date, time: String(g.time),
      address: g.address_override ?? t.address,
      confirm_until: g.confirm_until,
    },
    team: t,
  };
}

/** Marca ao lado do nome do mensalista, no padrão usado nos grupos. */
function memberLine(i: number, name: string, status: string) {
  if (status === "confirmed") return `${i}. ${name} ✅`;
  if (status === "invited") return `${i}. ${name} ⏳ _(aguardando)_`;
  return `${i}. ${name} ❌ _(não vem — vaga liberada)_`;
}

function fmtDateFull(d: string) {
  const [y, m, day] = d.split("-");
  return `${day}/${m}/${y}`;
}

function weekdayName(d: string) {
  return new Date(`${d}T12:00:00`).toLocaleDateString("pt-BR", { weekday: "long" });
}

/** Blocos da lista (Mensalistas / Não mensalistas / espera / rodapé) — usados
 *  tanto na mensagem de abertura quanto nas atualizações, para o grupo ver
 *  sempre a mesma estrutura. */
function rosterLines(r: Roster): string[] {
  const lines: string[] = [`*Mensalistas:* (${r.membersHolding} de ${r.members.length} na lista)`];

  if (r.members.length === 0) {
    lines.push(`_nenhum mensalista cadastrado nesta turma_`);
  } else {
    r.members.forEach((m, i) => lines.push(memberLine(i + 1, m.name, m.status)));
  }

  lines.push(``, `*Não mensalistas:* (${r.dropinsOccupying} de ${r.dropinSlots} ${r.dropinSlots === 1 ? "vaga" : "vagas"})`);
  if (r.dropins.length === 0) {
    lines.push(`_ninguém ainda_`);
  } else {
    r.dropins.forEach((d, i) => {
      lines.push(d.status === "confirmed"
        ? `${i + 1}. ${d.name} ✅ _(pago)_`
        : `${i + 1}. ${d.name} 💰 _(aguardando pagamento)_`);
    });
  }

  if (r.waitlist.length) {
    lines.push(``, `*Lista de espera:*`, ...r.waitlist.map((w, i) => `${i + 1}. ${w.name}`));
  }

  lines.push(
    ``,
    r.dropinSlotsFree > 0
      ? `🟢 *Ainda cabem ${r.dropinSlotsFree} não ${r.dropinSlotsFree === 1 ? "mensalista" : "mensalistas"}*`
      : `🔴 *Lista completa — sem vagas para não mensalistas*`,
    `_Cada mensalista que avisar que não vem libera mais uma vaga._`,
  );

  return lines;
}

export async function buildListMessage(gameId: string): Promise<{ body: string; team: TeamInfo } | null> {
  const built = await buildRoster(gameId);
  if (!built) return null;
  const { roster: r, game: g, team: t } = built;
  const link = publicLink(t.slug);

  const lines: string[] = [
    `🏐 *${t.name}* | ${weekdayName(g.date)} — ${fmtDateFull(g.date)}`,
    `⏰ Horário: ${String(g.time).slice(0, 5)}`,
    `📍 Local: ${g.address}`,
    ``,
    `💰 Valor: ${fmtMoney(t.dropin_fee)} (não mensalistas)`,
    ``,
    ...rosterLines(r),
  ];

  if (link) lines.push(``, `👉 Confirme sua presença: ${link}`);

  return { body: lines.join("\n"), team: t };
}

/** Insere na fila e tenta despachar na hora (respeitando o modo da turma). */
async function enqueue(row: {
  team_id: string | null; game_id?: string | null; kind: "group" | "individual";
  recipient: string; body: string; dedupe_key?: string | null; delayMinutes?: number;
  /** false quando outra mensagem da mesma sequência vai disparar o envio */
  dispatch?: boolean;
}) {
  const db = supabaseAdmin();
  const delay = row.delayMinutes ?? 0;

  if (row.dedupe_key) {
    // substitui a mensagem pendente equivalente (debounce)
    await db.from("message_dispatches").update({ status: "canceled" })
      .eq("dedupe_key", row.dedupe_key).eq("status", "queued");
  }

  const { error } = await db.from("message_dispatches").insert({
    team_id: row.team_id,
    game_id: row.game_id ?? null,
    kind: row.kind,
    recipient: row.recipient,
    body: row.body,
    dedupe_key: row.dedupe_key ?? null,
    scheduled_for: new Date(Date.now() + delay * 60_000).toISOString(),
  });
  if (error) {
    console.error("[whatsapp] falha ao enfileirar:", error.message);
    return;
  }
  if (delay === 0 && row.dispatch !== false) {
    void dispatchPending().catch((e) => console.error("[whatsapp] despacho:", e));
  }
}

/** Envia a lista atualizada ao grupo, conforme o modo configurado na turma. */
export async function enqueueListUpdate(gameId: string) {
  const built = await buildListMessage(gameId);
  if (!built) return;
  const { body, team } = built;
  if (!team.whatsapp_group_id || team.message_mode === "manual") return;

  await enqueue({
    team_id: team.id, game_id: gameId, kind: "group",
    recipient: team.whatsapp_group_id, body,
    dedupe_key: `list_updated:${gameId}`,
    delayMinutes: team.message_mode === "batched" ? team.batch_minutes : 0,
  });
}

/** Anuncia no grupo que a lista abriu, já explicando a divisão de vagas. */
export async function enqueueListOpened(gameId: string) {
  const built = await buildRoster(gameId);
  if (!built?.team.whatsapp_group_id) return;
  const { roster: r, game: g, team: t } = built;
  if (t.message_mode === "manual") return;

  const link = publicLink(t.slug);
  const prazo = new Date(g.confirm_until).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  const lines = [
    `🏐 *LISTA ABERTA — ${t.name}*`,
    `📅 ${weekdayName(g.date)}, ${fmtDateFull(g.date)} às ${String(g.time).slice(0, 5)}`,
    `📍 Local: ${g.address}`,
    ``,
    `💰 Valor: ${fmtMoney(t.dropin_fee)} (não mensalistas)`,
    `👥 ${r.capacity} vagas no total`,
    ``,
    ...rosterLines(r),
    ``,
    `*Mensalistas:* confirmem se vão jogar até ${prazo}. Quem avisar que não vem libera a vaga.`,
    `*Não mensalistas:* garantam a vaga pagando o Pix pelo link — a vaga só é confirmada após o pagamento.`,
  ];
  if (link) lines.push(``, `👉 ${link}`);
  const body = lines.join("\n");

  await enqueue({
    team_id: t.id, game_id: gameId, kind: "group",
    recipient: t.whatsapp_group_id!, body,
    dedupe_key: `list_opened:${gameId}`,
  });
}

/**
 * Manda o Pix do avulso no WhatsApp em DUAS mensagens:
 *  1. as instruções;
 *  2. apenas o código copia e cola, sozinho.
 * O código precisa ficar isolado porque o WhatsApp transforma trechos dele
 * em link quando vem junto de outro texto, atrapalhando a cópia.
 */
export async function sendPixToPlayer(opts: {
  teamId: string; phone: string; playerName: string; teamName: string;
  date: string; time: string; amount: number; copypaste: string; minutes: number;
}) {
  const intro = [
    `🏐 Olá, ${opts.playerName.split(" ")[0]}!`,
    ``,
    `Sua vaga no *${opts.teamName}* de ${fmtDate(opts.date)} às ${String(opts.time).slice(0, 5)} está reservada por *${opts.minutes} minutos*.`,
    ``,
    `Valor: *${fmtMoney(opts.amount)}*`,
    ``,
    `📋 O código Pix vem na *próxima mensagem*: toque nela, segure e escolha _Copiar_ — depois é só colar no seu banco.`,
    ``,
    `Assim que o pagamento for identificado, sua presença é confirmada automaticamente. ✅`,
  ].join("\n");

  // primeira mensagem não dispara: a segunda dispara as duas, mantendo a ordem
  await enqueue({ team_id: opts.teamId, kind: "individual", recipient: opts.phone, body: intro, dispatch: false });
  await enqueue({ team_id: opts.teamId, kind: "individual", recipient: opts.phone, body: opts.copypaste.trim() });
}

/** Avisa o jogador que o pagamento foi confirmado. */
export async function sendPaymentConfirmed(teamId: string, phone: string, playerName: string, teamName: string, date: string) {
  const body = [
    `✅ Pagamento confirmado, ${playerName.split(" ")[0]}!`,
    ``,
    `Sua presença no *${teamName}* de ${fmtDate(date)} está garantida.`,
    `Bom jogo! 🏐`,
  ].join("\n");
  await enqueue({ team_id: teamId, kind: "individual", recipient: phone, body });
}

export async function enqueueIndividual(teamId: string | null, phone: string, body: string) {
  await enqueue({ team_id: teamId, kind: "individual", recipient: phone, body });
}

export async function enqueueGroupMessage(teamId: string, groupId: string, body: string, gameId?: string) {
  await enqueue({ team_id: teamId, game_id: gameId ?? null, kind: "group", recipient: groupId, body });
}

/**
 * Envio SÍNCRONO ao grupo, para ações manuais do admin que precisam de
 * retorno imediato ("enviado" ou o erro exato). Registra na fila como
 * sent/failed do mesmo jeito, para o histórico ficar completo.
 */
export async function sendGroupDirect(teamId: string, groupId: string, body: string, gameId?: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const db = supabaseAdmin();
  const { data: row } = await db.from("message_dispatches").insert({
    team_id: teamId, game_id: gameId ?? null, kind: "group",
    recipient: groupId, body, status: "sending",
  }).select("id").single();

  try {
    await GpConnect.sendGroupMessage(groupId, body);
    if (row) await db.from("message_dispatches").update({ status: "sent", sent_at: new Date().toISOString() }).eq("id", row.id);
    return { ok: true };
  } catch (e) {
    const error = String(e).slice(0, 300);
    if (row) await db.from("message_dispatches").update({ status: "failed", error }).eq("id", row.id);
    return { ok: false, error };
  }
}

/**
 * Envia as mensagens pendentes. Chamado logo após enfileirar e também pelo cron.
 * Falhas são reagendadas com espera progressiva; após 3 tentativas viram "failed"
 * e aparecem como alerta no painel.
 */
export async function dispatchPending(limit = 20): Promise<{ sent: number; failed: number }> {
  const db = supabaseAdmin();
  const { data: pending } = await db
    .from("message_dispatches")
    .select("*")
    .eq("status", "queued")
    .lte("scheduled_for", new Date().toISOString())
    .order("created_at", { ascending: true })
    .limit(limit);

  let sent = 0, failed = 0;
  for (const m of pending ?? []) {
    // marca como enviando para evitar envio duplicado por execuções simultâneas
    const { data: claimed } = await db
      .from("message_dispatches")
      .update({ status: "sending" })
      .eq("id", m.id)
      .eq("status", "queued")
      .select("id")
      .maybeSingle();
    if (!claimed) continue;

    try {
      if (m.kind === "group") await GpConnect.sendGroupMessage(m.recipient, m.body);
      else await GpConnect.sendTextMessage(m.recipient, m.body);
      await db.from("message_dispatches")
        .update({ status: "sent", sent_at: new Date().toISOString(), error: null })
        .eq("id", m.id);
      sent++;
    } catch (e) {
      failed++;
      const retries = (m.retries ?? 0) + 1;
      console.error(`[whatsapp] envio falhou (tentativa ${retries}):`, String(e).slice(0, 200));
      await db.from("message_dispatches").update({
        status: retries >= 3 ? "failed" : "queued",
        retries,
        error: String(e).slice(0, 500),
        scheduled_for: new Date(Date.now() + retries * 2 * 60_000).toISOString(),
      }).eq("id", m.id);
    }
  }
  return { sent, failed };
}

export { formatPhoneBR };
