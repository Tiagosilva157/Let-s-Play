import { NextRequest, NextResponse } from "next/server";
import { createHash, randomInt } from "crypto";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/server";
import { normalizePhone } from "@/lib/phone";
import { GpConnect } from "@/lib/gpconnect";

const Body = z.object({ phone: z.string().min(8).max(20) });

export async function POST(req: NextRequest) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_payload" }, { status: 400 });

  const phone = normalizePhone(parsed.data.phone);
  if (!phone) return NextResponse.json({ error: "invalid_phone" }, { status: 400 });

  const db = supabaseAdmin();
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0] ?? "unknown";

  // rate limit: máx 3 códigos por telefone / 10 min
  const tenMinAgo = new Date(Date.now() - 10 * 60_000).toISOString();
  const { count } = await db
    .from("otp_codes")
    .select("id", { count: "exact", head: true })
    .eq("phone", phone)
    .gte("created_at", tenMinAgo);
  if ((count ?? 0) >= 3) return NextResponse.json({ error: "too_many_requests" }, { status: 429 });

  const code = String(randomInt(100000, 999999));
  const codeHash = createHash("sha256").update(`${phone}:${code}`).digest("hex");
  const { error } = await db.from("otp_codes").insert({
    phone,
    code_hash: codeHash,
    expires_at: new Date(Date.now() + 5 * 60_000).toISOString(),
    request_ip: ip,
  });
  if (error) return NextResponse.json({ error: "internal" }, { status: 500 });

  try {
    await GpConnect.sendTextMessage(phone, `🏐 Seu código de acesso: *${code}*\nVálido por 5 minutos. Não compartilhe.`);
  } catch (e) {
    console.error("OTP send failed", e);
    return NextResponse.json({ error: "send_failed" }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}
