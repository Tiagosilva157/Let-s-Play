"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin, auditAdmin } from "@/lib/admin";
import { supabaseAdmin } from "@/lib/supabase/server";

const TeamSchema = z.object({
  name: z.string().min(2).max(60),
  slug: z.string().min(2).max(40).regex(/^[a-z0-9-]+$/),
  weekday: z.coerce.number().int().min(0).max(6),
  game_time: z.string().regex(/^\d{2}:\d{2}$/),
  address: z.string().min(3).max(200),
  capacity: z.coerce.number().int().min(2).max(100),
  monthly_fee: z.coerce.number().min(0),
  dropin_fee: z.coerce.number().min(0),
  open_hours_before: z.coerce.number().int().min(1).max(720),
  confirm_hours_before: z.coerce.number().int().min(0).max(720),
  withdraw_hours_before: z.coerce.number().int().min(0).max(720),
  whatsapp_group_id: z.string().max(120).optional().or(z.literal("")),
  message_mode: z.enum(["instant", "batched", "scheduled", "manual"]),
});

export async function saveTeam(id: string | null, formData: FormData) {
  const admin = await requireAdmin();
  const parsed = TeamSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Dados inválidos: " + parsed.error.issues.map((i) => i.path.join(".")).join(", ") };

  const db = supabaseAdmin();
  const values = { ...parsed.data, whatsapp_group_id: parsed.data.whatsapp_group_id || null };

  if (id) {
    const { error } = await db.from("teams").update(values).eq("id", id);
    if (error) return { error: error.code === "23505" ? "Já existe uma turma com esse link." : "Erro ao salvar." };
    await auditAdmin(admin.id, "update_team", "teams", id, values);
  } else {
    const { data, error } = await db.from("teams").insert(values).select("id").single();
    if (error) return { error: error.code === "23505" ? "Já existe uma turma com esse link." : "Erro ao criar." };
    await auditAdmin(admin.id, "create_team", "teams", data.id, values);
    await db.rpc("fn_generate_games");
  }
  revalidatePath("/admin/turmas");
  return { ok: true };
}

export async function toggleTeamStatus(id: string, active: boolean) {
  const admin = await requireAdmin();
  const db = supabaseAdmin();
  await db.from("teams").update({ status: active ? "active" : "inactive" }).eq("id", id);
  await auditAdmin(admin.id, active ? "activate_team" : "deactivate_team", "teams", id);
  revalidatePath("/admin/turmas");
}

const MemberSchema = z.object({
  player_name: z.string().min(2).max(80),
  player_phone: z.string().min(10).max(20),
  player_email: z.string().max(120).optional().or(z.literal("")),
  player_cpf: z.string().max(20).optional().or(z.literal("")),
  // campo vazio chega como "" e viraria 0 com z.coerce — normalizamos antes
  monthly_fee_override: z.preprocess(
    (v) => (v === "" || v === null || v === undefined ? undefined : v),
    z.coerce.number().positive().optional()
  ),
  due_day: z.coerce.number().int().min(1).max(28).default(10),
});

export async function addMember(teamId: string, formData: FormData) {
  const admin = await requireAdmin();
  const parsed = MemberSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Dados inválidos." };

  const { normalizePhone } = await import("@/lib/phone");
  const phone = normalizePhone(parsed.data.player_phone);
  if (!phone) return { error: "Telefone inválido." };

  const { normalizeCpfCnpj } = await import("@/lib/asaas-customer");
  const cpf = normalizeCpfCnpj(parsed.data.player_cpf);
  if (parsed.data.player_cpf && !cpf) return { error: "CPF/CNPJ inválido." };
  const email = parsed.data.player_email?.trim() || null;

  const db = supabaseAdmin();
  // busca ou cria jogador (mantendo e-mail/CPF atualizados para o Asaas)
  let { data: player } = await db.from("players").select("id").eq("phone", phone).maybeSingle();
  if (!player) {
    const { data, error } = await db.from("players")
      .insert({ name: parsed.data.player_name.trim(), phone, email, cpf_cnpj: cpf })
      .select("id").single();
    if (error) return { error: "Erro ao criar jogador." };
    player = data;
  } else if (email || cpf) {
    await db.from("players").update({
      ...(email ? { email } : {}),
      ...(cpf ? { cpf_cnpj: cpf } : {}),
    }).eq("id", player.id);
  }
  const { error } = await db.from("team_members").insert({
    team_id: teamId,
    player_id: player.id,
    monthly_fee_override: parsed.data.monthly_fee_override ?? null,
    due_day: parsed.data.due_day,
  });
  if (error) return { error: error.code === "23505" ? "Esse jogador já é mensalista da turma." : "Erro ao vincular." };
  await auditAdmin(admin.id, "add_member", "team_members", player.id);
  revalidatePath(`/admin/turmas`);
  return { ok: true };
}

