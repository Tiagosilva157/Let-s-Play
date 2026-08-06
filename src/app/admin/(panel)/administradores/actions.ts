"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin, auditAdmin } from "@/lib/admin";
import { supabaseAdmin } from "@/lib/supabase/server";

const AdminSchema = z.object({
  name: z.string().min(2).max(80),
  email: z.string().email(),
  password: z.string().min(8).max(72),
});

export async function createAdmin(formData: FormData) {
  const me = await requireAdmin();
  if (me.role !== "owner") return { error: "Apenas o administrador principal pode criar novos administradores." };

  const parsed = AdminSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    if (issue.path[0] === "password") return { error: "A senha precisa ter pelo menos 8 caracteres." };
    if (issue.path[0] === "email") return { error: "E-mail inválido." };
    return { error: "Preencha todos os campos." };
  }

  const db = supabaseAdmin();
  const { data, error } = await db.auth.admin.createUser({
    email: parsed.data.email,
    password: parsed.data.password,
    email_confirm: true,
  });
  if (error) return { error: error.message.includes("already") ? "Já existe um usuário com esse e-mail." : "Erro ao criar usuário." };

  const { error: e2 } = await db.from("admins").insert({ id: data.user.id, name: parsed.data.name.trim(), role: "admin" });
  if (e2) {
    await db.auth.admin.deleteUser(data.user.id);
    return { error: "Erro ao registrar administrador." };
  }
  await auditAdmin(me.id, "create_admin", "admins", data.user.id, { email: parsed.data.email });
  revalidatePath("/admin/administradores");
  return { ok: true };
}

export async function resetAdminPassword(adminId: string, formData: FormData) {
  const me = await requireAdmin();
  if (me.role !== "owner" && me.id !== adminId) return { error: "Sem permissão." };

  const password = String(formData.get("password") ?? "");
  if (password.length < 8) return { error: "A senha precisa ter pelo menos 8 caracteres." };

  const db = supabaseAdmin();
  const { error } = await db.auth.admin.updateUserById(adminId, { password });
  if (error) return { error: "Erro ao alterar a senha." };
  await auditAdmin(me.id, "reset_admin_password", "admins", adminId);
  return { ok: true };
}

export async function deleteAdmin(adminId: string) {
  const me = await requireAdmin();
  if (me.role !== "owner") return { error: "Apenas o administrador principal pode remover administradores." };
  if (me.id === adminId) return { error: "Você não pode remover a si mesmo." };

  const db = supabaseAdmin();
  const { data: target } = await db.from("admins").select("role").eq("id", adminId).single();
  if (target?.role === "owner") return { error: "Não é possível remover o administrador principal." };

  await db.from("admins").delete().eq("id", adminId);
  await db.auth.admin.deleteUser(adminId);
  await auditAdmin(me.id, "delete_admin", "admins", adminId);
  revalidatePath("/admin/administradores");
  return { ok: true };
}
