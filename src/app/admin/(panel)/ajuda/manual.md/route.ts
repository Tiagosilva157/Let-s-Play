// Gera o manual em Markdown a partir da mesma base de conhecimento da tela,
// para o administrador baixar, imprimir ou compartilhar.
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { MANUAL, type Block } from "@/lib/manual";

function render(b: Block): string {
  switch (b.type) {
    case "p": return b.text;
    case "steps": return b.items.map((t, i) => `${i + 1}. ${t}`).join("\n");
    case "list": return b.items.map((t) => `- ${t}`).join("\n");
    case "fields": return b.items.map((f) => `- **${f.label}** — ${f.text}`).join("\n");
    case "tip": return `> **Dica:** ${b.text}`;
    case "warn": return `> **Atenção:** ${b.text}`;
  }
}

export async function GET() {
  await requireAdmin();

  const body = [
    "# Let's Play — Manual de uso",
    "",
    "Sistema de gestão de turmas de vôlei: confirmação de presença, mensalistas, pagamentos e avisos no WhatsApp.",
    "",
    "## Índice",
    "",
    ...MANUAL.map((s) => `- ${s.icon} ${s.title} — ${s.summary}`),
    "",
    ...MANUAL.flatMap((s) => [
      `## ${s.icon} ${s.title}`,
      "",
      ...s.blocks.flatMap((b) => [render(b), ""]),
    ]),
  ].join("\n");

  return new NextResponse(body, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": 'attachment; filename="lets-play-manual.md"',
    },
  });
}
