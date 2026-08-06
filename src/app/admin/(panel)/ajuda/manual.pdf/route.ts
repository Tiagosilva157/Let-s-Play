// Download do Manual de uso em PDF (gerado a partir de src/lib/manual.ts).
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { buildManualPdf } from "@/lib/manual-pdf";

export async function GET(req: Request) {
  await requireAdmin();
  // ?view=1 abre no navegador; sem o parâmetro, baixa o arquivo
  const view = new URL(req.url).searchParams.get("view") === "1";
  const bytes = await buildManualPdf();
  return new NextResponse(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${view ? "inline" : "attachment"}; filename="lets-play-manual.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
