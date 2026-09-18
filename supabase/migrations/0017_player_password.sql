-- Senha do jogador no portal (substitui o código por WhatsApp como caminho principal)
alter table players add column if not exists password_hash text;
alter table players add column if not exists password_set_at timestamptz;

-- "Esqueci a senha": token de uso único enviado por e-mail
create table if not exists password_resets (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references players(id) on delete cascade,
  token_hash text not null,
  slug text,                      -- link público de onde o jogador pediu (para voltar ao jogo certo)
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists idx_password_resets_player on password_resets(player_id, created_at desc);

-- tentativas de login por senha (limite por telefone)
create table if not exists auth_attempts (
  id uuid primary key default gen_random_uuid(),
  phone text not null,
  ok boolean not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_auth_attempts_phone on auth_attempts(phone, created_at desc);
