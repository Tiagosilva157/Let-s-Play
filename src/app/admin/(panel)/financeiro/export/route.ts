// Exporta o Financeiro em Excel (.xlsx) com os MESMOS filtros da tela.
//   ?what=charges  → aba "Cobranças" (inclui vagas pagas com crédito)
//   ?what=credits  → aba "Créditos"
import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { requireAdmin } from "@/lib/admin";
import { loadFinanceRows, loadCredits, STATUS_LABEL, CREDIT_LABEL } from "@/lib/finance";

export const dynamic = "force-dynamic";

const day = (d: string | null | undefined) => d ? d.split("-").reverse().join("/") : "";
const stamp = (iso: string) => iso ? new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "";

export async function GET(req: NextRequest) {
  await requireAdmin();
  const p = req.nextUrl.searchParams;
  const what = p.get("what") === "credits" ? "credits" : "charges";
  const wb = XLSX.utils.book_new();
  let name = "financeiro";

  if (what === "charges") {
    const rows = await loadFinanceRows({
      type: p.get("type") ?? undefined, status: p.get("status") ?? undefined,
      from: p.get("from") ?? undefined, to: p.get("to") ?? undefined,
      q: p.get("q") ?? undefined, team: p.get("team") ?? undefined,
    });
    const data = rows.map((r) => r.kind === "charge" ? {
      "Data": stamp(r.at),
      "Jogador": r.playerName,
      "Turma": r.teamName,
      "Tipo": r.type === "dropin" ? "Avulso" : "Mensalidade",
      "Jogo": day(r.gameDate),
      "Vencimento": day(r.dueDate),
      "Valor (R$)": r.amount,
      "Situação": STATUS_LABEL[r.status] ?? r.status,
      "Pagamento Asaas": r.asaasPaymentId ?? "",
    } : {
      "Data": stamp(r.at),
      "Jogador": r.playerName,
      "Turma": r.teamName,
      "Tipo": "Avulso (crédito)",
      "Jogo": day(r.usedGameDate),
      "Vencimento": "",
      "Valor (R$)": r.amount,
      "Situação": `Pago com crédito${r.originGameDate ? ` do jogo de ${day(r.originGameDate)}` : ""}`,
      "Pagamento Asaas": "",
    });
    const total = rows.reduce((s, r) => s + r.amount, 0);
    data.push({ "Data": "", "Jogador": "TOTAL", "Turma": "", "Tipo": "", "Jogo": "", "Vencimento": "", "Valor (R$)": total, "Situação": `${rows.length} linhas`, "Pagamento Asaas": "" });
    const ws = XLSX.utils.json_to_sheet(data);
    ws["!cols"] = [18, 30, 16, 16, 12, 12, 12, 34, 20].map((w) => ({ wch: w }));
    XLSX.utils.book_append_sheet(wb, ws, "Cobranças");
    name = "cobrancas";
  } else {
    const credits = await loadCredits({ only: p.get("only") ?? undefined, q: p.get("q") ?? undefined, team: p.get("team") ?? undefined });
    const data = credits.map((c) => ({
      "Jogador": c.playerName,
      "Turma": c.teamName,
      "Valor (R$)": c.amount,
      "Situação": CREDIT_LABEL[c.status] ?? c.status,
      "Origem": c.reason,
      "Jogo de origem": day(c.originGameDate),
      "Gerado em": stamp(c.createdAt),
      "Usado no jogo de": day(c.usedGameDate),
      "Pode virar dinheiro": c.status === "available" ? (c.refundable ? "Sim" : "Não (após o prazo)") : "",
    }));
    const total = credits.filter((c) => c.status === "available").reduce((s, c) => s + c.amount, 0);
    data.push({ "Jogador": "TOTAL DISPONÍVEL", "Turma": "", "Valor (R$)": total, "Situação": `${credits.length} linhas`, "Origem": "", "Jogo de origem": "", "Gerado em": "", "Usado no jogo de": "", "Pode virar dinheiro": "" });
    const ws = XLSX.utils.json_to_sheet(data);
    ws["!cols"] = [30, 16, 12, 12, 40, 14, 18, 16, 20].map((w) => ({ wch: w }));
    XLSX.utils.book_append_sheet(wb, ws, "Créditos");
    name = "creditos";
  }

  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="lets-play-${name}-${today}.xlsx"`,
    },
  });
}
