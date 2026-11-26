// Rede de segurança do pagamento de avulso: se o webhook do Asaas não chegar
// (fila pausada, deploy, token errado), o robô de 1 minuto consulta o Asaas e
// confirma a vaga. O webhook continua sendo o caminho principal; os dois são
// idempotentes (fn_confirm_dropin_payment trava o jogo e responde "already").
import { supabaseAdmin } from "@/lib/supabase/server";
import { Asaas } from "@/lib/asaas";
import { enqueueListUpdate, sendPaymentConfirmed } from "@/lib/messaging";

const PAID = new Set(["RECEIVED", "CONFIRMED", "RECEIVED_IN_CASH"]);

/** Confirma a vaga de uma cobrança de avulso já paga e avisa grupo e jogador. */
export async function applyDropinPaid(chargeId: string, gameId: string) {
  const db = supabaseAdmin();
  const { data: result } = await db.rpc("fn_confirm_dropin_payment", { p_charge_id: chargeId });
  if (result?.confirmed) {
    await enqueueListUpdate(gameId).catch((e) => console.error("[pagamento] lista:", e));
    const { data: info } = await db.from("charges")
      .select("team_id, players(name, phone), games(date), teams(name)").eq("id", chargeId).single();
    if (info) {
      const pl = info.players as unknown as { name: string; phone: string };
      const tm = info.teams as unknown as { name: string };
      const gm = info.games as unknown as { date: string } | null;
      await sendPaymentConfirmed(info.team_id, pl.phone, pl.name, tm.name, gm?.date ?? "").catch(() => {});
    }
  }
  if (result?.pending_review) {
    await db.from("audit_logs").insert({
      actor_type: "system", actor_id: "payment_sync", action: "payment_after_full_list",
      entity: "charges", entity_id: chargeId, after: result,
    });
  }
  return result;
}

/** Status do pagamento no Asaas se estiver pago; null se não (ou se o Asaas não respondeu). */
export async function isPaidOnAsaas(asaasPaymentId: string): Promise<string | null> {
  try {
    const p = await Asaas.getPayment(asaasPaymentId);
    return PAID.has(p.status) ? p.status : null;
  } catch {
    return null;
  }
}

/** Marca a cobrança como paga (se ainda pendente/expirada) e confirma a vaga. */
export async function markPaidAndConfirm(chargeId: string, gameId: string, asaasStatus: string) {
  const db = supabaseAdmin();
  const status = asaasStatus === "CONFIRMED" ? "confirmed" : "received";
  // só avança a partir de pendente/expirada (o webhook pode ter chegado no meio)
  const { data: upd } = await db.from("charges")
    .update({ status, paid_at: new Date().toISOString(), ...(asaasStatus === "RECEIVED_IN_CASH" ? {} : { payment_method: "asaas_pix" }) })
    .eq("id", chargeId).in("status", ["pending", "expired"]).select("id");
  if (!upd?.length) return null;
  return applyDropinPaid(chargeId, gameId);
}

/**
 * Pix de avulso das últimas horas que o sistema ainda não viu pago — pendentes E
 * expirados (a reserva pode ter vencido antes do aviso do Asaas chegar). Pergunta
 * ao Asaas; se foi pago, confirma a vaga (ou manda para "pagou sem vaga" se a lista encheu).
 */
export async function reconcilePendingDropins(limit = 30, hours = 6) {
  const db = supabaseAdmin();
  const since = new Date(Date.now() - hours * 3600e3).toISOString();
  const notTooNew = new Date(Date.now() - 30e3).toISOString(); // dá 30 s para o webhook chegar primeiro
  const { data: rows } = await db.from("charges")
    .select("id, asaas_payment_id, game_id, status")
    .eq("type", "dropin").in("status", ["pending", "expired"])
    .not("asaas_payment_id", "is", null).not("game_id", "is", null)
    .gte("created_at", since).lte("created_at", notTooNew)
    .order("status", { ascending: false }) // pendentes primeiro
    .order("created_at", { ascending: true })
    .limit(limit);

  let checked = 0, confirmed = 0, review = 0;
  for (const c of rows ?? []) {
    checked++;
    const paid = await isPaidOnAsaas(c.asaas_payment_id!);
    if (!paid) continue;
    const r = await markPaidAndConfirm(c.id, c.game_id!, paid);
    if (r?.confirmed) confirmed++;
    if (r?.pending_review) review++;
  }
  return { checked, confirmed, review };
}
