import { redirect } from "next/navigation";
import { supabaseServer, supabaseAdmin } from "@/lib/supabase/server";

/** Garante admin logado; redireciona para /admin/login caso contrário. */
export async function requireAdmin() {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect("/admin/login");
  const db = supabaseAdmin();
  const { data: admin } = await db.from("admins").select("id, name, role").eq("id", user.id).maybeSingle();
  if (!admin) redirect("/admin/login");
  return admin;
}

export async function auditAdmin(adminId: string, action: string, entity: string, entityId?: string, after?: unknown) {
  const db = supabaseAdmin();
  await db.from("audit_logs").insert({
    actor_type: "admin", actor_id: adminId, action, entity,
    entity_id: entityId ?? null, after: after ?? null,
  });
}
