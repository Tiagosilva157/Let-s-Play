-- ============================================================
-- 0008 — Lista de espera com cascata automática
--
-- Regras aprovadas:
--  • Entrar na fila é grátis; o Pix só é exigido na promoção.
--  • Promovido tem o prazo da reserva (15 min) para pagar.
--  • Não pagou → sai definitivamente DESTE jogo (não pode voltar)
--    e o próximo da fila sobe automaticamente.
--  • Toda movimentação é anunciada no grupo (feito pelo backend,
--    que recebe das funções os ids de promovidos/expirados).
-- ============================================================

alter table game_participants
  add column if not exists promoted_from_waitlist boolean not null default false;

-- ---------- promover lista de espera (retorna quem subiu) ----------
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
            then now() + make_interval(mins => (select reservation_minutes from teams t join games g on g.team_id = t.id where g.id = p_game_id))
            else null end,
          confirmed_at = case when nxt.kind = 'member' then now() else null end
      where id = nxt.id;
    promoted := promoted || nxt.id;
  end loop;
  return jsonb_build_object('ok', true, 'promoted', promoted);
end;
$$ language plpgsql security definer;

-- ---------- recusa do mensalista devolve quem foi promovido ----------
create or replace function fn_decline_member(p_game_id uuid, p_player_id uuid, p_source text default 'self')
returns jsonb as $$
declare g games%rowtype; part game_participants%rowtype; was_confirmed boolean; is_member boolean; promo jsonb;
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

  promo := fn_promote_waitlist(p_game_id);
  return jsonb_build_object('ok', true, 'freed_spot', true, 'promoted', promo->'promoted');
end;
$$ language plpgsql security definer;

-- ---------- desistência de avulso devolve quem foi promovido ----------
create or replace function fn_withdraw_dropin(p_game_id uuid, p_player_id uuid, p_source text default 'self')
returns jsonb as $$
declare g games%rowtype; part game_participants%rowtype; promo jsonb;
begin
  select * into g from games where id = p_game_id for update;
  select * into part from game_participants where game_id = p_game_id and player_id = p_player_id;
  if not found or part.kind <> 'dropin' then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;

  if part.status = 'reserved' then
    update game_participants set status = 'withdrawn' where id = part.id;
    promo := fn_promote_waitlist(p_game_id);
    return jsonb_build_object('ok', true, 'was_reserved', true, 'promoted', promo->'promoted');
  end if;
  if part.status <> 'confirmed' then return jsonb_build_object('ok', false, 'error', 'invalid_status'); end if;
  if now() > g.withdraw_until and p_source = 'self' then
    return jsonb_build_object('ok', false, 'error', 'withdraw_deadline_passed');
  end if;

  update game_participants set status = 'withdrawn' where id = part.id;
  promo := fn_promote_waitlist(p_game_id);
  return jsonb_build_object('ok', true, 'promoted', promo->'promoted');
end;
$$ language plpgsql security definer;

-- ---------- expiração com cascata ----------
-- Promovido que não pagou vira 'removed' (fora deste jogo) e o próximo sobe.
-- Reserva comum expirada vira 'withdrawn' (pode tentar de novo se quiser).
create or replace function fn_expire_reservations()
returns jsonb as $$
declare expired_rows jsonb; all_promoted uuid[] := '{}'; g record; promo jsonb;
begin
  with e as (
    update game_participants
      set status = case when promoted_from_waitlist then 'removed' else 'withdrawn' end
      where status = 'reserved' and reserved_until < now()
      returning id, game_id, player_id, charge_id, promoted_from_waitlist
  )
  select coalesce(jsonb_agg(to_jsonb(e)), '[]'::jsonb) into expired_rows from e;

  for g in select distinct (r->>'game_id')::uuid as id from jsonb_array_elements(expired_rows) r loop
    promo := fn_promote_waitlist(g.id);
    all_promoted := all_promoted || (select coalesce(array_agg(x::uuid), '{}')
      from jsonb_array_elements_text(promo->'promoted') x);
  end loop;

  return jsonb_build_object('ok', true, 'expired', expired_rows, 'promoted', all_promoted);
end;
$$ language plpgsql security definer;

-- ---------- quem perdeu a vez não entra de novo neste jogo ----------
create or replace function fn_reserve_dropin(p_game_id uuid, p_player_id uuid)
returns jsonb as $$
declare g games%rowtype; t teams%rowtype; part game_participants%rowtype; new_id uuid;
begin
  select * into g from games where id = p_game_id for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'game_not_found'); end if;
  select * into t from teams where id = g.team_id;

  if g.status <> 'open' then return jsonb_build_object('ok', false, 'error', 'list_not_open'); end if;
  if now() > g.confirm_until then return jsonb_build_object('ok', false, 'error', 'deadline_passed'); end if;

  select * into part from game_participants where game_id = p_game_id and player_id = p_player_id;
  if found then
    if part.status = 'confirmed' then return jsonb_build_object('ok', false, 'error', 'already_confirmed'); end if;
    if part.status = 'reserved' and part.reserved_until > now() then
      return jsonb_build_object('ok', true, 'participant_id', part.id, 'already_reserved', true);
    end if;
    -- subiu da fila, não pagou no prazo: fora deste jogo
    if part.status = 'removed' and part.promoted_from_waitlist then
      return jsonb_build_object('ok', false, 'error', 'promotion_expired');
    end if;
    if part.status = 'waitlist' then
      return jsonb_build_object('ok', true, 'participant_id', part.id, 'waitlisted', true, 'already_waitlisted', true);
    end if;
  end if;

  if fn_held_count(p_game_id) >= fn_game_capacity(p_game_id) then
    if t.waitlist_enabled then
      if found then
        update game_participants set status = 'waitlist', kind = 'dropin', promoted_from_waitlist = false
          where id = part.id returning id into new_id;
      else
        insert into game_participants (game_id, player_id, kind, status)
          values (p_game_id, p_player_id, 'dropin', 'waitlist') returning id into new_id;
      end if;
      return jsonb_build_object('ok', false, 'error', 'full', 'waitlisted', true, 'participant_id', new_id);
    end if;
    return jsonb_build_object('ok', false, 'error', 'full');
  end if;

  if found then
    update game_participants
      set status = 'reserved', kind = 'dropin', promoted_from_waitlist = false,
          reserved_until = now() + make_interval(mins => t.reservation_minutes)
      where id = part.id returning id into new_id;
  else
    insert into game_participants (game_id, player_id, kind, status, reserved_until)
      values (p_game_id, p_player_id, 'dropin', 'reserved', now() + make_interval(mins => t.reservation_minutes))
      returning id into new_id;
  end if;
  return jsonb_build_object('ok', true, 'participant_id', new_id,
    'reserved_until', (select reserved_until from game_participants where id = new_id));
end;
$$ language plpgsql security definer;
