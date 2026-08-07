"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin, auditAdmin } from "@/lib/admin";
import { supabaseAdmin } from "@/lib/supabase/server";
import { normalizePhone } from "@/lib/phone";

const PlayerSchema = z.object({
  name: z.string().min(2).max(80),
  phone: z.string().min(10).max(20),
  // e-mail e CPF são exigidos pelo Asaas para emitir cobranças
  email: z.string().max(120).optional().or(z.literal("")),
  cpf_cnpj: z.string().max(20).optional().or(z.literal("")),
  notes: z.string().max(500).optional().or(z.literal("")),
});

/** Normaliza e valida os campos de cobrança; devolve erro amigável. */
async function billingFields(data: { email?: string; cpf_cnpj?: string }) {
  const { normalizeCpfCnpj } = await import("@/lib/asaas-customer");
  const raw = data.cpf_cnpj?.trim();
  const cpf = normalizeCpfCnpj(raw);
  if (raw && !cpf) return { error: "CPF/CNPJ inválido. Use 11 dígitos (CPF) ou 14 (CNPJ)." };
  const email = data.email?.trim() || null;
  if (email && !email.includes("@")) return { error: "E-mail inválido." };
  return { values: { email, cpf_cnpj: cpf } };
}

/** Sincroniza os vínculos de mensalista do jogador com as turmas marcadas. */
async function syncMemberships(playerId: string, teamIds: string[]) {
  const db = supabaseAdmin();
  const { data: current } = await db
    .from("team_members")
    .select("id, team_id, status")
    .eq("player_id", playerId);

  for (const m of current ?? []) {
    if (teamIds.includes(m.team_id)) {
      if (m.status !== "active") await db.from("team_members").update({ status: "active" }).eq("id", m.id);
    } else if (m.status === "active") {
      await db.from("team_members").update({ status: "inactive" }).eq("id", m.id);
    }
  }
  const existing = new Set((current ?? []).map((m) => m.team_id));
  for (const teamId of teamIds) {
    if (!existing.has(teamId)) {
      await db.from("team_members").insert({ team_id: teamId, player_id: playerId });
    }
  }
}

export async function createPlayer(formData: FormData) {
  const admin = await requireAdmin();
  const parsed = PlayerSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Preencha nome e telefone corretamente." };

  const phone = normalizePhone(parsed.data.phone);
  if (!phone) return { error: "Telefone inválido. Use DDD + número." };

  const billing = await billingFields(parsed.data);
  if (billing.error) return { error: billing.error };

  const db = supabaseAdmin();
  const { data, error } = await db
    .from("players")
    .insert({
      name: parsed.data.name.trim(), phone, notes: parsed.data.notes || null,
      ...billing.values,
    })
    .select("id")
    .single();
  if (error) return { error: error.code === "23505" ? "Já existe um jogador com esse telefone." : "Erro ao criar jogador." };

  await syncMemberships(data.id, formData.getAll("team_ids").map(String));
  await auditAdmin(admin.id, "create_player", "players", data.id, { name: parsed.data.name, phone });
  revalidatePath("/admin/jogadores");
  return { ok: true };
}

export async function updatePlayer(playerId: string, formData: FormData) {
  const admin = await requireAdmin();
  const parsed = PlayerSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Dados inválidos." };

  const phone = normalizePhone(parsed.data.phone);
  if (!phone) return { error: "Telefone inválido." };

  const billing = await billingFields(parsed.data);
  if (billing.error) return { error: billing.error };

  const db = supabaseAdmin();
  const { data: before } = await db.from("players").select("phone").eq("id", playerId).single();
  const { error } = await db
    .from("players")
    .update({
      name: parsed.data.name.trim(), phone, notes: parsed.data.notes || null,
      ...billing.values,
    })
    .eq("id", playerId);
  if (error) return { error: error.code === "23505" ? "Já existe um jogador com esse telefone." : "Erro ao salvar." };

  // troca de telefone → invalida sessões antigas
  if (before && before.phone !== phone) {
    await db.from("player_sessions").update({ revoked_at: new Date().toISOString() }).eq("player_id", playerId);
  }
  await syncMemberships(playerId, formData.getAll("team_ids").map(String));
  await auditAdmin(admin.id, "update_player", "players", playerId, { name: parsed.data.name, phone });
  revalidatePath("/admin/jogadores");
  return { ok: true };
}

export async function togglePlayerActive(playerId: string, active: boolean) {
  const admin = await requireAdmin();
  const db = supabaseAdmin();
  await db.from("players").update({ active }).eq("id", playerId);
  if (!active) {
    await db.from("player_sessions").update({ revoked_at: new Date().toISOString() }).eq("player_id", playerId);
  }
  await auditAdmin(admin.id, active ? "activate_player" : "deactivate_player", "players", playerId);
  revalidatePath("/admin/jogadores");
}
