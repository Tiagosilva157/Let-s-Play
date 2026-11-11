// Exporta todos os jogadores em Excel (.xlsx): dados cadastrais, nível (estrelas),
// turmas em que é mensalista, situação da assinatura e um resumo.
import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { requireAdmin } from "@/lib/admin";
import { supabaseAdmin } from "@/lib/supabase/server";
import { formatPhoneBR } from "@/lib/phone";
import { formatCpfCnpj } from "@/lib/asaas-customer";

export const dynamic = "force-dynamic";

const SKILL_LABEL: Record<number, string> = {
  1: "Iniciante", 2: "Em desenvolvimento", 3: "Intermediário", 4: "Acima da média", 5: "Experiente / alto nível",
};
const SUB_LABEL: Record<string, string> = {
  none: "Sem assinatura", active: "Ativa", paused: "Pausada", canceled: "Cancelada", overdue: "Em atraso",
};
const stamp = (iso: string | null | undefined) => iso ? new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "";

export async function GET() {
  await requireAdmin();
  const db = supabaseAdmin();
  const { data: players } = await db
    .from("players")
    .select("id, name, phone, email, cpf_cnpj, notes, active, skill_level, created_at, password_set_at, team_members(status, due_day, subscription_status, monthly_fee_override, teams(name, monthly_fee))")
    .order("name");

  type Membership = { status: string; due_day: number; subscription_status: string; monthly_fee_override: number | null; teams: { name: string; monthly_fee: number } | null };

  const rows = (players ?? []).map((p) => {
    const skill = p.skill_level ?? 3;
    const memberships = ((p.team_members as unknown as Membership[] | null) ?? []).filter((m) => m.status === "active" && m.teams);
    const isMember = memberships.length > 0;
    return {
      "Nome": p.name,
      "Telefone": formatPhoneBR(p.phone),
      "E-mail": p.email ?? "",
      "CPF": formatCpfCnpj(p.cpf_cnpj),
      "Nível (estrelas)": skill,
      "Nível": SKILL_LABEL[skill] ?? "",
      "Tipo": isMember ? "Mensalista" : "Avulso",
      "Turmas (mensalista)": memberships.map((m) => m.teams!.name).join(", "),
      "Mensalidade (R$)": memberships.map((m) => Number(m.monthly_fee_override ?? m.teams!.monthly_fee)).join(", "),
      "Dia do vencimento": memberships.map((m) => m.due_day).join(", "),
      "Assinatura": memberships.map((m) => SUB_LABEL[m.subscription_status] ?? m.subscription_status).join(", "),
      "Situação": p.active ? "Ativo" : "Inativo",
      "Senha criada": p.password_set_at ? "Sim" : "Não",
      "Observações": p.notes ?? "",
      "Cadastrado em": stamp(p.created_at),
    };
  });

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows);
  ws["!cols"] = [30, 18, 30, 16, 8, 22, 12, 28, 14, 12, 16, 10, 10, 40, 18].map((w) => ({ wch: w }));
  XLSX.utils.book_append_sheet(wb, ws, "Jogadores");

  // resumo
  const total = rows.length;
  const ativos = rows.filter((r) => r["Situação"] === "Ativo").length;
  const mensalistas = rows.filter((r) => r["Tipo"] === "Mensalista").length;
  const byTeam = new Map<string, number>();
  for (const p of players ?? []) {
    for (const m of ((p.team_members as unknown as Membership[] | null) ?? []).filter((m) => m.status === "active" && m.teams)) {
      byTeam.set(m.teams!.name, (byTeam.get(m.teams!.name) ?? 0) + 1);
    }
  }
  const summary = [
    { "Indicador": "Total de jogadores cadastrados", "Quantidade": total },
    { "Indicador": "Ativos", "Quantidade": ativos },
    { "Indicador": "Inativos", "Quantidade": total - ativos },
    { "Indicador": "Mensalistas", "Quantidade": mensalistas },
    { "Indicador": "Avulsos", "Quantidade": total - mensalistas },
    { "Indicador": "Sem CPF", "Quantidade": rows.filter((r) => !r["CPF"]).length },
    { "Indicador": "Sem e-mail", "Quantidade": rows.filter((r) => !r["E-mail"]).length },
    { "Indicador": "Com senha criada", "Quantidade": rows.filter((r) => r["Senha criada"] === "Sim").length },
    ...[1, 2, 3, 4, 5].map((s) => ({ "Indicador": `Nível ${"★".repeat(s)} (${SKILL_LABEL[s]})`, "Quantidade": rows.filter((r) => r["Nível (estrelas)"] === s).length })),
    ...[...byTeam.entries()].sort().map(([name, n]) => ({ "Indicador": `Mensalistas: ${name}`, "Quantidade": n })),
  ];
  const ws2 = XLSX.utils.json_to_sheet(summary);
  ws2["!cols"] = [40, 12].map((w) => ({ wch: w }));
  XLSX.utils.book_append_sheet(wb, ws2, "Resumo");

  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="lets-play-jogadores-${today}.xlsx"`,
    },
  });
}
