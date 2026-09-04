-- ============================================================
-- 0011 — Divisão de times salva no jogo
-- A divisão escolhida fica vinculada ao jogo (sobrevive a recarregar a
-- página, trocar de aparelho, etc.). Formato:
--   { "teams": [["player_id", ...], ...], "saved_at": "..." }
-- ============================================================

alter table games add column if not exists teams_split jsonb;
