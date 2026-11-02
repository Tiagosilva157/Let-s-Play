-- Teste das funções SQL do prazo limite dos mensalistas (migration 0022).
-- Roda num Postgres local com as migrations aplicadas; tudo dentro de uma transação com rollback.
-- Uso: psql "$DATABASE_URL" -f scripts/test-member-deadline.sql
\set ON_ERROR_STOP on
\pset format unaligned
\pset tuples_only on
begin;
-- ===== setup =====
insert into players (id, name, phone) values
 ('00000000-0000-0000-0000-00000000000a','Mensalista Um','5511900000001'),
 ('00000000-0000-0000-0000-00000000000b','Mensalista Dois','5511900000002'),
 ('00000000-0000-0000-0000-00000000000c','Mensalista Tres','5511900000003'),
 ('00000000-0000-0000-0000-00000000000d','Avulso Um','5511900000004'),
 ('00000000-0000-0000-0000-00000000000e','Avulso Dois','5511900000005');
-- turma A: prazo 8h antes; turma B: sem prazo (desativado)
insert into teams (id, name, slug, weekday, game_time, address, capacity, release_invited_hours_before, waitlist_enabled)
 values ('00000000-0000-0000-0000-0000000000a0','Turma A','turma-a',1,'20:00','Quadra',3,8,true),
        ('00000000-0000-0000-0000-0000000000b0','Turma B','turma-b',1,'20:00','Quadra',3,null,true);
insert into team_members (team_id, player_id) select '00000000-0000-0000-0000-0000000000a0', id from players where name like 'Mensalista%';
insert into team_members (team_id, player_id) select '00000000-0000-0000-0000-0000000000b0', id from players where name like 'Mensalista%';
-- jogo A daqui a 20h (prazo de 8h ainda NÃO chegou); jogo B daqui a 1h (prazo passaria, mas turma B não tem prazo)
insert into games (id, team_id, date, time, opens_at, confirm_until, withdraw_until, status)
 values ('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000a0',
         ((now() at time zone 'America/Sao_Paulo') + interval '20 hours')::date,
         ((now() at time zone 'America/Sao_Paulo') + interval '20 hours')::time,
         now() - interval '1 day', now() + interval '19 hours', now() + interval '19 hours', 'scheduled'),
        ('00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-0000000000b0',
         ((now() at time zone 'America/Sao_Paulo') + interval '1 hour')::date,
         ((now() at time zone 'America/Sao_Paulo') + interval '1 hour')::time,
         now() - interval '1 day', now() + interval '30 minutes', now() + interval '30 minutes', 'scheduled');
select 'abrir listas: ' || (fn_open_lists()->>'count');
select 'convites A: ' || count(*) from game_participants where game_id='00000000-0000-0000-0000-0000000000a1' and status='invited';

-- ===== 1. antes do prazo: rotina não mexe em nada =====
select 'T1 release antes do prazo (esperado []): ' || (fn_release_invited()->'released')::text;
select 'T1 convites A ainda invited (esperado 3): ' || count(*) from game_participants where game_id='00000000-0000-0000-0000-0000000000a1' and status='invited';
-- mensalista 1 confirma antes do prazo
select 'T1 m1 confirma (esperado ok true): ' || (fn_confirm_member('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-00000000000a')->>'ok');

-- ===== 2. prazo chega: jogo A passa a ser daqui a 7h (prazo 8h já passou) =====
update games set date=((now() at time zone 'America/Sao_Paulo') + interval '7 hours')::date,
                 time=((now() at time zone 'America/Sao_Paulo') + interval '7 hours')::time,
                 confirm_until = now() + interval '6 hours', withdraw_until = now() + interval '6 hours'
 where id='00000000-0000-0000-0000-0000000000a1';
select 'T2 release (esperado 1 jogo, released 2): ' || (fn_release_invited()->'released')::text;
select 'T2 m1 continua confirmado: ' || status from game_participants where game_id='00000000-0000-0000-0000-0000000000a1' and player_id='00000000-0000-0000-0000-00000000000a';
select 'T2 m2/m3 declined pelo sistema (esperado 2): ' || count(*) from game_participants where game_id='00000000-0000-0000-0000-0000000000a1' and status='declined' and source='system';
select 'T2 auditoria (esperado 1): ' || count(*) from audit_logs where action='release_invited' and entity_id='00000000-0000-0000-0000-0000000000a1';
select 'T2 vagas livres (esperado 2): ' || (fn_game_capacity('00000000-0000-0000-0000-0000000000a1') - fn_held_count('00000000-0000-0000-0000-0000000000a1'));

