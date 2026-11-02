-- ============================================================
-- 0022 — Prazo limite de confirmação dos mensalistas
--
-- Já existia teams.release_invited_hours_before (nunca exposto no painel) e um
-- trecho dentro de fn_close_lists que liberava os convites. Aqui isso vira uma
-- rotina própria, idempotente, chamada pelo cron de 1 minuto, que DEVOLVE o que
-- fez (jogo, quantos, promovidos) para o backend atualizar o grupo, gerar o Pix
-- de quem subiu da fila e registrar na auditoria.
--
-- Regras:
--  • só mensalistas 'invited' (sem resposta) são afetados; confirmados nunca
--  • quem foi liberado vira 'declined' com source='system'
--  • depois do prazo o mensalista pode confirmar se houver vaga; lista cheia →
--    entra na lista de espera (kind='member': sobe sem Pix, pois já é mensalista)
--  • lock do jogo (for update) serializa com fn_confirm_member: quem confirmar
--    no exato instante do prazo ou confirma antes (fica) ou depois (precisa de vaga)
-- ============================================================

-- prazo em horas pode ter fração (ex.: jogo 20:30, prazo 12:00 = 8,5 h)
alter table teams alter column release_invited_hours_before type numeric(7,2);

-- ---------- liberação dos convites sem resposta ----------
create or replace function fn_release_invited()
returns jsonb as $$
declare g record; n int; promo jsonb; done jsonb := '[]'::jsonb; deadline timestamptz;
begin
  for g in select gm.id, gm.date, gm.time, t.release_invited_hours_before as hrs
           from games gm join teams t on t.id = gm.team_id
           where gm.status = 'open' and t.release_invited_hours_before is not null
           for update of gm skip locked loop
    deadline := ((g.date::timestamp + g.time) at time zone 'America/Sao_Paulo')
                - make_interval(mins => round(g.hrs * 60)::int);
    if now() < deadline then continue; end if;

    update game_participants
      set status = 'declined', source = 'system', updated_at = now()
      where game_id = g.id and status = 'invited';
    get diagnostics n = row_count;
    if n = 0 then continue; end if;  -- nada a fazer (ou já rodou): idempotente

    promo := fn_promote_waitlist(g.id);
    insert into audit_logs (actor_type, actor_id, action, entity, entity_id, after)
      values ('system', 'cron', 'release_invited', 'games', g.id::text,
              jsonb_build_object('released', n, 'deadline', deadline, 'promoted', promo->'promoted'));
    done := done || jsonb_build_object('game_id', g.id, 'released', n, 'promoted', promo->'promoted');
  end loop;
  return jsonb_build_object('ok', true, 'released', done);
end;
$$ language plpgsql security definer;

-- ---------- fechar listas: só fecha (a liberação saiu daqui) ----------
create or replace function fn_close_lists()
returns jsonb as $$
declare g record; closed int := 0;
begin
  for g in select * from games where status = 'open' and confirm_until <= now() for update loop
    update games set status = 'closed' where id = g.id;
    closed := closed + 1;
  end loop;
  return jsonb_build_object('ok', true, 'closed', closed);
end;
$$ language plpgsql security definer;

-- ---------- confirmar mensalista: lista cheia → lista de espera ----------
create or replace function fn_confirm_member(p_game_id uuid, p_player_id uuid, p_source text default 'self')
returns jsonb as $$
declare g games%rowtype; t teams%rowtype; part game_participants%rowtype;
        is_member boolean; has_row boolean; is_full boolean; new_id uuid;
begin
  select * into g from games where id = p_game_id for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'game_not_found'); end if;
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
$$ language plpgsql security definer;

-- ---------- recusa do mensalista: também sai da lista de espera ----------
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
$$ language plpgsql security definer;

-- ---------- visão pública: prazo dos mensalistas (coluna nova só no fim) ----------
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
  g.notes,
  case when t.release_invited_hours_before is null then null
       else ((g.date::timestamp + g.time) at time zone 'America/Sao_Paulo')
            - make_interval(mins => round(t.release_invited_hours_before * 60)::int) end as members_confirm_until
from games g join teams t on t.id = g.team_id
where t.status = 'active' and g.status in ('scheduled','open','closed');
grant select on public_game_view to anon, authenticated;
