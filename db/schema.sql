create table if not exists users (
  id          text primary key,        -- Clerk user id ("user_xxx")
  email       text,
  created_at  timestamptz not null default now()
);

create table if not exists entitlements (
  user_id               text primary key references users(id) on delete cascade,
  one_time_credits      integer not null default 0,
  subscription_status   text not null default 'none',   -- 'none' | 'active' | 'canceled' | 'revoked'
  polar_customer_id     text,
  polar_subscription_id text,
  hours_limit           numeric,
  hours_used            numeric not null default 0,
  current_period_end    timestamptz,
  updated_at            timestamptz not null default now()
);

create table if not exists interviews (
  id              bigserial primary key,
  user_id         text not null references users(id) on delete cascade,
  created_at      timestamptz not null default now(),
  title           text,
  interview_type  text,
  target_level    text,
  job_desc        text,
  resume          text,
  extra_context   text,
  transcript      text not null,
  analysis        jsonb not null,
  training        jsonb not null,
  duration_hours  numeric,
  charged_via     text not null        -- 'credit' | 'subscription'
);
create index if not exists interviews_user_created_idx on interviews(user_id, created_at desc);
alter table interviews add column if not exists title text;

create table if not exists polar_webhook_events (
  id           text primary key,       -- Polar event id, for idempotency
  type         text not null,
  received_at  timestamptz not null default now()
);
