// Normalização de telefone BR para E.164 sem "+" (padrão WhatsApp: 5511999999999)
export function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  let e164: string | null = null;
  if (digits.length === 13 && digits.startsWith("55")) e164 = digits;
  else if (digits.length === 12 && digits.startsWith("55")) e164 = digits; // fixo/sem 9
  else if (digits.length === 11) e164 = `55${digits}`;
  else if (digits.length === 10) e164 = `55${digits}`;
  if (!e164) return null;
  // celular digitado sem o 9 (formato antigo): 55 + DDD + 8 dígitos começando
  // em 6-9 → completa o 9. Fixos (2-5) ficam como estão. Evita cadastro
  // duplicado do mesmo jogador com e sem o nono dígito (caso Charles).
  if (e164.length === 12 && /^55\d{2}[6-9]/.test(e164)) {
    e164 = e164.slice(0, 4) + "9" + e164.slice(4);
  }
  return e164;
}

/**
 * Variações do mesmo número com e sem o nono dígito, para busca no banco —
 * cobre cadastros antigos gravados sem o 9.
 */
export function phoneVariants(e164: string): string[] {
  const v = [e164];
  if (e164.length === 13 && /^55\d{2}9/.test(e164)) v.push(e164.slice(0, 4) + e164.slice(5));
  if (e164.length === 12 && /^55\d{2}[6-9]/.test(e164)) v.push(e164.slice(0, 4) + "9" + e164.slice(4));
  return v;
}

export function formatPhoneBR(e164: string): string {
  const d = e164.replace(/^55/, "");
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return e164;
}
