-- ============================================================
-- Vôlei Manager — Schema principal
-- ============================================================

create extension if not exists pgcrypto;

-- ---------- helpers ----------
create or replace function set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- ---------- admins ----------
create table admins (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  phone text,
  role text not null default 'admin' check (role in ('admin','owner')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------- players ----------
create table players (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text not null unique, -- E.164, ex 5511999999999
  notes text,
  active boolean not null default true,
  asaas_customer_id text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------- auth do jogador (OTP + sessão) ----------
create table otp_codes (
  id uuid primary key default gen_random_uuid(),
  phone text not null,
  code_hash text not null,
  attempts int not null default 0,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  request_ip text,
  created_at timestamptz not null default now()
);
create index idx_otp_phone on otp_codes(phone, created_at desc);

create table player_sessions (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references players(id) on delete cascade,
  token_hash text not null unique,
  device_info text,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index idx_sessions_player on player_sessions(player_id);

-- ---------- teams (turmas) ----------
create table teams (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  weekday int not null check (weekday between 0 and 6), -- 0=domingo
  game_time time not null,
  address text not null,
  capacity int not null check (capacity > 0),
  monthly_fee numeric(10,2) not null default 0,
  dropin_fee numeric(10,2) not null default 15.00,
  -- offsets em horas relativos ao horário do jogo
  open_hours_before int not null default 168,      -- abertura das confirmações
  confirm_hours_before int not null default 2,     -- prazo final confirmação
  withdraw_hours_before int not null default 1,    -- prazo final desistência
  reservation_minutes int not null default 15,     -- validade da pré-reserva Pix
  release_invited_hours_before int,                -- liberar vaga de mensalista sem resposta (null = nunca)
  waitlist_enabled boolean not null default true,
  whatsapp_group_id text,
  message_mode text not null default 'batched' check (message_mode in ('instant','batched','scheduled','manual')),
  batch_minutes int not null default 5,
  generate_weeks_ahead int not null default 2,
  rules_text text,
  status text not null default 'active' check (status in ('active','inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------- team_members (mensalistas) ----------
create table team_members (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id) on delete cascade,
  player_id uuid not null references players(id) on delete cascade,
  monthly_fee_override numeric(10,2),
  due_day int not null default 10 check (due_day between 1 and 28),
  asaas_subscription_id text unique,
  subscription_status text not null default 'none' check (subscription_status in ('none','active','paused','canceled','overdue')),
  status text not null default 'active' check (status in ('active','inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (team_id, player_id)
);
create index idx_members_team on team_members(team_id) where status = 'active';

-- ---------- games ----------
create table games (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id) on delete cascade,
  date date not null,
  time time not null,
  address_override text,
  capacity_override int,
  opens_at timestamptz not null,
  confirm_until timestamptz not null,
  withdraw_until timestamptz not null,
  status text not null default 'scheduled' check (status in ('scheduled','open','closed','canceled','done')),
  generated boolean not null default true,
  cancel_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (team_id, date)
);
create index idx_games_team_date on games(team_id, date);
create index idx_games_status on games(status, date);

-- ---------- game_participants ----------
create table game_participants (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references games(id) on delete cascade,
  player_id uuid not null references players(id) on delete cascade,
  kind text not null check (kind in ('member','dropin')),
  status text not null check (status in
    ('invited','confirmed','declined','reserved','waitlist','withdrawn','no_show','removed','pending_review')),
  reserved_until timestamptz,
  charge_id uuid,
  position int,
  source text not null default 'self' check (source in ('self','admin','system')),
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (game_id, player_id)
);
create index idx_participants_game on game_participants(game_id, status);

-- ---------- charges ----------
create table charges (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references players(id) on delete restrict,
  team_id uuid not null references teams(id) on delete restrict,
  game_id uuid references games(id) on delete set null,
  type text not null check (type in ('subscription','dropin')),
  asaas_payment_id text unique,
  amount numeric(10,2) not null,
  status text not null default 'pending' check (status in
    ('pending','received','confirmed','overdue','refunded','canceled','expired')),
  due_date date,
  pix_qr text,
  pix_copypaste text,
  expires_at timestamptz,
  credit_applied uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_charges_player on charges(player_id, created_at desc);
create index idx_charges_status on charges(status) where status in ('pending','overdue');

alter table game_participants
  add constraint fk_participant_charge foreign key (charge_id) references charges(id) on delete set null;

-- ---------- payment_events ----------
create table payment_events (
  id uuid primary key default gen_random_uuid(),
  charge_id uuid references charges(id) on delete cascade,
  asaas_event text not null,
  payload jsonb not null,
  processed_at timestamptz not null default now()
);

-- ---------- webhook_events (idempotência) ----------
create table webhook_events (
  id uuid primary key default gen_random_uuid(),
  source text not null default 'asaas',
  event_key text not null unique, -- asaas event id
  event_type text not null,
  payload jsonb not null,
  status text not null default 'received' check (status in ('received','processed','failed','skipped')),
  error text,
  created_at timestamptz not null default now()
);

-- ---------- credits ----------
create table credits (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references players(id) on delete cascade,
  team_id uuid not null references teams(id) on delete cascade,
  amount numeric(10,2) not null,
  origin_charge_id uuid references charges(id),
  used_in_charge_id uuid references charges(id),
  status text not null default 'available' check (status in ('available','used','revoked')),
  reason text,
  created_by uuid references admins(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------- mensagens ----------
create table message_templates (
  id uuid primary key default gen_random_uuid(),
  team_id uuid references teams(id) on delete cascade, -- null = global default
  event_key text not null check (event_key in
    ('list_opened','list_updated','player_confirmed','player_withdrew','payment_confirmed',
     'list_full','game_canceled','game_changed','reminder','list_closed','otp')),
  body text not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (team_id, event_key)
);

create table message_dispatches (
  id uuid primary key default gen_random_uuid(),
  team_id uuid references teams(id) on delete cascade,
  game_id uuid references games(id) on delete cascade,
  kind text not null check (kind in ('group','individual')),
  recipient text not null, -- group id ou telefone
  body text not null,
  dedupe_key text,
  status text not null default 'queued' check (status in ('queued','sent','failed','skipped','canceled')),
  scheduled_for timestamptz not null default now(),
  sent_at timestamptz,
  retries int not null default 0,
  error text,
  created_at timestamptz not null default now()
);
create index idx_dispatch_pending on message_dispatches(status, scheduled_for) where status = 'queued';
create unique index idx_dispatch_dedupe on message_dispatches(dedupe_key) where status = 'queued' and dedupe_key is not null;

-- ---------- audit ----------
create table audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_type text not null check (actor_type in ('admin','player','system','webhook')),
  actor_id text,
  action text not null,
  entity text not null,
  entity_id text,
  before jsonb,
  after jsonb,
  created_at timestamptz not null default now()
);
create index idx_audit_entity on audit_logs(entity, entity_id, created_at desc);

-- ---------- settings ----------
create table system_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

-- updated_at triggers
do $$
declare t text;
begin
  foreach t in array array['admins','players','teams','team_members','games','game_participants','charges','credits','message_templates'] loop
    execute format('create trigger trg_%s_updated before update on %I for each row execute function set_updated_at()', t, t);
  end loop;
end $$;
