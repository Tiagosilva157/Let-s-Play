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

/** Pix de avulso pendente das últimas horas: pergunta ao Asaas se já foi pago. */
export async function reconcilePendingDropins(limit = 25) {
  const db = supabaseAdmin();
  const since = new Date(Date.now() - 6 * 3600e3).toISOString();
  const notTooNew = new Date(Date.now() - 30e3).toISOString(); // dá 30 s para o webhook chegar primeiro
  const { data: pending } = await db.from("charges")
    .select("id, asaas_payment_id, game_id")
    .eq("type", "dropin").eq("status", "pending")
    .not("asaas_payment_id", "is", null).not("game_id", "is", null)
    .gte("created_at", since).lte("created_at", notTooNew)
    .order("created_at", { ascending: true })
    .limit(limit);

  let checked = 0, confirmed = 0;
  for (const c of pending ?? []) {
    checked++;
    try {
      const p = await Asaas.getPayment(c.asaas_payment_id!);
      if (!PAID.has(p.status)) continue;
      const status = p.status === "CONFIRMED" ? "confirmed" : "received";
      // só avança se ainda estiver pendente (o webhook pode ter chegado no meio)
      const { data: upd } = await db.from("charges")
        .update({ status, paid_at: new Date().toISOString(), ...(p.status === "RECEIVED_IN_CASH" ? {} : { payment_method: "asaas_pix" }) })
        .eq("id", c.id).eq("status", "pending").select("id");
      if (!upd?.length) continue;
      const r = await applyDropinPaid(c.id, c.game_id!);
      if (r?.confirmed) confirmed++;
    } catch {
      // Asaas indisponível: tenta no próximo minuto
    }
  }
  return { checked, confirmed };
}
