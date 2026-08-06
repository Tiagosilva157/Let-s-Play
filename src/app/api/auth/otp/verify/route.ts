import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/server";
import { normalizePhone } from "@/lib/phone";
import { createPlayerSession } from "@/lib/session";

const Body = z.object({
  phone: z.string().min(8).max(20),
  code: z.string().length(6),
  name: z.string().min(2).max(80).optional(), // primeiro acesso de jogador novo
});

export async function POST(req: NextRequest) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_payload" }, { status: 400 });

  const phone = normalizePhone(parsed.data.phone);
  if (!phone) return NextResponse.json({ error: "invalid_phone" }, { status: 400 });

  const db = supabaseAdmin();
  const { data: otp } = await db
    .from("otp_codes")
    .select("*")
    .eq("phone", phone)
    .is("consumed_at", null)
    .gte("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!otp) return NextResponse.json({ error: "code_expired" }, { status: 400 });
  if (otp.attempts >= 5) return NextResponse.json({ error: "too_many_attempts" }, { status: 429 });

  const hash = createHash("sha256").update(`${phone}:${parsed.data.code}`).digest("hex");
  if (hash !== otp.code_hash) {
    await db.from("otp_codes").update({ attempts: otp.attempts + 1 }).eq("id", otp.id);
    return NextResponse.json({ error: "wrong_code" }, { status: 400 });
  }

  await db.from("otp_codes").update({ consumed_at: new Date().toISOString() }).eq("id", otp.id);

  // busca ou cria jogador
  let { data: player } = await db.from("players").select("id, name, active").eq("phone", phone).maybeSingle();
  if (!player) {
    if (!parsed.data.name) return NextResponse.json({ ok: true, needs_name: true });
    const { data: created, error } = await db
      .from("players")
      .insert({ name: parsed.data.name.trim(), phone })
      .select("id, name, active")
      .single();
    if (error) return NextResponse.json({ error: "internal" }, { status: 500 });
    player = created;
  }
  if (!player.active) return NextResponse.json({ error: "player_inactive" }, { status: 403 });

  await createPlayerSession(player.id, req.headers.get("user-agent") ?? undefined);
  return NextResponse.json({ ok: true, player: { id: player.id, name: player.name } });
}