/** Cria a assinatura mensal no Asaas para um mensalista. */
export async function activateSubscription(memberId: string) {
  const admin = await requireAdmin();
  const db = supabaseAdmin();
  const { data: m } = await db
    .from("team_members")
    .select("id, team_id, player_id, monthly_fee_override, due_day, asaas_subscription_id, teams(name, monthly_fee), players(id, name, phone, email, cpf_cnpj, asaas_customer_id)")
    .eq("id", memberId).single();
  if (!m) return { error: "Mensalista não encontrado." };
  if (m.asaas_subscription_id) return { error: "Assinatura já existe." };

  const player = m.players as unknown as {
    id: string; name: string; phone: string;
    email: string | null; cpf_cnpj: string | null; asaas_customer_id: string | null;
  };
  const team = m.teams as unknown as { name: string; monthly_fee: number };
  const value = Number(m.monthly_fee_override ?? team.monthly_fee);
  if (!(value > 0)) {
    return { error: "Defina um valor de mensalidade maior que zero (na turma ou no mensalista)." };
  }

  const { Asaas } = await import("@/lib/asaas");
  const { ensureAsaasCustomer, customerDataErrorMessage } = await import("@/lib/asaas-customer");
  try {
    // cria/atualiza o cliente no Asaas com CPF e e-mail (exigência da API)
    const customerId = await ensureAsaasCustomer(player);
    // primeiro vencimento: próximo dia due_day
    const now = new Date();
    const due = new Date(now.getFullYear(), now.getMonth() + (now.getDate() >= m.due_day ? 1 : 0), m.due_day);
    const sub = await Asaas.createSubscription({
      customer: customerId,
      value,
      nextDueDate: due.toISOString().slice(0, 10),
      description: `Mensalidade — ${team.name}`,
      externalReference: `sub:${player.id}:${m.team_id}`,
    });
    await db.from("team_members").update({ asaas_subscription_id: sub.id, subscription_status: "active" }).eq("id", m.id);
    await auditAdmin(admin.id, "activate_subscription", "team_members", m.id, { value, subscription: sub.id });
    revalidatePath("/admin/turmas");
    return { ok: true };
  } catch (e) {
    console.error("[asaas] assinatura:", e);
    const friendly = customerDataErrorMessage(e);
    return { error: friendly ?? "Falha ao criar assinatura no Asaas: " + String(e).slice(0, 160) };
  }
}

/** Pausa/cancela a assinatura no Asaas. */
export async function cancelSubscription(memberId: string) {
  const admin = await requireAdmin();
  const db = supabaseAdmin();
  const { data: m } = await db.from("team_members").select("id, asaas_subscription_id").eq("id", memberId).single();
  if (!m?.asaas_subscription_id) return { error: "Sem assinatura ativa." };
  const { Asaas } = await import("@/lib/asaas");
  try {
    await Asaas.cancelSubscription(m.asaas_subscription_id);
  } catch (e) {
    console.error(e);
    return { error: "Falha ao cancelar no Asaas." };
  }
  await db.from("team_members").update({ asaas_subscription_id: null, subscription_status: "canceled" }).eq("id", m.id);
  await auditAdmin(admin.id, "cancel_subscription", "team_members", m.id);
  revalidatePath("/admin/turmas");
  return { ok: true };
}

export async function removeMember(memberId: string) {
  const admin = await requireAdmin();
  const db = supabaseAdmin();
  await db.from("team_members").update({ status: "inactive" }).eq("id", memberId);
  await auditAdmin(admin.id, "remove_member", "team_members", memberId);
  revalidatePath(`/admin/turmas`);
}
