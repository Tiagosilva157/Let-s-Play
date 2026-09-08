// Qual versão está no ar? Lê o public/version.json gerado no build.
import { NextResponse } from "next/server";
import { readFileSync } from "fs";
import { join } from "path";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const raw = readFileSync(join(process.cwd(), "public", "version.json"), "utf8");
    const info = JSON.parse(raw) as { commit: string | null; builtAt: string };
    return NextResponse.json({
      ...info,
      builtAtBR: new Date(info.builtAt).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }),
    });
  } catch {
    return NextResponse.json({ commit: null, builtAt: null, note: "version.json não gerado neste build" });
  }
}
