-- ============================================================
-- 0009 — Sair da lista de espera
-- O avulso que entrou na fila pode desistir dela a qualquer momento
-- (sem cobrança envolvida — a fila é gratuita).
-- ============================================================

create or replace function fn_withdraw_dropin(p_game_id uuid, p_player_id uuid, p_source text default 'self')
returns jsonb as $$
declare g games%rowtype; part game_participants%rowtype; promo jsonb;
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
  if now() > g.withdraw_until and p_source = 'self' then
    return jsonb_build_object('ok', false, 'error', 'withdraw_deadline_passed');
  end if;

  update game_participants set status = 'withdrawn', source = p_source where id = part.id;
  promo := fn_promote_waitlist(p_game_id);
  return jsonb_build_object('ok', true, 'promoted', promo->'promoted');
end;
$$ language plpgsql security definer;
