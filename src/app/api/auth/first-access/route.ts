// Primeiro acesso sem código: telefone + CPF cadastrado. Cria a sessão e pede senha.
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { normalizePhone } from "@/lib/phone";
import { normalizeCpfCnpj } from "@/lib/asaas-customer";
import { findPlayerByPhone, recentFailures, recordAttempt } from "@/lib/player-lookup";
import { createPlayerSession } from "@/lib/session";

const Body = z.object({ phone: z.string().min(8).max(20), cpf: z.string().min(11).max(20) });

export async function POST(req: NextRequest) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  const phone = normalizePhone(parsed.data.phone);
  const cpf = normalizeCpfCnpj(parsed.data.cpf);
  if (!phone || !cpf) return NextResponse.json({ error: "invalid_payload" }, { status: 400 });

  if (await recentFailures(phone) >= 8) return NextResponse.json({ error: "too_many_attempts" }, { status: 429 });

  const p = await findPlayerByPhone(phone);
  if (!p || !p.cpf_cnpj || normalizeCpfCnpj(p.cpf_cnpj) !== cpf) {
    await recordAttempt(phone, false);
    return NextResponse.json({ error: "cpf_mismatch" }, { status: 200 });
  }
  if (!p.active) return NextResponse.json({ error: "player_inactive" }, { status: 403 });
  await recordAttempt(phone, true);
  await createPlayerSession(p.id, req.headers.get("user-agent") ?? undefined);
  return NextResponse.json({ ok: true, needs_password: !p.password_hash, email: p.email, player: { id: p.id, name: p.name } });
}
