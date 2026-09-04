-- ============================================================
-- 0010 — Nível técnico do jogador (1 a 5 estrelas)
-- Uso exclusivamente interno, para o balanceamento dos times.
-- Nunca aparece no link público nem nas mensagens do WhatsApp.
-- ============================================================

alter table players add column if not exists skill_level int not null default 3
  check (skill_level between 1 and 5);