-- ===== 11. reexecução: nada muda =====
select 'T11 release de novo (esperado []): ' || (fn_release_invited()->'released')::text;
select 'T11 auditoria continua 1: ' || count(*) from audit_logs where action='release_invited' and entity_id='00000000-0000-0000-0000-0000000000a1';

-- ===== 9/10. turma B (sem prazo) não é afetada mesmo com jogo em 1h =====
select 'T10 convites B seguem invited (esperado 3): ' || count(*) from game_participants where game_id='00000000-0000-0000-0000-0000000000b1' and status='invited';

-- ===== 3. mensalista volta após o prazo com vaga livre =====
select 'T3 m2 confirma após prazo (esperado ok true): ' || (fn_confirm_member('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-00000000000b')->>'ok');
select 'T3 m2 status: ' || status || ' kind ' || kind from game_participants where game_id='00000000-0000-0000-0000-0000000000a1' and player_id='00000000-0000-0000-0000-00000000000b';

-- ===== 4. lista cheia: avulso reserva a última vaga; m3 tenta e vai para a espera =====
select 'T4 avulso d1 reserva (esperado ok true): ' || (fn_reserve_dropin('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-00000000000d')->>'ok');
select 'T4 vagas livres (esperado 0): ' || (fn_game_capacity('00000000-0000-0000-0000-0000000000a1') - fn_held_count('00000000-0000-0000-0000-0000000000a1'));
select 'T4 m3 confirma com lista cheia: ' || (fn_confirm_member('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-00000000000c'))::text;
select 'T4 m3 status (esperado waitlist/member): ' || status || '/' || kind from game_participants where game_id='00000000-0000-0000-0000-0000000000a1' and player_id='00000000-0000-0000-0000-00000000000c';
select 'T4 d1 continua reservado (não foi tirado): ' || status from game_participants where game_id='00000000-0000-0000-0000-0000000000a1' and player_id='00000000-0000-0000-0000-00000000000d';
select 'T4 m3 confirma de novo (esperado already_waitlisted true): ' || (fn_confirm_member('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-00000000000c')->>'already_waitlisted');
select 'T4 participações de m3 (esperado 1, sem duplicar): ' || count(*) from game_participants where game_id='00000000-0000-0000-0000-0000000000a1' and player_id='00000000-0000-0000-0000-00000000000c';

-- ===== 5. abre vaga: avulso desiste → m3 sobe da espera como confirmado (sem Pix) =====
select 'T5 d1 desiste: ' || (fn_withdraw_dropin('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-00000000000d'))::text;
select 'T5 m3 status (esperado confirmed): ' || status || ' promovido=' || promoted_from_waitlist from game_participants where game_id='00000000-0000-0000-0000-0000000000a1' and player_id='00000000-0000-0000-0000-00000000000c';
select 'T5 confirmados (esperado 3): ' || count(*) from game_participants where game_id='00000000-0000-0000-0000-0000000000a1' and status='confirmed';

-- ===== extra: mensalista sai da lista de espera =====
select 'X avulso d2 entra na espera: ' || (fn_reserve_dropin('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-00000000000e')->>'waitlisted');
update game_participants set status='waitlist', kind='member' where game_id='00000000-0000-0000-0000-0000000000a1' and player_id='00000000-0000-0000-0000-00000000000b'; -- simula m2 na espera
select 'X m2 sai da espera (esperado left_waitlist true): ' || (fn_decline_member('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-00000000000b')->>'left_waitlist');
select 'X m2 status (esperado declined): ' || status from game_participants where game_id='00000000-0000-0000-0000-0000000000a1' and player_id='00000000-0000-0000-0000-00000000000b';

-- ===== fechar listas continua funcionando =====
update games set confirm_until = now() - interval '1 minute' where id='00000000-0000-0000-0000-0000000000b1';
select 'Fecha listas (esperado closed 1): ' || (fn_close_lists()->>'closed');
-- visão pública expõe o prazo
select 'view members_confirm_until A: ' || coalesce(members_confirm_until::text,'null') || ' | B: ' || (select coalesce(members_confirm_until::text,'null') from public_game_view where game_id='00000000-0000-0000-0000-0000000000b1') from public_game_view where game_id='00000000-0000-0000-0000-0000000000a1';
rollback;
