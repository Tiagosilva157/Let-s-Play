import Link from "next/link";
import { requireAdmin } from "@/lib/admin";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const admin = await requireAdmin();
  const nav = [
    { href: "/admin", label: "Visão geral" },
    { href: "/admin/turmas", label: "Turmas" },
    { href: "/admin/jogos", label: "Jogos" },
    { href: "/admin/jogadores", label: "Jogadores" },
    { href: "/admin/financeiro", label: "Financeiro" },
    { href: "/admin/administradores", label: "Administradores" },
    { href: "/admin/configuracoes", label: "Configurações" },
    { href: "/admin/ajuda", label: "Manual" },
  ];
  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-10 border-b border-[var(--line)] bg-[var(--surface)]">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.svg" alt="Let's Play" className="h-8 w-auto" />
          <span className="text-sm text-[var(--ink-soft)]">{admin.name}</span>
        </div>
        <nav className="mx-auto flex max-w-5xl gap-1 overflow-x-auto px-4 pb-2">
          {nav.map((n) => (
            <Link key={n.href} href={n.href}
              className="whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium text-[var(--ink-soft)] hover:bg-[var(--bg)] hover:text-[var(--ink)]">
              {n.label}
            </Link>
          ))}
        </nav>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6">{children}</main>
    </div>
  );
}
