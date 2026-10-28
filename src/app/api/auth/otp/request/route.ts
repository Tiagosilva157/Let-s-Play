// Código de acesso por E-MAIL (Resend). Nada de OTP pelo WhatsApp.
//  - jogador com e-mail cadastrado: o código vai para esse e-mail
//  - jogador sem e-mail: a tela pede o e-mail; ele só é gravado após validar o código
//  - telefone novo: a tela pede nome + e-mail; o cadastro é criado após validar o código
import { NextRequest, NextResponse } from "next/server";
import { createHash, randomInt } from "crypto";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/server";
import { normalizePhone } from "@/lib/phone";
import { findPlayerByPhone } from "@/lib/player-lookup";
import { sendEmail, maskEmail } from "@/lib/email";

const Body = z.object({
  phone: z.string().min(8).max(20),
  email: z.string().max(120).optional(),
  name: z.string().min(2).max(80).optional(),
});
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export async function POST(req: NextRequest) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_payload" }, { status: 400 });

  const phone = normalizePhone(parsed.data.phone);
  if (!phone) return NextResponse.json({ error: "invalid_phone" }, { status: 400 });

  const player = await findPlayerByPhone(phone);
  if (player && !player.active) return NextResponse.json({ error: "player_inactive" }, { status: 403 });

  // destino: e-mail do cadastro; sem cadastro de e-mail, o informado na tela
  const typed = parsed.data.email?.trim().toLowerCase() || null;
  const email = player?.email?.trim().toLowerCase() || typed;
  if (!email) return NextResponse.json({ error: "needs_email" }, { status: 200 });
  if (!EMAIL_RE.test(email)) return NextResponse.json({ error: "invalid_email" }, { status: 200 });
  const name = player ? null : (parsed.data.name?.trim() || null);
  if (!player && !name) return NextResponse.json({ error: "needs_name" }, { status: 200 });

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
    expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
    request_ip: ip,
    email: player?.email ? null : email, // só guardamos o que ainda não está no cadastro
    name,
  });
  if (error) return NextResponse.json({ error: "internal" }, { status: 500 });

  const first = (player?.name ?? name ?? "").split(" ")[0];
  try {
    await sendEmail({
      to: email,
      subject: `Let's Play - seu código de acesso: ${code}`,
      text: `Olá, ${first}!\n\nSeu código de acesso ao Let's Play é: ${code}\n\nEle vale por 10 minutos. Se não foi você, ignore este e-mail.`,
      html: `<p>Olá, ${first}!</p><p>Seu código de acesso ao <b>Let's Play</b> é:</p>
<p style="font-size:32px;font-weight:700;letter-spacing:8px;margin:16px 0">${code}</p>
<p style="color:#666;font-size:13px">Ele vale por 10 minutos. Se não foi você, ignore este e-mail.</p>`,
    });
  } catch (e) {
    console.error("[email] otp:", String(e).slice(0, 200));
    // 200 de propósito: alguns proxies trocam respostas 5xx por uma página própria (sem JSON)
    return NextResponse.json({ error: "email_failed" }, { status: 200 });
  }

  return NextResponse.json({ ok: true, emailHint: maskEmail(email) });
}
