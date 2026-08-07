// Cria/atualiza o cliente no Asaas a partir do cadastro do jogador.
// Regra do Asaas: sem CPF/CNPJ nenhuma cobrança pode ser emitida.
import { Asaas } from "@/lib/asaas";
import { supabaseAdmin } from "@/lib/supabase/server";

export class MissingCustomerDataError extends Error {
  constructor(public missing: ("cpf" | "email")[]) {
    super("Dados obrigatórios ausentes para cobrança");
    this.name = "MissingCustomerDataError";
  }
}

export interface PlayerContact {
  id: string; name: string; phone: string;
  email?: string | null; cpf_cnpj?: string | null; asaas_customer_id?: string | null;
}

/** Valida CPF (11) ou CNPJ (14) apenas pelo tamanho — o Asaas faz a validação completa. */
export function normalizeCpfCnpj(raw: string | null | undefined): string | null {
  const d = (raw ?? "").replace(/\D/g, "");
  return d.length === 11 || d.length === 14 ? d : null;
}

export function formatCpfCnpj(v: string | null | undefined): string {
  const d = (v ?? "").replace(/\D/g, "");
  if (d.length === 11) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  if (d.length === 14) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
  return v ?? "";
}

/**
 * Garante que o jogador tenha um cliente correspondente no Asaas,
 * criando-o (ou atualizando os dados) conforme necessário.
 * Lança MissingCustomerDataError quando faltar CPF.
 */
export async function ensureAsaasCustomer(player: PlayerContact): Promise<string> {
  const cpf = normalizeCpfCnpj(player.cpf_cnpj);
  if (!cpf) throw new MissingCustomerDataError(["cpf"]);

  const db = supabaseAdmin();
  const payload = {
    name: player.name.trim(),
    mobilePhone: player.phone,
    cpfCnpj: cpf,
    email: player.email?.trim() || undefined,
    externalReference: player.id,
  };

  if (player.asaas_customer_id) {
    // mantém os dados sincronizados (troca de telefone, e-mail, etc.)
    await Asaas.updateCustomer(player.asaas_customer_id, payload).catch(() => {});
    return player.asaas_customer_id;
  }

  const customer = await Asaas.createCustomer(payload);
  await db.from("players").update({ asaas_customer_id: customer.id }).eq("id", player.id);
  return customer.id;
}

/** Mensagem amigável para o admin/jogador quando faltam dados. */
export function customerDataErrorMessage(e: unknown): string | null {
  if (e instanceof MissingCustomerDataError) {
    return "Para gerar a cobrança é necessário informar o CPF do jogador (exigência do Asaas). Edite o cadastro e preencha o CPF.";
  }
  const msg = String(e);
  if (msg.includes("CPF ou CNPJ")) {
    return "O Asaas recusou a cobrança por falta de CPF/CNPJ válido no cadastro do jogador.";
  }
  return null;
}
