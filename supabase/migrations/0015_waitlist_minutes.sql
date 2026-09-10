-- Quem sobe da lista de espera tem mais tempo para pagar (padrão 1 hora);
-- a reserva comum continua com reservation_minutes (15 min).
alter table teams add column if not exists waitlist_minutes int not null default 60;

create or replace function fn_promote_waitlist(p_game_id uuid)
returns jsonb as $$
declare nxt game_participants%rowtype; promoted uuid[] := '{}';
begin
  while fn_held_count(p_game_id) < fn_game_capacity(p_game_id) loop
    select * into nxt from game_participants
      where game_id = p_game_id and status = 'waitlist'
      order by created_at asc limit 1;
    exit when not found;
    update game_participants
      set status = case when nxt.kind = 'dropin' then 'reserved' else 'confirmed' end,
          promoted_from_waitlist = true,
          reserved_until = case when nxt.kind = 'dropin'
            then now() + make_interval(mins => (select coalesce(t.waitlist_minutes, 60) from teams t join games g on g.team_id = t.id where g.id = p_game_id))
            else null end,
          confirmed_at = case when nxt.kind = 'member' then now() else null end
      where id = nxt.id;
    promoted := promoted || nxt.id;
  end loop;
  return jsonb_build_object('ok', true, 'promoted', promoted);
end;
$$ language plpgsql security definer;
