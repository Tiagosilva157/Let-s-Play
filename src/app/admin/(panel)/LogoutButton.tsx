"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";
import Spinner from "@/components/Spinner";

export default function LogoutButton({ name }: { name: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function logout() {
    if (!confirm("Deseja sair do painel?")) return;
    setLoading(true);
    const sb = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
    await sb.auth.signOut();
    router.replace("/admin/login");
    router.refresh();
  }

  return (
    <div className="flex items-center gap-2">
      <span className="hidden text-sm text-[var(--ink-soft)] sm:inline">{name}</span>
      <button
        onClick={logout}
        disabled={loading}
        className="flex items-center gap-1.5 rounded-lg border border-[var(--line)] px-3 py-1.5 text-sm font-medium text-[var(--ink-soft)] transition-colors hover:bg-[var(--bg)] hover:text-[var(--ink)] disabled:opacity-60"
      >
        {loading ? (
          <Spinner size={14} />
        ) : (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
            <polyline points="16 17 21 12 16 7" />
            <line x1="21" y1="12" x2="9" y2="12" />
          </svg>
        )}
        Sair
      </button>
    </div>
  );
}
