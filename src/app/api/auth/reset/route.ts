// Conclui o "esqueci a senha": valida o token do e-mail, grava a nova senha e entra.
import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/server";
import { hashPassword, passwordProblem } from "@/lib/password";
import { createPlayerSession } from "@/lib/session";

const Body = z.object({ token: z.string().min(20).max(80), password: z.string().max(72) });

export async function POST(req: NextRequest) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  const problem = passwordProblem(parsed.data.password);
  if (problem) return NextResponse.json({ error: "weak_password", message: problem }, { status: 200 });

  const db = supabaseAdmin();
  const hash = createHash("sha256").update(parsed.data.token).digest("hex");
  const { data: r } = await db.from("password_resets").select("id, player_id, expires_at, consumed_at")
    .eq("token_hash", hash).maybeSingle();
  if (!r || r.consumed_at || new Date(r.expires_at) < new Date()) {
    return NextResponse.json({ error: "reset_invalid" }, { status: 200 });
  }
  await db.from("players").update({ password_hash: hashPassword(parsed.data.password), password_set_at: new Date().toISOString() }).eq("id", r.player_id);
  await db.from("password_resets").update({ consumed_at: new Date().toISOString() }).eq("id", r.id);
  const { data: p } = await db.from("players").select("id, name, active").eq("id", r.player_id).single();
  if (!p?.active) return NextResponse.json({ error: "player_inactive" }, { status: 403 });
  await createPlayerSession(p.id, req.headers.get("user-agent") ?? undefined);
  return NextResponse.json({ ok: true, player: { id: p.id, name: p.name } });
}
