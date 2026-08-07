// Cascata da lista de espera.
//
// Fluxo aprovado:
//  1. Vaga abre → banco promove o 1º da fila (status reserved, prazo de 15 min).
//  2. Este módulo gera o Pix, avisa o promovido no WhatsApp e anuncia no grupo.
//  3. Não pagou no prazo → cron expira (vira 'removed', fora deste jogo),
//     o banco promove o próximo e este módulo repete os avisos.
import { supabaseAdmin } from "@/lib/supabase/server";
import { Asaas } from "@/lib/asaas";
import { ensureAsaasCustomer } from "@/lib/asaas-customer";
import {
  enqueueGroupMessage, enqueueIndividual, enqueueListUpdate,
  sendPixToPlayer, publicLink,
} from "@/lib/messaging";

interface PromotedInfo {
  participantId: string;
  playerId: string;
  playerName: string;
  playerPhone: string;
  reservedUntil: string | null;
  kind: string;
}

function firstName(name: string) {
  return name.split(" ")[0];
}

function fmtDate(d: string) {
  const [y, m, day] = d.split("-");
  return `${day}/${m}/${y.slice(2)}`;
}

async function loadContext(gameId: string) {
  const db = supabaseAdmin();
  const { data: g } = await db
    .from("games")
    .select("id, date, time, team_id, teams(id, name, slug, dropin_fee, reservation_minutes, whatsapp_group_id, message_mode)")
    .eq("id", gameId)
    .maybeSingle();
  if (!g) return null;
  return {
    game: g,
    team: g.teams as unknown as {
      id: string; name: string; slug: string; dropin_fee: number;
      reservation_minutes: number; whatsapp_group_id: string | null; message_mode: string;
    },
  };
}

/**
 * Trata os participantes recém-promovidos: gera o Pix (quando possível),
 * avisa cada um no privado e anuncia a movimentação no grupo.
 */
export async function processPromotions(gameId: string, promotedIds: string[] | null | undefined) {
  const ids = (promotedIds ?? []).filter(Boolean);
  if (!ids.length) return;

  const db = supabaseAdmin();
  const ctx = await loadContext(gameId);
  if (!ctx) return;
  const { game, team } = ctx;

  const { data: parts } = await db
    .from("game_participants")
    .select("id, player_id, kind, status, reserved_until, players(id, name, phone, email, cpf_cnpj, asaas_customer_id)")
    .in("id", ids);

  const promoted: PromotedInfo[] = (parts ?? []).map((p) => {
    const pl = p.players as unknown as { id: string; name: string; phone: string };
    return {
      participantId: p.id, playerId: pl.id, playerName: pl.name, playerPhone: pl.phone,
      reservedUntil: p.reserved_until, kind: p.kind,
    };
  });

  for (const p of parts ?? []) {
    const pl = p.players as unknown as {
      id: string; name: string; phone: string;
      email: string | null; cpf_cnpj: string | null; asaas_customer_id: string | null;
    };

    if (p.kind !== "dropin" || p.status !== "reserved") continue; // mensalista promovido já entra confirmado

    // 1. tenta gerar a cobrança na hora (precisa de CPF)
    let pixSent = false;
    try {
      const customerId = await ensureAsaasCustomer(pl);
      const payment = await Asaas.createPixPayment({
        customer: customerId,
        value: Number(team.dropin_fee),
        dueDate: new Date().toISOString().slice(0, 10),
        description: `${team.name} — jogo ${game.date} (lista de espera)`,
        externalReference: `${gameId}:${pl.id}`,
      });
      const qr = await Asaas.getPixQr(payment.id);
      const { data: charge } = await db.from("charges").insert({
        player_id: pl.id, team_id: team.id, game_id: gameId,
        type: "dropin", asaas_payment_id: payment.id, amount: team.dropin_fee,
        status: "pending", pix_qr: qr.encodedImage, pix_copypaste: qr.payload,
        expires_at: p.reserved_until,
      }).select("id").single();
      await db.from("game_participants").update({ charge_id: charge!.id }).eq("id", p.id);

      await sendPixToPlayer({
        teamId: team.id, phone: pl.phone, playerName: pl.name, teamName: team.name,
        date: game.date, time: String(game.time), amount: Number(team.dropin_fee),
        copypaste: qr.payload, minutes: team.reservation_minutes ?? 15,
      });
      pixSent = true;
    } catch (e) {
      console.error("[waitlist] pix na promoção:", String(e).slice(0, 200));
    }

    // 2. sem CPF (ou falha no Asaas): manda o link para concluir por lá
    if (!pixSent) {
      const link = publicLink(team.slug);
      await enqueueIndividual(team.id, pl.phone, [
        `🎉 ${firstName(pl.name)}, abriu vaga no *${team.name}* de ${fmtDate(game.date)}!`,
        ``,
        `Você subiu da lista de espera e tem *${team.reservation_minutes ?? 15} minutos* para garantir a vaga pagando o Pix.`,
        ``,
        `Acesse o link para gerar o pagamento:`,
        `👉 ${link}`,
      ].join("\n")).catch(() => {});
    }
  }

  // 3. anuncia no grupo (uma mensagem por movimentação)
  if (team.whatsapp_group_id && team.message_mode !== "manual" && promoted.length) {
    const nomes = promoted.map((p) => `*${firstName(p.playerName)}*`).join(", ");
    const linha = promoted.length === 1
      ? `🔔 ${nomes} subiu da lista de espera e tem ${team.reservation_minutes ?? 15} minutos para confirmar o pagamento.`
      : `🔔 ${nomes} subiram da lista de espera e têm ${team.reservation_minutes ?? 15} minutos para confirmar o pagamento.`;
    await enqueueGroupMessage(team.id, team.whatsapp_group_id, linha, gameId).catch(() => {});
  }

  await enqueueListUpdate(gameId).catch(() => {});
}

