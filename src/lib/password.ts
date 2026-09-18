// Senha do jogador: scrypt (nativo do Node) com sal por usuário — sem dependência extra.
import { randomBytes, scryptSync, timingSafeEqual } from "crypto";

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password.normalize("NFKC"), salt, 64).toString("hex");
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(password: string, stored: string | null | undefined): boolean {
  if (!stored) return false;
  const [algo, salt, hash] = stored.split("$");
  if (algo !== "scrypt" || !salt || !hash) return false;
  const test = scryptSync(password.normalize("NFKC"), salt, 64);
  const ref = Buffer.from(hash, "hex");
  return test.length === ref.length && timingSafeEqual(test, ref);
}

/** Regra única de senha: 6+ caracteres. Simples de propósito — é um link de vôlei. */
export function passwordProblem(p: string): string | null {
  if (typeof p !== "string" || p.length < 6) return "A senha precisa ter pelo menos 6 caracteres.";
  if (p.length > 72) return "Senha longa demais.";
  return null;
}
