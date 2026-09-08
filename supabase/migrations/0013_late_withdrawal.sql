-- ============================================================
-- 0013 — Desistência após o prazo
--
-- Regra: o jogador SEMPRE pode avisar que não vai / desistir, mesmo depois
-- do prazo de desistência. A diferença é o tratamento do dinheiro:
--   • dentro do prazo → crédito (o admin ainda pode devolver em dinheiro);
--   • depois do prazo → crédito SEM opção de devolução em dinheiro.
-- As funções passam a devolver late=true quando a desistência é tardia,
-- em vez de recusar.
-- ============================================================

alter table credits add column if not exists refundable boolean not null default true;

-- ---------- avulso ----------
create or replace function fn_withdraw_dropin(p_game_id uuid, p_player_id uuid, p_source text default 'self')
returns jsonb as $$
declare g games%rowtype; part game_participants%rowtype; promo jsonb; is_late boolean;
begin
  select * into g from games where id = p_game_id for update;
  select * into part from game_participants where game_id = p_game_id and player_id = p_player_id;
  if not found or part.kind <> 'dropin' then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;

  -- na fila: sai sem burocracia (não ocupa vaga, não tem cobrança)
  if part.status = 'waitlist' then
    update game_participants set status = 'withdrawn', source = p_source where id = part.id;
    return jsonb_build_object('ok', true, 'left_waitlist', true);
  end if;

  if part.status = 'reserved' then
    update game_participants set status = 'withdrawn', source = p_source where id = part.id;
    promo := fn_promote_waitlist(p_game_id);
    return jsonb_build_object('ok', true, 'was_reserved', true, 'promoted', promo->'promoted');
  end if;
  if part.status <> 'confirmed' then return jsonb_build_object('ok', false, 'error', 'invalid_status'); end if;

  is_late := now() > g.withdraw_until;
  update game_participants set status = 'withdrawn', source = p_source where id = part.id;
  promo := fn_promote_waitlist(p_game_id);
  return jsonb_build_object('ok', true, 'late', is_late, 'promoted', promo->'promoted');
end;
$$ language plpgsql security definer;

-- ---------- mensalista ----------
create or replace function fn_decline_member(p_game_id uuid, p_player_id uuid, p_source text default 'self')
returns jsonb as $$
declare g games%rowtype; part game_participants%rowtype; was_confirmed boolean; is_member boolean; promo jsonb; is_late boolean;
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

  if not found then
    insert into game_participants (game_id, player_id, kind, status, source)
      values (p_game_id, p_player_id, 'member', 'declined', p_source);
    promo := fn_promote_waitlist(p_game_id);
    return jsonb_build_object('ok', true, 'freed_spot', true, 'promoted', promo->'promoted');
  end if;

  was_confirmed := part.status = 'confirmed';
  if part.status not in ('invited','confirmed') then
    return jsonb_build_object('ok', false, 'error', 'invalid_status');
  end if;

  is_late := was_confirmed and now() > g.withdraw_until;
  update game_participants
    set status = case when was_confirmed then 'withdrawn' else 'declined' end,
        source = p_source
    where id = part.id;

  promo := fn_promote_waitlist(p_game_id);
  return jsonb_build_object('ok', true, 'freed_spot', true, 'late', is_late, 'promoted', promo->'promoted');
end;
$$ language plpgsql security definer;
