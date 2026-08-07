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
  id: string; name: string; address: string; capacity: number;
  whatsapp_group_id: string | null; message_mode: string; batch_minutes: number; slug: string;
}

async function loadGame(gameId: string) {
  const db = supabaseAdmin();
  const { data: g } = await db
    .from("games")
    .select("id, date, time, address_override, capacity_override, status, confirm_until, teams(id, name, address, capacity, whatsapp_group_id, message_mode, batch_minutes, slug)")
    .eq("id", gameId)
    .maybeSingle();
  if (!g) return null;
  return { game: g, team: g.teams as unknown as TeamInfo };
}

export function publicLink(slug: string) {
  const base = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ?? "";
  return base ? `${base}/j/${slug}` : "";
}

export async function buildListMessage(gameId: string): Promise<{ body: string; team: TeamInfo } | null> {
  const loaded = await loadGame(gameId);
  if (!loaded) return null;
  const { game: g, team: t } = loaded;
  const db = supabaseAdmin();

  const { data: parts } = await db
    .from("game_participants")
    .select("kind, status, confirmed_at, players(name)")
    .eq("game_id", gameId)
    .in("status", ["confirmed", "waitlist"])
    .order("confirmed_at", { ascending: true });

  const confirmed = (parts ?? []).filter((p) => p.status === "confirmed");
  const waitlist = (parts ?? []).filter((p) => p.status === "waitlist");
  const capacity = g.capacity_override ?? t.capacity;
  const link = publicLink(t.slug);

  const lines = [
    `🏐 *Lista atualizada — ${t.name}*`,
    `📅 ${fmtDate(g.date)} às ${String(g.time).slice(0, 5)}`,
    `📍 ${g.address_override ?? t.address}`,
    ``,
    `*Confirmados (${confirmed.length}/${capacity}):*`,
    ...(confirmed.length
      ? confirmed.map((p, i) => {
          const name = (p.players as unknown as { name: string }).name;
          return `${i + 1}. ${name} — ${p.kind === "member" ? "Mensalista" : "Avulso ✅ Pago"}`;
        })
      : ["_ainda ninguém confirmou_"]),
  ];
  if (waitlist.length) {
    lines.push(``, `*Lista de espera:*`, ...waitlist.map((p, i) => `${i + 1}. ${(p.players as unknown as { name: string }).name}`));
  }
  const available = capacity - confirmed.length;
  lines.push(``, available > 0 ? `✅ Vagas disponíveis: *${available}*` : `🚫 Lista completa!`);
  if (link) lines.push(``, `Confirme sua presença: ${link}`);

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

/** Anuncia no grupo que a lista abriu. */
export async function enqueueListOpened(gameId: string) {
  const loaded = await loadGame(gameId);
  if (!loaded?.team.whatsapp_group_id) return;
  const { game: g, team: t } = loaded;
  if (t.message_mode === "manual") return;

  const link = publicLink(t.slug);
  const capacity = g.capacity_override ?? t.capacity;
  const body = [
    `🏐 *Lista aberta — ${t.name}*`,
    `📅 ${fmtDate(g.date)} às ${String(g.time).slice(0, 5)}`,
    `📍 ${g.address_override ?? t.address}`,
    `👥 ${capacity} vagas`,
    ``,
    `Confirme sua presença até ${new Date(g.confirm_until).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}.`,
    link ? `\n${link}` : "",
  ].filter(Boolean).join("\n");

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
