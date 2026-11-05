-- ============================================================
-- 0024 — Jogo cancelado não movimenta mais nada
--
-- Problema: depois de cancelar um jogo, saídas da lista (pelo link, pelo painel
-- ou por Pix pendente que expirou no robô) continuavam promovendo a lista de
-- espera e gerando Pix para quem subia.
--
-- Regras:
--  • fn_promote_waitlist: em jogo cancelado/encerrado não promove ninguém
--    (cobre todos os caminhos: link, painel, expiração do robô, prazo dos mensalistas)
--  • fn_expire_reservations: ignora reservas de jogos cancelados/encerrados
--  • confirmar / recusar / reservar / desistir pelo link em jogo cancelado → game_canceled
--  • limpeza única: reservas pendentes e lista de espera de jogos já cancelados
-- ============================================================

CREATE OR REPLACE FUNCTION public.fn_promote_waitlist(p_game_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
declare nxt game_participants%rowtype; promoted uuid[] := '{}';
begin
  -- jogo cancelado/encerrado: a fila não anda
  if (select status from games where id = p_game_id) in ('canceled','done') then
    return jsonb_build_object('ok', true, 'promoted', promoted);
  end if;
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
$function$;

CREATE OR REPLACE FUNCTION public.fn_expire_reservations()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
declare expired_rows jsonb; all_promoted uuid[] := '{}'; g record; promo jsonb;
begin
  with e as (
    update game_participants
      set status = case when promoted_from_waitlist then 'removed' else 'withdrawn' end
      where status = 'reserved' and reserved_until < now()
        and game_id not in (select id from games where status in ('canceled','done'))
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
$function$;

CREATE OR REPLACE FUNCTION public.fn_confirm_member(p_game_id uuid, p_player_id uuid, p_source text DEFAULT 'self'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
declare g games%rowtype; t teams%rowtype; part game_participants%rowtype;
        is_member boolean; has_row boolean; is_full boolean; new_id uuid;
begin
  select * into g from games where id = p_game_id for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'game_not_found'); end if;
  if g.status = 'canceled' and p_source = 'self' then return jsonb_build_object('ok', false, 'error', 'game_canceled'); end if;
  if g.status not in ('open') and p_source = 'self' then
    return jsonb_build_object('ok', false, 'error', 'list_not_open');
  end if;
  if now() > g.confirm_until and p_source = 'self' then
    return jsonb_build_object('ok', false, 'error', 'deadline_passed');
  end if;
  select * into t from teams where id = g.team_id;

  select exists (
    select 1 from team_members
    where team_id = g.team_id and player_id = p_player_id and status = 'active'
  ) into is_member;
  if not is_member then
    return jsonb_build_object('ok', false, 'error', 'not_a_member');
  end if;

  select * into part from game_participants where game_id = p_game_id and player_id = p_player_id;
  has_row := found;

  if has_row and part.status = 'confirmed' then
    return jsonb_build_object('ok', true, 'already', true);
  end if;
  if has_row and part.status = 'waitlist' then
    return jsonb_build_object('ok', false, 'error', 'full', 'waitlisted', true, 'participant_id', part.id, 'already_waitlisted', true);
  end if;
  if has_row and part.status not in ('invited','declined','withdrawn') then
    return jsonb_build_object('ok', false, 'error', 'invalid_status');
  end if;

  -- convite em aberto já segura a vaga: confirma sempre
  if has_row and part.status = 'invited' then
    update game_participants
      set status = 'confirmed', confirmed_at = now(), source = p_source, kind = 'member'
      where id = part.id;
    return jsonb_build_object('ok', true);
  end if;

  -- sem linha, ou já tinha dito que não vinha (inclusive liberado pelo prazo): precisa de vaga livre
  is_full := fn_held_count(p_game_id) >= fn_game_capacity(p_game_id);
  if is_full then
    if t.waitlist_enabled and p_source = 'self' then
      if has_row then
        update game_participants
          set status = 'waitlist', kind = 'member', promoted_from_waitlist = false,
              source = p_source, created_at = now(), updated_at = now()
          where id = part.id returning id into new_id;
      else
        insert into game_participants (game_id, player_id, kind, status, source)
          values (p_game_id, p_player_id, 'member', 'waitlist', p_source) returning id into new_id;
      end if;
      return jsonb_build_object('ok', false, 'error', 'full', 'waitlisted', true, 'participant_id', new_id);
    end if;
    return jsonb_build_object('ok', false, 'error', 'full');
  end if;

  if has_row then
    update game_participants
      set status = 'confirmed', confirmed_at = now(), source = p_source, kind = 'member'
      where id = part.id;
  else
    insert into game_participants (game_id, player_id, kind, status, source, confirmed_at)
      values (p_game_id, p_player_id, 'member', 'confirmed', p_source, now());
  end if;
  return jsonb_build_object('ok', true);
end;
$function$;

CREATE OR REPLACE FUNCTION public.fn_decline_member(p_game_id uuid, p_player_id uuid, p_source text DEFAULT 'self'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
declare g games%rowtype; part game_participants%rowtype; was_confirmed boolean; is_member boolean; promo jsonb; is_late boolean;
begin
  select * into g from games where id = p_game_id for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'game_not_found'); end if;
  if g.status = 'canceled' and p_source = 'self' then return jsonb_build_object('ok', false, 'error', 'game_canceled'); end if;

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

  -- na lista de espera: sai da fila (não segurava vaga, nada a promover)
  if part.status = 'waitlist' then
    update game_participants set status = 'declined', source = p_source, updated_at = now() where id = part.id;
    return jsonb_build_object('ok', true, 'left_waitlist', true);
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
$function$;

CREATE OR REPLACE FUNCTION public.fn_withdraw_dropin(p_game_id uuid, p_player_id uuid, p_source text DEFAULT 'self'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
declare g games%rowtype; part game_participants%rowtype; promo jsonb; is_late boolean;
begin
  select * into g from games where id = p_game_id for update;
  if g.status = 'canceled' and p_source = 'self' then return jsonb_build_object('ok', false, 'error', 'game_canceled'); end if;
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
$function$;

CREATE OR REPLACE FUNCTION public.fn_reserve_dropin(p_game_id uuid, p_player_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
declare g games%rowtype; t teams%rowtype; part game_participants%rowtype; new_id uuid;
begin
  select * into g from games where id = p_game_id for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'game_not_found'); end if;
  if g.status = 'canceled' then return jsonb_build_object('ok', false, 'error', 'game_canceled'); end if;
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
$function$;

-- limpeza única: jogos já cancelados não ficam com reserva pendente nem fila viva
update game_participants gp
  set status = 'withdrawn', source = 'system', updated_at = now()
  from games g
  where g.id = gp.game_id and g.status = 'canceled' and gp.status in ('reserved','waitlist');
