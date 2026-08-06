-- ============================================================
-- Funções transacionais de vaga (toda mutação passa por aqui)
-- Chamadas apenas pelo backend (service_role).
-- ============================================================

-- Capacidade efetiva e vagas ocupadas (com lock do jogo já obtido pelo chamador)
create or replace function fn_occupied_count(p_game_id uuid) returns int as $$
  select count(*)::int from game_participants
  where game_id = p_game_id
    and status in ('confirmed','reserved')
$$ language sql stable;

create or replace function fn_game_capacity(p_game_id uuid) returns int as $$
  select coalesce(g.capacity_override, t.capacity)
  from games g join teams t on t.id = g.team_id
  where g.id = p_game_id
$$ language sql stable;

-- Mensalistas 'invited' também seguram vaga até responderem (ou até liberação automática)
create or replace function fn_held_count(p_game_id uuid) returns int as $$
  select count(*)::int from game_participants
  where game_id = p_game_id
    and status in ('confirmed','reserved','invited')
$$ language sql stable;

-- ---------- confirmar mensalista ----------
create or replace function fn_confirm_member(p_game_id uuid, p_player_id uuid, p_source text default 'self')
returns jsonb as $$
declare g games%rowtype; part game_participants%rowtype;
begin
  select * into g from games where id = p_game_id for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'game_not_found'); end if;
  if g.status not in ('open') and p_source = 'self' then
    return jsonb_build_object('ok', false, 'error', 'list_not_open');
  end if;
  if now() > g.confirm_until and p_source = 'self' then
    return jsonb_build_object('ok', false, 'error', 'deadline_passed');
  end if;

  select * into part from game_participants where game_id = p_game_id and player_id = p_player_id;
  if not found or part.kind <> 'member' then
    return jsonb_build_object('ok', false, 'error', 'not_a_member');
  end if;
  if part.status = 'confirmed' then
    return jsonb_build_object('ok', true, 'already', true);
  end if;
  if part.status not in ('invited','declined','withdrawn') then
    return jsonb_build_object('ok', false, 'error', 'invalid_status');
  end if;
  -- se já tinha liberado a vaga (declined/withdrawn), precisa haver espaço
  if part.status in ('declined','withdrawn') and fn_held_count(p_game_id) >= fn_game_capacity(p_game_id) then
    return jsonb_build_object('ok', false, 'error', 'full');
  end if;

  update game_participants
    set status = 'confirmed', confirmed_at = now(), source = p_source
    where id = part.id;
  return jsonb_build_object('ok', true);
end;
$$ language plpgsql security definer;

-- ---------- mensalista recusa / desiste ----------
create or replace function fn_decline_member(p_game_id uuid, p_player_id uuid, p_source text default 'self')
returns jsonb as $$
declare g games%rowtype; part game_participants%rowtype; was_confirmed boolean;
begin
  select * into g from games where id = p_game_id for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'game_not_found'); end if;

  select * into part from game_participants where game_id = p_game_id and player_id = p_player_id;
  if not found or part.kind <> 'member' then
    return jsonb_build_object('ok', false, 'error', 'not_a_member');
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

-- ---------- reservar vaga de avulso (pré-reserva) ----------
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
    if part.status in ('confirmed') then return jsonb_build_object('ok', false, 'error', 'already_confirmed'); end if;
    if part.status = 'reserved' and part.reserved_until > now() then
      return jsonb_build_object('ok', true, 'participant_id', part.id, 'already_reserved', true);
    end if;
  end if;

  if fn_held_count(p_game_id) >= fn_game_capacity(p_game_id) then
    if t.waitlist_enabled then
      if found then
        update game_participants set status = 'waitlist', kind = 'dropin' where id = part.id returning id into new_id;
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
      set status = 'reserved', kind = 'dropin',
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

-- ---------- confirmar pagamento do avulso (webhook) ----------
create or replace function fn_confirm_dropin_payment(p_charge_id uuid)
returns jsonb as $$
declare c charges%rowtype; part game_participants%rowtype; g games%rowtype;
begin
  select * into c from charges where id = p_charge_id;
  if not found or c.game_id is null then return jsonb_build_object('ok', false, 'error', 'charge_not_found'); end if;

  select * into g from games where id = c.game_id for update;
  select * into part from game_participants where game_id = c.game_id and player_id = c.player_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'participant_not_found'); end if;

  if part.status = 'confirmed' then return jsonb_build_object('ok', true, 'already', true); end if;

  -- reserva ativa OU expirada-mas-com-vaga → confirma; lista cheia → revisão do admin
  if part.status = 'reserved' and (part.reserved_until is null or part.reserved_until > now()) then
    update game_participants set status = 'confirmed', confirmed_at = now() where id = part.id;
    return jsonb_build_object('ok', true, 'confirmed', true);
  elsif fn_held_count(c.game_id) < fn_game_capacity(c.game_id) then
    update game_participants set status = 'confirmed', confirmed_at = now() where id = part.id;
    return jsonb_build_object('ok', true, 'confirmed', true, 'late', true);
  else
    update game_participants set status = 'pending_review' where id = part.id;
    return jsonb_build_object('ok', true, 'pending_review', true);
  end if;
end;
$$ language plpgsql security definer;

