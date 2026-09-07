"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin, auditAdmin } from "@/lib/admin";
import { supabaseAdmin } from "@/lib/supabase/server";

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
