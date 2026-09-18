// Define/troca a senha do jogador logado (e guarda o e-mail para o "esqueci a senha").
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/server";
import { getSessionPlayer } from "@/lib/session";
import { hashPassword, passwordProblem } from "@/lib/password";

const Body = z.object({ password: z.string().max(72), email: z.string().max(120).optional() });

export async function POST(req: NextRequest) {
  const player = await getSessionPlayer();
  if (!player) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  const problem = passwordProblem(parsed.data.password);
  if (problem) return NextResponse.json({ error: "weak_password", message: problem }, { status: 200 });

  const email = parsed.data.email?.trim().toLowerCase();
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return NextResponse.json({ error: "invalid_email" }, { status: 200 });

  const db = supabaseAdmin();
  await db.from("players").update({
    password_hash: hashPassword(parsed.data.password), password_set_at: new Date().toISOString(),
    ...(email ? { email } : {}),
  }).eq("id", player.id);
  return NextResponse.json({ ok: true });
}
