-- ============================================================
-- 0012 — Crédito automático
--
-- Crédito (de jogo cancelado/pagamento sem vaga) passa a ser consumido
-- automaticamente: quando o avulso com crédito disponível garante vaga,
-- a presença é confirmada sem gerar Pix. Rastreamos em qual jogo foi usado.
-- ============================================================

alter table credits add column if not exists used_game_id uuid references games(id);
alter table credits add column if not exists used_at timestamptz;

create index if not exists idx_credits_available
  on credits(player_id, team_id) where status = 'available';
