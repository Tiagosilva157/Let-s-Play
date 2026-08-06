"use client";

import { useMemo, useState } from "react";
import type { Block, ManualSection } from "@/lib/manual";

function blockText(b: Block): string {
  if (b.type === "p" || b.type === "tip" || b.type === "warn") return b.text;
  if (b.type === "fields") return b.items.map((i) => `${i.label} ${i.text}`).join(" ");
  return b.items.join(" ");
}

export default function Manual({ sections }: { sections: ManualSection[] }) {
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<string | null>(sections[0]?.id ?? null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sections;
    return sections.filter((s) =>
      [s.title, s.summary, ...s.blocks.map(blockText)].join(" ").toLowerCase().includes(q)
    );
  }, [query, sections]);

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Manual de uso</h1>
          <p className="text-sm text-[var(--ink-soft)]">
            Tudo o que o Let&apos;s Play faz, explicado passo a passo. Use a busca para ir direto ao ponto.
          </p>
        </div>
        <a href="/admin/ajuda/manual.md" className="btn btn-outline btn-sm shrink-0">⬇ Baixar manual</a>
      </div>

      <input
        className="input"
        placeholder="🔍 Buscar no manual (ex.: mensalista, pix, grupo, prazo)"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      {query && (
        <p className="text-sm text-[var(--ink-soft)]">
          {filtered.length === 0
            ? "Nada encontrado. Tente outra palavra."
            : `${filtered.length} ${filtered.length === 1 ? "tópico encontrado" : "tópicos encontrados"}.`}
        </p>
      )}

      <div className="space-y-2">
        {filtered.map((s) => {
          const open = query ? true : openId === s.id;
          return (
            <section key={s.id} className="card overflow-hidden">
              <button
                className="flex w-full items-center gap-3 p-4 text-left"
                onClick={() => setOpenId(open && !query ? null : s.id)}
              >
                <span className="text-xl" aria-hidden>{s.icon}</span>
                <span className="min-w-0 flex-1">
                  <span className="block font-bold">{s.title}</span>
                  <span className="block text-sm text-[var(--ink-soft)]">{s.summary}</span>
                </span>
                {!query && (
                  <span className="shrink-0 text-[var(--ink-soft)]" aria-hidden>{open ? "−" : "+"}</span>
                )}
              </button>

              {open && (
                <div className="space-y-4 border-t border-[var(--line)] px-4 py-5 sm:px-5">
                  {s.blocks.map((b, i) => <BlockView key={i} block={b} />)}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}

function BlockView({ block }: { block: Block }) {
  switch (block.type) {
    case "p":
      return <p className="text-[0.95rem] leading-relaxed">{block.text}</p>;

    case "steps":
      return (
        <ol className="space-y-2.5">
          {block.items.map((t, i) => (
            <li key={i} className="flex gap-3 text-[0.95rem] leading-relaxed">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--brand)] text-xs font-bold text-white">
                {i + 1}
              </span>
              <span>{t}</span>
            </li>
          ))}
        </ol>
      );

    case "list":
      return (
        <ul className="space-y-2">
          {block.items.map((t, i) => (
            <li key={i} className="flex gap-2.5 text-[0.95rem] leading-relaxed">
              <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--brand)]" aria-hidden />
              <span>{t}</span>
            </li>
          ))}
        </ul>
      );

    case "fields":
      return (
        <dl className="divide-y divide-[var(--line)] rounded-xl bg-[var(--bg)]">
          {block.items.map((f, i) => (
            <div key={i} className="p-3.5">
              <dt className="text-sm font-semibold">{f.label}</dt>
              <dd className="text-[0.9rem] leading-relaxed text-[var(--ink-soft)]">{f.text}</dd>
            </div>
          ))}
        </dl>
      );

    case "tip":
      return (
        <p className="rounded-xl bg-[var(--success-bg)] px-4 py-3 text-[0.9rem] leading-relaxed text-[var(--success)]">
          <b>Dica:</b> {block.text}
        </p>
      );

    case "warn":
      return (
        <p className="rounded-xl bg-[var(--warn-bg)] px-4 py-3 text-[0.9rem] leading-relaxed text-[var(--warn)]">
          <b>Atenção:</b> {block.text}
        </p>
      );
  }
}
