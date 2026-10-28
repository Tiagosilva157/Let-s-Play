-- Observações do jogo: aviso livre do admin ("levar bola", "quadra 2", "chegar 10 min antes").
-- Aparece no TOPO da lista enviada ao grupo e no topo do link de confirmação.
alter table games add column if not exists notes text;

-- visão pública: expõe as observações (coluna nova só no fim)
create or replace view public_game_view with (security_invoker = false) as
select
  g.id as game_id,
  t.slug,
  t.name as team_name,
  g.date, g.time,
  coalesce(g.address_override, t.address) as address,
  coalesce(g.capacity_override, t.capacity) as capacity,
  g.status, g.opens_at, g.confirm_until, g.withdraw_until,
  coalesce(g.dropin_fee_override, t.dropin_fee)::numeric(10,2) as dropin_fee,
  fn_game_capacity(g.id) - fn_held_count(g.id) as spots_available,
  g.title, g.members_pay, g.generated,
  g.notes
from games g join teams t on t.id = g.team_id
where t.status = 'active' and g.status in ('scheduled','open','closed');
grant select on public_game_view to anon, authenticated;
