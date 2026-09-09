// Cancelar / restaurar cobranças pelo painel, sem abrir o Asaas.
// Regra única usada pelo Financeiro (e por scripts): o Asaas é atualizado
// primeiro; só então o registro local muda — nunca ficam divergentes.
import { supabaseAdmin } from "@/lib/supabase/server";
import { Asaas } from "@/lib/asaas";

export type ChargeOpResult = { ok: true; note?: string } | { ok: false; error: string };

/** Cancela uma cobrança pendente/vencida. Avulso pendente também libera a vaga. */
export async function cancelChargeCore(chargeId: string, actor: { adminId?: string; reason?: string }): Promise<ChargeOpResult> {
  const db = supabaseAdmin();
  const { data: c } = await db.from("charges")
    .select("id, status, type, asaas_payment_id, game_id, player_id, players(name)")
    .eq("id", chargeId).maybeSingle();
  if (!c) return { ok: false, error: "Cobrança não encontrada." };
  if (!["pending", "overdue"].includes(c.status)) return { ok: false, error: `Só cobranças pendentes ou vencidas podem ser canceladas (esta está "${c.status}").` };

  if (c.asaas_payment_id) {
    try {
      const r = await Asaas.cancelPayment(c.asaas_payment_id);
      if (!r?.deleted) return { ok: false, error: "O Asaas não confirmou o cancelamento." };
    } catch (e) {
      return { ok: false, error: "O Asaas recusou o cancelamento: " + String(e).replace(/^Error:\s*/, "").slice(0, 200) };
    }
  }
  await db.from("charges").update({ status: "canceled", updated_at: new Date().toISOString() }).eq("id", c.id);

  // avulso que ainda não pagou: a reserva cai e a vaga volta (a fila anda, se houver)
  let note: string | undefined;
  if (c.type === "dropin" && c.game_id) {
    const { data: w } = await db.rpc("fn_withdraw_dropin", { p_game_id: c.game_id, p_player_id: c.player_id, p_source: "admin" });
    if (w?.ok) {
      note = "Cobrança cancelada e vaga liberada.";
      const promoted = (w.promoted ?? []) as string[];
      if (promoted.length) {
        const { processPromotions } = await import("@/lib/waitlist");
        await processPromotions(c.game_id, promoted).catch(() => {});
      } else {
        const { enqueueListUpdate } = await import("@/lib/messaging");
        await enqueueListUpdate(c.game_id).catch(() => {});
      }
    }
  }
  await db.from("audit_logs").insert({
    actor_type: actor.adminId ? "admin" : "system", actor_id: actor.adminId ?? null,
    action: "charge_canceled", entity: "charges", entity_id: c.id,
    after: { reason: actor.reason ?? null, player: (c.players as unknown as { name: string })?.name },
  });
  return { ok: true, note };
}

/** Restaura uma cobrança cancelada (o Asaas permite reativar pagamentos excluídos). */
export async function restoreChargeCore(chargeId: string, actor: { adminId?: string }): Promise<ChargeOpResult> {
  const db = supabaseAdmin();
  const { data: c } = await db.from("charges").select("id, status, asaas_payment_id, players(name)").eq("id", chargeId).maybeSingle();
  if (!c) return { ok: false, error: "Cobrança não encontrada." };
  if (c.status !== "canceled") return { ok: false, error: "Só cobranças canceladas podem ser restauradas." };
  if (!c.asaas_payment_id) return { ok: false, error: "Esta cobrança não tem pagamento no Asaas para restaurar." };

  let status = "pending";
  try {
    const p = await Asaas.restorePayment(c.asaas_payment_id);
    status = p.status === "OVERDUE" ? "overdue" : "pending";
  } catch (e) {
    return { ok: false, error: "O Asaas recusou a restauração: " + String(e).replace(/^Error:\s*/, "").slice(0, 200) };
  }
  await db.from("charges").update({ status, updated_at: new Date().toISOString() }).eq("id", c.id);
  await db.from("audit_logs").insert({
    actor_type: actor.adminId ? "admin" : "system", actor_id: actor.adminId ?? null,
    action: "charge_restored", entity: "charges", entity_id: c.id,
    after: { player: (c.players as unknown as { name: string })?.name },
  });
  return { ok: true, note: "Cobrança restaurada — o mesmo Pix volta a valer." };
}