-- ---------- desistência de avulso ----------
create or replace function fn_withdraw_dropin(p_game_id uuid, p_player_id uuid, p_source text default 'self')
returns jsonb as $$
declare g games%rowtype; part game_participants%rowtype;
begin
  select * into g from games where id = p_game_id for update;
  select * into part from game_participants where game_id = p_game_id and player_id = p_player_id;
  if not found or part.kind <> 'dropin' then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;

  if part.status = 'reserved' then
    update game_participants set status = 'withdrawn' where id = part.id;
    perform fn_promote_waitlist(p_game_id);
    return jsonb_build_object('ok', true, 'was_reserved', true); -- backend cancela a cobrança
  end if;
  if part.status <> 'confirmed' then return jsonb_build_object('ok', false, 'error', 'invalid_status'); end if;
  if now() > g.withdraw_until and p_source = 'self' then
    return jsonb_build_object('ok', false, 'error', 'withdraw_deadline_passed'); -- cobrança mantida
  end if;

  update game_participants set status = 'withdrawn' where id = part.id;
  perform fn_promote_waitlist(p_game_id);
  return jsonb_build_object('ok', true); -- dentro do prazo: crédito/estorno é decisão do admin
end;
$$ language plpgsql security definer;

-- ---------- promover lista de espera ----------
create or replace function fn_promote_waitlist(p_game_id uuid)
returns jsonb as $$
declare nxt game_participants%rowtype; promoted uuid[] := '{}';
begin
  while fn_held_count(p_game_id) < fn_game_capacity(p_game_id) loop
    select * into nxt from game_participants
      where game_id = p_game_id and status = 'waitlist'
      order by created_at asc limit 1;
    exit when not found;
    -- promovido volta para 'reserved' se avulso (precisa pagar) — o backend gera a cobrança e notifica
    update game_participants
      set status = case when nxt.kind = 'dropin' then 'reserved' else 'confirmed' end,
          reserved_until = case when nxt.kind = 'dropin'
            then now() + make_interval(mins => (select reservation_minutes from teams t join games g on g.team_id=t.id where g.id=p_game_id))
            else null end,
          confirmed_at = case when nxt.kind = 'member' then now() else null end
      where id = nxt.id;
    promoted := promoted || nxt.id;
  end loop;
  return jsonb_build_object('ok', true, 'promoted', promoted);
end;
$$ language plpgsql security definer;

-- ---------- expirar reservas vencidas ----------
create or replace function fn_expire_reservations()
returns jsonb as $$
declare expired uuid[];
begin
  with e as (
    update game_participants
      set status = 'withdrawn'
      where status = 'reserved' and reserved_until < now()
      returning id, charge_id, game_id
  )
  select array_agg(id) into expired from e;

  -- promove waitlist dos jogos afetados
  perform fn_promote_waitlist(g.id)
    from (select distinct game_id as id from game_participants where id = any(coalesce(expired,'{}'))) g;

  return jsonb_build_object('ok', true, 'expired', coalesce(expired, '{}'));
end;
$$ language plpgsql security definer;

-- ---------- gerar jogos futuros ----------
create or replace function fn_generate_games()
returns jsonb as $$
declare t teams%rowtype; d date; game_ts timestamptz; created int := 0;
begin
  for t in select * from teams where status = 'active' loop
    for i in 0..(t.generate_weeks_ahead * 7) loop
      d := current_date + i;
      exit when d > current_date + t.generate_weeks_ahead * 7;
      if extract(dow from d)::int = t.weekday
         and not exists (select 1 from games where team_id = t.id and date = d) then
        game_ts := (d::timestamp + t.game_time) at time zone 'America/Sao_Paulo';
        if game_ts > now() then
          insert into games (team_id, date, time, opens_at, confirm_until, withdraw_until, status, generated)
          values (t.id, d, t.game_time,
            game_ts - make_interval(hours => t.open_hours_before),
            game_ts - make_interval(hours => t.confirm_hours_before),
            game_ts - make_interval(hours => t.withdraw_hours_before),
            'scheduled', true);
          created := created + 1;
        end if;
      end if;
    end loop;
  end loop;
  return jsonb_build_object('ok', true, 'created', created);
end;
$$ language plpgsql security definer;

-- ---------- abrir listas (cron): cria 'invited' para mensalistas ----------
create or replace function fn_open_lists()
returns jsonb as $$
declare g record; opened int := 0;
begin
  for g in select * from games where status = 'scheduled' and opens_at <= now() for update loop
    insert into game_participants (game_id, player_id, kind, status, source)
      select g.id, tm.player_id, 'member', 'invited', 'system'
      from team_members tm
      where tm.team_id = g.team_id and tm.status = 'active'
      on conflict (game_id, player_id) do nothing;
    update games set status = 'open' where id = g.id;
    opened := opened + 1;
  end loop;
  return jsonb_build_object('ok', true, 'opened', opened);
end;
$$ language plpgsql security definer;

-- ---------- fechar listas + liberar invited sem resposta ----------
create or replace function fn_close_lists()
returns jsonb as $$
declare g record; closed int := 0; t teams%rowtype;
begin
  -- liberar vaga de mensalista sem resposta (se configurado)
  for g in select gm.*, t.release_invited_hours_before, t.game_time
           from games gm join teams t on t.id = gm.team_id
           where gm.status = 'open' and t.release_invited_hours_before is not null loop
    if now() >= ((g.date::timestamp + g.time) at time zone 'America/Sao_Paulo') - make_interval(hours => g.release_invited_hours_before) then
      update game_participants set status = 'declined', source = 'system'
        where game_id = g.id and status = 'invited';
      perform fn_promote_waitlist(g.id);
    end if;
  end loop;

  for g in select * from games where status = 'open' and confirm_until <= now() for update loop
    update games set status = 'closed' where id = g.id;
    closed := closed + 1;
  end loop;
  return jsonb_build_object('ok', true, 'closed', closed);
end;
$$ language plpgsql security definer;
