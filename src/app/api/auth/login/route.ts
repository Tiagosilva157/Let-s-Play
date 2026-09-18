// Login por senha.
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { normalizePhone } from "@/lib/phone";
import { findPlayerByPhone, recentFailures, recordAttempt } from "@/lib/player-lookup";
import { verifyPassword } from "@/lib/password";
import { createPlayerSession } from "@/lib/session";

const Body = z.object({ phone: z.string().min(8).max(20), password: z.string().min(1).max(72) });

export async function POST(req: NextRequest) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  const phone = normalizePhone(parsed.data.phone);
  if (!phone) return NextResponse.json({ error: "invalid_phone" }, { status: 400 });

  if (await recentFailures(phone) >= 8) return NextResponse.json({ error: "too_many_attempts" }, { status: 429 });

  const p = await findPlayerByPhone(phone);
  if (!p || !p.password_hash || !verifyPassword(parsed.data.password, p.password_hash)) {
    await recordAttempt(phone, false);
    return NextResponse.json({ error: "wrong_password" }, { status: 200 });
  }
  if (!p.active) return NextResponse.json({ error: "player_inactive" }, { status: 403 });
  await recordAttempt(phone, true);
  await createPlayerSession(p.id, req.headers.get("user-agent") ?? undefined);
  return NextResponse.json({ ok: true, player: { id: p.id, name: p.name } });
}
