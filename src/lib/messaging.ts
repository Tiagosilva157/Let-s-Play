// Fila de mensagens WhatsApp com debounce por dedupe_key.
import { supabaseAdmin } from "@/lib/supabase/server";
import { formatPhoneBR } from "@/lib/phone";

/**
 * Em produção a fila é despachada pelo Vercel Cron (1/min).
 * Em desenvolvimento não há cron — então damos um "chute" na fila
 * chamando o endpoint localmente (fire-and-forget) após enfileirar.
 */
export function kickQueueInDev() {
  if (process.env.NODE_ENV === "production") return;
  const base = process.env.NEXT_PUBLIC_APP_URL?.startsWith("http://localhost")
    ? process.env.NEXT_PUBLIC_APP_URL
    : "http://localhost:3000";
  fetch(`${base}/api/cron/tick`, {
    headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
  }).catch(() => {});
}

function fmtDate(d: string) {
  const [y, m, day] = d.split("-");
  return `${day}/${m}/${y.slice(2)}`;
}

export async function buildListMessage(gameId: string): Promise<{ body: string; team: { whatsapp_group_id: string | null; message_mode: string; batch_minutes: number; id: string } } | null> {
  const db = supabaseAdmin();
  const { data: g } = await db
    .from("games")
    .select("id, date, time, address_override, capacity_override, teams(id, name, address, capacity, whatsapp_group_id, message_mode, batch_minutes, slug)")
    .eq("id", gameId)
    .single();
  if (!g) return null;
  const t = g.teams as unknown as { id: string; name: string; address: string; capacity: number; whatsapp_group_id: string | null; message_mode: string; batch_minutes: number; slug: string };

  const { data: parts } = await db
    .from("game_participants")
    .select("kind, status, created_at, players(name)")
    .eq("game_id", gameId)
    .in("status", ["confirmed", "waitlist"])
    .order("confirmed_at", { ascending: true });

  const confirmed = (parts ?? []).filter((p) => p.status === "confirmed");
  const waitlist = (parts ?? []).filter((p) => p.status === "waitlist");
  const capacity = g.capacity_override ?? t.capacity;
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";

  const lines = [
    `🏐 *Lista atualizada — ${t.name}*`,
    `📅 ${fmtDate(g.date)} às ${String(g.time).slice(0, 5)}`,
    `📍 ${g.address_override ?? t.address}`,
    ``,
    `*Confirmados (${confirmed.length}/${capacity}):*`,
    ...confirmed.map((p, i) => {
      const name = (p.players as unknown as { name: string }).name;
      return `${i + 1}. ${name} — ${p.kind === "member" ? "Mensalista" : "Avulso ✅ Pago"}`;
    }),
  ];
  if (waitlist.length) {
    lines.push(``, `*Lista de espera:*`, ...waitlist.map((p, i) => `${i + 1}. ${(p.players as unknown as { name: string }).name}`));
  }
  const available = capacity - confirmed.length;
  lines.push(``, available > 0 ? `✅ Vagas disponíveis: *${available}*` : `🚫 Lista completa!`);
  if (baseUrl) lines.push(``, `Confirme sua presença: ${baseUrl}/j/${t.slug}`);

  return { body: lines.join("\n"), team: t };
}

/** Enfileira atualização da lista no grupo, com debounce conforme message_mode. */
export async function enqueueListUpdate(gameId: string) {
  const built = await buildListMessage(gameId);
  if (!built || !built.team.whatsapp_group_id) return;
  const { body, team } = built;
  if (team.message_mode === "manual") return;

  const db = supabaseAdmin();
  const delayMin = team.message_mode === "batched" ? team.batch_minutes : 0;
  const dedupeKey = `list_updated:${gameId}`;

  // substitui pendente igual (debounce)
  await db.from("message_dispatches").update({ status: "canceled" }).eq("dedupe_key", dedupeKey).eq("status", "queued");
  await db.from("message_dispatches").insert({
    team_id: team.id,
    game_id: gameId,
    kind: "group",
    recipient: team.whatsapp_group_id,
    body,
    dedupe_key: dedupeKey,
    scheduled_for: new Date(Date.now() + delayMin * 60_000).toISOString(),
  });
  if (delayMin === 0) kickQueueInDev();
}

export async function enqueueIndividual(teamId: string | null, phone: string, body: string) {
  const db = supabaseAdmin();
  await db.from("message_dispatches").insert({
    team_id: teamId, kind: "individual", recipient: phone, body,
  });
  kickQueueInDev();
}

export { formatPhoneBR };
