import { requireAdmin } from "@/lib/admin";
import { supabaseAdmin } from "@/lib/supabase/server";
import AdminManager, { type AdminRow } from "./AdminManager";

export const dynamic = "force-dynamic";

export default async function AdminsPage() {
  const me = await requireAdmin();
  const db = supabaseAdmin();

  const { data: admins } = await db.from("admins").select("id, name, role").order("created_at");
  const { data: users } = await db.auth.admin.listUsers({ perPage: 200 });
  const emailById = new Map(users.users.map((u) => [u.id, u.email ?? ""]));

  const rows: AdminRow[] = (admins ?? []).map((a) => ({
    id: a.id,
    name: a.name,
    email: emailById.get(a.id) ?? "",
    role: a.role,
    isMe: a.id === me.id,
  }));

  return <AdminManager admins={rows} meIsOwner={me.role === "owner"} />;
}
