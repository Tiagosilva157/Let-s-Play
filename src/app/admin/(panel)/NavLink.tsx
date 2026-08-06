"use client";

import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import Spinner from "@/components/Spinner";

function PendingDot() {
  const { pending } = useLinkStatus();
  if (!pending) return null;
  return <Spinner size={12} className="ml-1.5 inline-block align-middle" />;
}

export default function NavLink({ href, label }: { href: string; label: string }) {
  const pathname = usePathname();
  const active = href === "/admin" ? pathname === "/admin" : pathname.startsWith(href);

  return (
    <Link
      href={href}
      className={`flex shrink-0 items-center whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
        active
          ? "bg-[var(--brand)] text-white"
          : "text-[var(--ink-soft)] hover:bg-[var(--bg)] hover:text-[var(--ink)]"
      }`}
    >
      {label}
      <PendingDot />
    </Link>
  );
}