export interface ExpiredRow {
  id: string; game_id: string; player_id: string;
  charge_id: string | null; promoted_from_waitlist: boolean;
}

/**
 * Trata reservas expiradas: cancela a cobrança pendente, avisa quem perdeu
 * a vez (se veio da fila) e anuncia no grupo. As promoções em cascata já
 * foram feitas pelo banco e chegam via processPromotions.
 */
export async function processExpirations(expired: ExpiredRow[] | null | undefined) {
  const rows = expired ?? [];
  if (!rows.length) return;
  const db = supabaseAdmin();

  for (const row of rows) {
    // cancela a cobrança órfã
    if (row.charge_id) {
      const { data: c } = await db.from("charges")
        .select("id, asaas_payment_id, status").eq("id", row.charge_id).maybeSingle();
      if (c && c.status === "pending") {
        if (c.asaas_payment_id) await Asaas.cancelPayment(c.asaas_payment_id).catch(() => {});
        await db.from("charges").update({ status: "expired" }).eq("id", c.id);
      }
    }

    const ctx = await loadContext(row.game_id);
    if (!ctx) continue;
    const { team } = ctx;
    const { data: pl } = await db.from("players").select("name, phone").eq("id", row.player_id).maybeSingle();
    if (!pl) continue;

    if (row.promoted_from_waitlist) {
      // perdeu a vez definitivamente neste jogo
      await enqueueIndividual(team.id, pl.phone, [
        `⏰ ${firstName(pl.name)}, o prazo de pagamento da sua vaga no *${team.name}* terminou.`,
        ``,
        `A vaga foi passada para o próximo da lista de espera, conforme as regras da turma.`,
      ].join("\n")).catch(() => {});

      if (team.whatsapp_group_id && team.message_mode !== "manual") {
        await enqueueGroupMessage(
          team.id, team.whatsapp_group_id,
          `⏰ *${firstName(pl.name)}* não confirmou o pagamento no prazo e perdeu a vez. A vaga segue para o próximo da lista de espera.`,
          row.game_id
        ).catch(() => {});
      }
    }
  }
}
