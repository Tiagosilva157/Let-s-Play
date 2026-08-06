-- ============================================================
-- 0004 — Correções da auditoria
-- 1. Mensalista vinculado depois da lista aberta conseguia ficar sem
--    linha 'invited' e não conseguia confirmar → agora a confirmação
--    cria a participação na hora, respeitando a capacidade.
-- ============================================================

create or replace function fn_confirm_member(p_game_id uuid, p_player_id uuid, p_source text default 'self')
returns jsonb as $$
declare g games%rowtype; part game_participants%rowtype; is_member boolean;
begin
  select * into g from games where id = p_game_id for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'game_not_found'); end if;
  if g.status not in ('open') and p_source = 'self' then
    return jsonb_build_object('ok', false, 'error', 'list_not_open');
  end if;
  if now() > g.confirm_until and p_source = 'self' then
    return jsonb_build_object('ok', false, 'error', 'deadline_passed');
  end if;

  select exists (
    select 1 from team_members
    where team_id = g.team_id and player_id = p_player_id and status = 'active'
  ) into is_member;
  if not is_member then
    return jsonb_build_object('ok', false, 'error', 'not_a_member');
  end if;

  select * into part from game_participants where game_id = p_game_id and player_id = p_player_id;

  -- mensalista sem linha (vinculado após a abertura da lista) → cria direto
  if not found then
    if fn_held_count(p_game_id) >= fn_game_capacity(p_game_id) then
      return jsonb_build_object('ok', false, 'error', 'full');
    end if;
    insert into game_participants (game_id, player_id, kind, status, source, confirmed_at)
      values (p_game_id, p_player_id, 'member', 'confirmed', p_source, now());
    return jsonb_build_object('ok', true);
  end if;

  if part.status = 'confirmed' then
    return jsonb_build_object('ok', true, 'already', true);
  end if;
  if part.status not in ('invited','declined','withdrawn') then
    return jsonb_build_object('ok', false, 'error', 'invalid_status');
  end if;
  if part.status in ('declined','withdrawn') and fn_held_count(p_game_id) >= fn_game_capacity(p_game_id) then
    return jsonb_build_object('ok', false, 'error', 'full');
  end if;

  update game_participants
    set status = 'confirmed', confirmed_at = now(), source = p_source, kind = 'member'
    where id = part.id;
  return jsonb_build_object('ok', true);
end;
$$ language plpgsql security definer;
