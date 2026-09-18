// "Esqueci a senha": manda um link por e-mail (Resend). Sem e-mail → orienta o código no WhatsApp.
import { NextRequest, NextResponse } from "next/server";
import { createHash, randomBytes } from "crypto";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/server";
import { normalizePhone } from "@/lib/phone";
import { findPlayerByPhone } from "@/lib/player-lookup";
import { sendEmail, maskEmail } from "@/lib/email";
import { publicLink } from "@/lib/messaging";

const Body = z.object({ phone: z.string().min(8).max(20), slug: z.string().max(60).optional() });

export async function POST(req: NextRequest) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  const phone = normalizePhone(parsed.data.phone);
  if (!phone) return NextResponse.json({ error: "invalid_phone" }, { status: 400 });

  const p = await findPlayerByPhone(phone);
  if (!p || !p.email) return NextResponse.json({ error: "no_email" }, { status: 200 });

  const db = supabaseAdmin();
  // limite: 3 pedidos por hora
  const hourAgo = new Date(Date.now() - 3600e3).toISOString();
  const { count } = await db.from("password_resets").select("id", { count: "exact", head: true })
    .eq("player_id", p.id).gte("created_at", hourAgo);
  if ((count ?? 0) >= 3) return NextResponse.json({ error: "too_many_requests" }, { status: 429 });

  const token = randomBytes(24).toString("hex");
  const slug = parsed.data.slug ?? null;
  await db.from("password_resets").insert({
    player_id: p.id, token_hash: createHash("sha256").update(token).digest("hex"), slug,
    expires_at: new Date(Date.now() + 60 * 60_000).toISOString(),
  });
  // o link volta para o jogo de onde a pessoa pediu (ou para a raiz do site)
  const base = slug ? publicLink(slug) : (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/+$/, "");
  const link = `${base}?reset=${token}`;
  const first = p.name.split(" ")[0];
  try {
    await sendEmail({
      to: p.email,
      subject: "Let's Play - redefinir sua senha",
      text: `Olá, ${first}!\n\nPara criar uma nova senha no Let's Play, abra este link (vale por 1 hora):\n${link}\n\nSe não foi você, ignore este e-mail.`,
      html: `<p>Olá, ${first}!</p><p>Para criar uma nova senha no <b>Let's Play</b>, clique no botão (vale por 1 hora):</p>
<p><a href="${link}" style="display:inline-block;padding:12px 20px;background:#1d4ed8;color:#fff;border-radius:10px;text-decoration:none;font-weight:600">Criar nova senha</a></p>
<p style="color:#666;font-size:13px">Ou copie o link: ${link}<br>Se não foi você, ignore este e-mail.</p>`,
    });
  } catch (e) {
    console.error("[email] reset:", String(e).slice(0, 200));
    return NextResponse.json({ error: "email_failed" }, { status: 200 });
  }
  return NextResponse.json({ ok: true, emailHint: maskEmail(p.email) });
}
