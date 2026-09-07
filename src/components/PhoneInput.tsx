"use client";

import { useState } from "react";

/** Aplica a máscara brasileira (XX) 9XXXX-XXXX enquanto digita. */
export function maskPhoneBR(raw: string) {
  // remove o DDI 55 se a pessoa colar o número internacional
  const d = raw.replace(/\D/g, "").replace(/^55(?=\d{10,11}$)/, "").slice(0, 11);
  if (d.length === 0) return "";
  if (d.length <= 2) return `(${d}`;
  if (d.length <= 7) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

export function phoneDigits(masked: string) {
  return masked.replace(/\D/g, "").replace(/^55(?=\d{10,11}$)/, "");
}

/** Celular completo: DDD + 9 dígitos (o nono dígito é obrigatório). */
export function isCompleteMobile(masked: string) {
  const d = phoneDigits(masked);
  return d.length === 11 && d[2] === "9";
}

/**
 * Campo de WhatsApp com máscara (XX) 9XXXX-XXXX.
 * Exige DDD + celular com o nono dígito — evita cadastro duplicado do mesmo
 * jogador com e sem o 9 (que fazia mensalista virar avulso).
 */
export default function PhoneInput({
  name, defaultValue, value, onChange, required, autoFocus, className, placeholder,
}: {
  name?: string;
  defaultValue?: string;
  value?: string;               // modo controlado
  onChange?: (masked: string) => void;
  required?: boolean;
  autoFocus?: boolean;
  className?: string;
  placeholder?: string;
}) {
  const [inner, setInner] = useState(() => maskPhoneBR(defaultValue ?? ""));
  const masked = value !== undefined ? value : inner;
  const digits = phoneDigits(masked);
  const missing9 = digits.length === 10 && digits[2] !== "9";

  return (
    <div className="w-full">
      <input
        name={name}
        className={className ?? "input"}
        type="tel"
        inputMode="tel"
        placeholder={placeholder ?? "(11) 99999-9999"}
        value={masked}
        required={required}
        autoFocus={autoFocus}
        pattern="\(\d{2}\) 9\d{4}-\d{4}"
        title="Informe o DDD e o celular com o nono dígito, ex.: (31) 99403-0014"
        onChange={(e) => {
          const next = maskPhoneBR(e.target.value);
          if (onChange) onChange(next); else setInner(next);
        }}
      />
      {missing9 && (
        <p className="mt-1 text-xs text-[var(--danger)]">
          Faltou o 9? Celular tem 9 dígitos depois do DDD, ex.: (31) 99403-0014.
        </p>
      )}
    </div>
  );
}
