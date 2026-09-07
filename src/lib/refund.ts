// Estorno em dinheiro de uma cobrança paga — usado pela tela do jogo e pelo
// Financeiro (crédito → devolver em dinheiro). Uma única regra para os dois:
//  • nunca pede um segundo estorno se já há um em andamento;
//  • o Asaas pode exigir autorização de "ação crítica": nesse caso o estorno
//    fica pendente lá e o webhook PAYMENT_REFUNDED conclui por aqui;
//  • concluído → cobrança "refunded" e o crédito daquela cobrança é revogado.
import { supabaseAdmin } from "@/lib/supabase/server";
import { Asaas, pendingRefundOf } from "@/lib/asaas";
import { revokeCreditsForCharge } from "@/lib/credits";

export const AWAITING_NOTE =
  "Estorno solicitado! O Asaas exige a sua autorização (ação crítica): aprove no app ou painel do Asaas. Assim que aprovar, o sistema marca como estornado sozinho.";
export const ALREADY_PENDING_NOTE =
  "Já existe um estorno deste pagamento aguardando a SUA autorização no Asaas (ação crítica). Aprove lá — não é preciso clicar de novo. Quando concluir, o sistema atualiza sozinho.";

export type RefundResult =
  | { ok: true; done: true }
  | { ok: true; done: false; note: string }
  | { ok: false; error: string };

export async function refundChargeInCash(chargeId: string): Promise<RefundResult> {
  const db = supabaseAdmin();
  const { data: charge } = await db.from("charges")
    .select("id, status, asaas_payment_id").eq("id", chargeId).maybeSingle();
  if (!charge) return { ok: false, error: "Cobrança não encontrada." };
  if (charge.status === "refunded") return { ok: false, error: "Esta cobrança já foi estornada." };
  if (!charge.asaas_payment_id) return { ok: false, error: "Esta cobrança não tem pagamento no Asaas para estornar." };

  const before = await Asaas.getPayment(charge.asaas_payment_id).catch(() => null);
  if (before && pendingRefundOf(before)) return { ok: true, done: false, note: ALREADY_PENDING_NOTE };

  let awaiting = false;
  try {
    const resp = await Asaas.refundPayment(charge.asaas_payment_id);
    awaiting = !!pendingRefundOf(resp);
  } catch (e) {
    const after = await Asaas.getPayment(charge.asaas_payment_id).catch(() => null);
    if (after && pendingRefundOf(after)) {
      awaiting = true;
    } else {
      return { ok: false, error: "O Asaas recusou o estorno: " + String(e).replace(/^Error:\s*/, "").slice(0, 220) };
    }
  }
  if (awaiting) return { ok: true, done: false, note: AWAITING_NOTE };

  await db.from("charges").update({ status: "refunded" }).eq("id", charge.id);
  await revokeCreditsForCharge(charge.id);
  return { ok: true, done: true };
}
