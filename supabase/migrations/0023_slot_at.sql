-- ============================================================
-- 0023 — Posição estável na lista: ordenar por quando a pessoa GANHOU a vaga
--
-- Problema: a lista ordenava por confirmed_at e, para quem ainda não pagou,
-- pela data de criação da linha (quando entrou na lista de espera). Quem subia
-- da espera aparecia no meio da lista enquanto "aguardando pagamento" e pulava
-- para o fim ao pagar.
--
-- Solução: slot_at = instante em que a participação virou 'reserved' ou
-- 'confirmed' vindo de qualquer outro estado. Pagar (reserved → confirmed)
-- não mexe nele. Um gatilho cobre todos os caminhos (reserva, promoção da
-- espera, confirmação de mensalista, admin) sem reescrever as funções.
-- ============================================================
alter table game_participants add column if not exists slot_at timestamptz;

create or replace function set_slot_at() returns trigger as $$
begin
  if new.status in ('reserved','confirmed')
     and (tg_op = 'INSERT' or old.status is null or old.status not in ('reserved','confirmed')) then
    new.slot_at := now();
  elsif new.status not in ('reserved','confirmed') then
    new.slot_at := null;  -- saiu da lista: ao voltar, entra no fim
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_game_participants_slot_at on game_participants;
create trigger trg_game_participants_slot_at
  before insert or update of status on game_participants
  for each row execute function set_slot_at();

-- quem já está na lista hoje: mantém a ordem atual (confirmação, senão criação)
update game_participants
  set slot_at = coalesce(confirmed_at, created_at)
  where status in ('reserved','confirmed') and slot_at is null;
