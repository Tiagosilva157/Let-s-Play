-- ============================================================
-- 0007 — Mensalista pode dizer "não vou" mesmo sem convite gerado
-- (ex.: vinculado à turma depois da abertura da lista). Antes a
-- recusa falhava com not_a_member se a linha não existisse.
-- ============================================================

create or replace function fn_decline_member(p_game_id uuid, p_player_id uuid, p_source text default 'self')
returns jsonb as $$
declare g games%rowtype; part game_participants%rowtype; was_confirmed boolean; is_member boolean;
begin
  select * into g from games where id = p_game_id for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'game_not_found'); end if;

  select exists (
    select 1 from team_members
    where team_id = g.team_id and player_id = p_player_id and status = 'active'
  ) into is_member;
  if not is_member then
    return jsonb_build_object('ok', false, 'error', 'not_a_member');
  end if;

  select * into part from game_participants where game_id = p_game_id and player_id = p_player_id;

  -- sem linha ainda: registra a recusa direto
  if not found then
    insert into game_participants (game_id, player_id, kind, status, source)
      values (p_game_id, p_player_id, 'member', 'declined', p_source);
    perform fn_promote_waitlist(p_game_id);
    return jsonb_build_object('ok', true, 'freed_spot', true);
  end if;

  was_confirmed := part.status = 'confirmed';
  if was_confirmed and now() > g.withdraw_until and p_source = 'self' then
    return jsonb_build_object('ok', false, 'error', 'withdraw_deadline_passed');
  end if;
  if part.status not in ('invited','confirmed') then
    return jsonb_build_object('ok', false, 'error', 'invalid_status');
  end if;

  update game_participants
    set status = case when was_confirmed then 'withdrawn' else 'declined' end,
        source = p_source
    where id = part.id;

  perform fn_promote_waitlist(p_game_id);
  return jsonb_build_object('ok', true, 'freed_spot', true);
end;
$$ language plpgsql security definer;
