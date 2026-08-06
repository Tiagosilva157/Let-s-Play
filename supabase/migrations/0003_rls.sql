-- ============================================================
-- RLS: admin = tudo; anon = só views públicas; escrita = service_role
-- ============================================================

create or replace function is_admin() returns boolean as $$
  select exists (select 1 from admins where id = auth.uid())
$$ language sql stable security definer;

do $$
declare t text;
begin
  foreach t in array array[
    'admins','players','otp_codes','player_sessions','teams','team_members','games',
    'game_participants','charges','payment_events','webhook_events','credits',
    'message_templates','message_dispatches','audit_logs','system_settings'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy adm_all_%s on %I for all to authenticated using (is_admin()) with check (is_admin())', t, t);
  end loop;
end $$;

-- View pública do jogo: sem telefones, só primeiro nome
create or replace view public_game_view with (security_invoker = false) as
select
  g.id as game_id,
  t.slug,
  t.name as team_name,
  g.date, g.time,
  coalesce(g.address_override, t.address) as address,
  coalesce(g.capacity_override, t.capacity) as capacity,
  g.status, g.opens_at, g.confirm_until, g.withdraw_until,
  t.dropin_fee,
  fn_game_capacity(g.id) - fn_held_count(g.id) as spots_available
from games g join teams t on t.id = g.team_id
where t.status = 'active' and g.status in ('scheduled','open','closed');

create or replace view public_game_participants_view with (security_invoker = false) as
select
  gp.game_id,
  split_part(p.name, ' ', 1) || ' ' || left(coalesce(nullif(split_part(p.name,' ',2),''),''),1) as display_name,
  gp.kind, gp.status, gp.confirmed_at
from game_participants gp
join players p on p.id = gp.player_id
where gp.status in ('confirmed','waitlist');

grant select on public_game_view to anon, authenticated;
grant select on public_game_participants_view to anon, authenticated;
