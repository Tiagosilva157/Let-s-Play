-- ============================================================
-- 0005 — Dados obrigatórios do Asaas + abertura de lista notificável
--
-- O Asaas recusa qualquer cobrança sem CPF/CNPJ do cliente
-- ("Para criar esta cobrança é necessário preencher o CPF ou CNPJ").
-- Passamos a guardar CPF e e-mail do jogador para enviar na criação do cliente.
--
-- fn_open_lists passa a devolver os ids dos jogos abertos, para que o
-- backend consiga anunciar a abertura da lista no grupo do WhatsApp.
-- ============================================================

alter table players add column if not exists email text;
alter table players add column if not exists cpf_cnpj text;

create index if not exists idx_players_cpf on players(cpf_cnpj) where cpf_cnpj is not null;

create or replace function fn_open_lists()
returns jsonb as $$
declare g record; opened uuid[] := '{}';
begin
  for g in select * from games where status = 'scheduled' and opens_at <= now() for update loop
    insert into game_participants (game_id, player_id, kind, status, source)
      select g.id, tm.player_id, 'member', 'invited', 'system'
      from team_members tm
      where tm.team_id = g.team_id and tm.status = 'active'
      on conflict (game_id, player_id) do nothing;
    update games set status = 'open' where id = g.id;
    opened := opened || g.id;
  end loop;
  return jsonb_build_object('ok', true, 'opened', opened, 'count', coalesce(array_length(opened, 1), 0));
end;
$$ language plpgsql security definer;
