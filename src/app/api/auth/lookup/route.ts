// Primeiro passo do login: diz como este telefone pode entrar (senha, CPF, código por e-mail ou cadastro).
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { normalizePhone } from "@/lib/phone";
import { findPlayerByPhone } from "@/lib/player-lookup";
import { maskEmail } from "@/lib/email";

const Body = z.object({ phone: z.string().min(8).max(20) });

export async function POST(req: NextRequest) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  const phone = normalizePhone(parsed.data.phone);
  if (!phone) return NextResponse.json({ error: "invalid_phone" }, { status: 400 });

  const p = await findPlayerByPhone(phone);
  if (!p) return NextResponse.json({ ok: true, exists: false, method: "register" });
  if (!p.active) return NextResponse.json({ error: "player_inactive" }, { status: 403 });
  // com senha → senha; sem senha mas com CPF → primeiro acesso por CPF;
  // com e-mail → código por e-mail; sem e-mail → pedimos o e-mail antes do código
  const method = p.password_hash ? "password" : p.cpf_cnpj ? "cpf" : p.email ? "email" : "register";
  return NextResponse.json({
    ok: true, exists: true, method,
    firstName: p.name.split(" ")[0],
    emailHint: p.email ? maskEmail(p.email) : null,
  });
}
