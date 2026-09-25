-- Jogo único (extra, fora da recorrência da turma).
--   title               nome opcional exibido no link e no grupo ("Jogo extra na praia")
--   dropin_fee_override valor do avulso só deste jogo (null = valor da turma)
--   members_pay         true = mensalistas NÃO têm vaga garantida: todos pagam como avulso
alter table games add column if not exists title text;
alter table games add column if not exists dropin_fee_override numeric(10,2);
alter table games add column if not exists members_pay boolean not null default false;

-- "um jogo por turma por dia" passa a valer só para os jogos recorrentes
alter table games drop constraint if exists games_team_id_date_key;
create unique index if not exists games_one_recurring_per_day on games(team_id, date) where generated;

-- visão pública: valor efetivo do jogo + novos campos (colunas novas só no fim)
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
  g.title, g.members_pay, g.generated
from games g join teams t on t.id = g.team_id
where t.status = 'active' and g.status in ('scheduled','open','closed');
grant select on public_game_view to anon, authenticated;

-- abrir listas: em jogo onde mensalista paga, ninguém é convidado automaticamente
create or replace function fn_open_lists()
returns jsonb as $$
declare g record; opened uuid[] := '{}';
begin
  for g in select * from games where status = 'scheduled' and opens_at <= now() for update loop
    if not g.members_pay then
      insert into game_participants (game_id, player_id, kind, status, source)
        select g.id, tm.player_id, 'member', 'invited', 'system'
        from team_members tm
        where tm.team_id = g.team_id and tm.status = 'active'
        on conflict (game_id, player_id) do nothing;
    end if;
    update games set status = 'open' where id = g.id;
    opened := opened || g.id;
  end loop;
  return jsonb_build_object('ok', true, 'opened', opened, 'count', coalesce(array_length(opened, 1), 0));
end;
$$ language plpgsql security definer;

-- gerar jogos: só um jogo RECORRENTE no mesmo dia bloqueia a geração;
-- um jogo único na mesma data não impede o jogo normal da turma
create or replace function fn_generate_games()
returns jsonb as $$
declare t teams%rowtype; d date; game_ts timestamptz; created int := 0;
begin
  for t in select * from teams where status = 'active' loop
    for i in 0..(t.generate_weeks_ahead * 7) loop
      d := current_date + i;
      exit when d > current_date + t.generate_weeks_ahead * 7;
      if extract(dow from d)::int = t.weekday
         and not exists (select 1 from games where team_id = t.id and date = d and generated) then
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
