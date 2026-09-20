// Pix de uma cobrança do próprio jogador (mensalidade ou jogo): devolve o código
// copia-e-cola e o QR, buscando no Asaas quando ainda não está guardado.
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/server";
import { getSessionPlayer } from "@/lib/session";
import { Asaas } from "@/lib/asaas";

const Body = z.object({ chargeId: z.string().uuid() });

export async function POST(req: NextRequest) {
  const player = await getSessionPlayer();
  if (!player) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_payload" }, { status: 400 });

  const db = supabaseAdmin();
  const { data: c } = await db.from("charges")
    .select("id, player_id, status, amount, pix_qr, pix_copypaste, asaas_payment_id")
    .eq("id", parsed.data.chargeId).maybeSingle();
  if (!c || c.player_id !== player.id) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!["pending", "overdue"].includes(c.status)) return NextResponse.json({ error: "not_payable" }, { status: 200 });

  let qr = c.pix_qr, copy = c.pix_copypaste;
  if (!copy && c.asaas_payment_id) {
    try {
      const r = await Asaas.getPixQr(c.asaas_payment_id);
      qr = r.encodedImage; copy = r.payload;
      await db.from("charges").update({ pix_qr: qr, pix_copypaste: copy }).eq("id", c.id);
    } catch (e) {
      console.error("[pix] getPixQr:", String(e).slice(0, 150));
      return NextResponse.json({ error: "payment_provider_error" }, { status: 502 });
    }
  }
  if (!copy) return NextResponse.json({ error: "not_payable" }, { status: 200 });
  return NextResponse.json({ ok: true, pix: { qr: qr ?? "", copypaste: copy, amount: Number(c.amount) } });
}
