"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin, auditAdmin } from "@/lib/admin";
import { supabaseAdmin } from "@/lib/supabase/server";

/**
 * Devolve em dinheiro o pagamento que originou um crédito disponível.
 * Concluído → cobrança estornada e crédito revogado. Se o Asaas exigir a sua
 * autorização, o crédito continua válido até o estorno concluir (webhook).
 */
export async function refundCreditInCash(creditId: string) {
  const admin = await requireAdmin();
  const db = supabaseAdmin();
  const { data: credit } = await db.from("credits")
    .select("id, status, origin_charge_id").eq("id", creditId).maybeSingle();
  if (!credit) return { error: "Crédito não encontrado." };
  if (credit.status !== "available") return { error: "Só créditos disponíveis podem ser devolvidos em dinheiro." };
  if (!credit.origin_charge_id) return { error: "Este crédito não veio de um pagamento no Asaas — não há o que estornar." };

  const { refundChargeInCash } = await import("@/lib/refund");
  const res = await refundChargeInCash(credit.origin_charge_id);
  if (!res.ok) return { error: res.error };
  await auditAdmin(admin.id, res.done ? "credit_refunded_in_cash" : "refund_awaiting_authorization", "credits", creditId);
  revalidatePath("/admin/financeiro");
  return res.done ? { ok: true } : { ok: true, note: res.note };
}

/** Cancela uma cobrança pendente/vencida no Asaas e no sistema (ex.: pagou em dinheiro). */
export async function cancelCharge(chargeId: string, reason: string) {
  const admin = await requireAdmin();
  const { cancelChargeCore } = await import("@/lib/charges");
  const res = await cancelChargeCore(chargeId, { adminId: admin.id, reason: reason?.trim() || undefined });
  if (!res.ok) return { error: res.error };
  revalidatePath("/admin/financeiro");
  return { ok: true, note: res.note };
}

/** Desfaz um cancelamento: a cobrança volta a valer com o mesmo Pix. */
export async function restoreCharge(chargeId: string) {
  const admin = await requireAdmin();
  const { restoreChargeCore } = await import("@/lib/charges");
  const res = await restoreChargeCore(chargeId, { adminId: admin.id });
  if (!res.ok) return { error: res.error };
  revalidatePath("/admin/financeiro");
  return { ok: true, note: res.note };
}

/** Revoga um crédito disponível (ex.: concedido por engano). */
export async function revokeCredit(creditId: string) {
  const admin = await requireAdmin();
  const db = supabaseAdmin();
  const { data } = await db
    .from("credits")
    .update({ status: "revoked", updated_at: new Date().toISOString() })
    .eq("id", creditId)
    .eq("status", "available")
    .select("id")
    .maybeSingle();
  if (!data) return { error: "Crédito não encontrado ou já usado." };
  await auditAdmin(admin.id, "revoke_credit", "credits", creditId);
  revalidatePath("/admin/financeiro");
  return { ok: true };
}
