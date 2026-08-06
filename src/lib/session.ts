// Sessão do jogador (pós-OTP): token 256-bit, hash SHA-256 no banco, cookie httpOnly.
import { createHash, randomBytes } from "crypto";
import { cookies } from "next/headers";
import { supabaseAdmin } from "@/lib/supabase/server";

const COOKIE = "player_session";
const SESSION_DAYS = 30;

export function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function createPlayerSession(playerId: string, deviceInfo?: string) {
  const token = randomBytes(32).toString("hex");
  const db = supabaseAdmin();
  const expires = new Date(Date.now() + SESSION_DAYS * 86400_000);
  const { error } = await db.from("player_sessions").insert({
    player_id: playerId,
    token_hash: hashToken(token),
    device_info: deviceInfo ?? null,
    expires_at: expires.toISOString(),
  });
  if (error) throw error;
  const cookieStore = await cookies();
  cookieStore.set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    expires,
    path: "/",
  });
}

export async function getSessionPlayer(): Promise<{ id: string; name: string; phone: string } | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE)?.value;
  if (!token) return null;
  const db = supabaseAdmin();
  const { data } = await db
    .from("player_sessions")
    .select("player_id, expires_at, revoked_at, players(id, name, phone, active)")
    .eq("token_hash", hashToken(token))
    .maybeSingle();
  if (!data || data.revoked_at || new Date(data.expires_at) < new Date()) return null;
  const p = data.players as unknown as { id: string; name: string; phone: string; active: boolean };
  if (!p?.active) return null;
  return { id: p.id, name: p.name, phone: p.phone };
}

export async function revokePlayerSessions(playerId: string) {
  const db = supabaseAdmin();
  await db.from("player_sessions").update({ revoked_at: new Date().toISOString() }).eq("player_id", playerId);
}
