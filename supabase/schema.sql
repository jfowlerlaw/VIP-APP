create extension if not exists pgcrypto;

create table if not exists public.vip_members (
  id text primary key default ('mem_' || replace(gen_random_uuid()::text, '-', '')),
  first_name text not null default '',
  last_name text not null default '',
  name text not null default '',
  card_name text not null default '',
  email text not null default '',
  phone text not null default '',
  city text not null default '',
  member_id text not null default '',
  joined text not null default '',
  status text not null default 'Unclaimed',
  claimed_at timestamptz,
  password_hash text not null default '',
  password_set_at timestamptz,
  preferences jsonb not null default '{"smsAlerts": true, "emailUpdates": true, "walletUpdates": true}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.vip_members
  add column if not exists first_name text not null default '',
  add column if not exists last_name text not null default '',
  add column if not exists password_hash text not null default '',
  add column if not exists password_set_at timestamptz;

alter table public.vip_members
  alter column name set default '',
  alter column card_name set default '';

create unique index if not exists vip_members_email_unique
  on public.vip_members (lower(email))
  where email is not null and email <> '';

create unique index if not exists vip_members_phone_unique
  on public.vip_members (phone)
  where phone is not null and phone <> '';

create table if not exists public.vip_events (
  id text primary key,
  title text not null,
  copy text not null default '',
  city text not null default '',
  date_label text not null default '',
  time_label text not null default '',
  location text not null default '',
  source text not null default 'Eventbrite',
  eventbrite_url text not null default '',
  image text not null default '',
  visible boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists vip_events_visible_created_at
  on public.vip_events (visible, created_at desc);

create table if not exists public.vip_requests (
  id text primary key,
  member_id text references public.vip_members(id) on delete cascade,
  member_name text not null,
  type text not null,
  message text not null default '',
  email_to text not null default 'vip@justcallmoe.com',
  status text not null default 'Open',
  created_at timestamptz not null default now(),
  email_status text,
  email_sent_at timestamptz,
  email_error text
);

create index if not exists vip_requests_member_id
  on public.vip_requests (member_id);

create index if not exists vip_requests_status_created_at
  on public.vip_requests (status, created_at desc);

create table if not exists public.vip_push_tokens (
  id text primary key,
  member_id text not null references public.vip_members(id) on delete cascade,
  token text not null,
  platform text not null default 'ios',
  provider text not null default 'capacitor',
  device text not null default '',
  enabled boolean not null default true,
  last_registered_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists vip_push_tokens_token_unique
  on public.vip_push_tokens (token);

create index if not exists vip_push_tokens_member_enabled
  on public.vip_push_tokens (member_id, enabled);

create index if not exists vip_push_tokens_platform_enabled
  on public.vip_push_tokens (platform, enabled);

create table if not exists public.vip_member_sessions (
  token text primary key,
  member_id text not null references public.vip_members(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists vip_member_sessions_member_id
  on public.vip_member_sessions (member_id);

create table if not exists public.vip_admin_sessions (
  token text primary key,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create or replace function public.normalize_vip_member_names()
returns trigger as $$
begin
  new.first_name = trim(coalesce(new.first_name, ''));
  new.last_name = trim(coalesce(new.last_name, ''));
  new.name = trim(coalesce(new.name, ''));
  new.card_name = trim(coalesce(new.card_name, ''));

  if new.name = '' then
    new.name = trim(concat_ws(' ', nullif(new.first_name, ''), nullif(new.last_name, '')));
  end if;

  if new.first_name = '' and new.name <> '' then
    new.first_name = split_part(new.name, ' ', 1);
  end if;

  if new.last_name = '' and new.name <> '' then
    new.last_name = regexp_replace(new.name, '^.*\s+', '');
  end if;

  if new.name = '' then
    new.name = 'VIP Member';
  end if;

  if new.card_name = '' then
    new.card_name = new.name;
  end if;

  return new;
end;
$$ language plpgsql;

drop trigger if exists normalize_vip_member_names on public.vip_members;
create trigger normalize_vip_member_names
before insert or update on public.vip_members
for each row execute function public.normalize_vip_member_names();

drop trigger if exists set_vip_members_updated_at on public.vip_members;
create trigger set_vip_members_updated_at
before update on public.vip_members
for each row execute function public.set_updated_at();

drop trigger if exists set_vip_events_updated_at on public.vip_events;
create trigger set_vip_events_updated_at
before update on public.vip_events
for each row execute function public.set_updated_at();

drop trigger if exists set_vip_push_tokens_updated_at on public.vip_push_tokens;
create trigger set_vip_push_tokens_updated_at
before update on public.vip_push_tokens
for each row execute function public.set_updated_at();

alter table public.vip_members enable row level security;
alter table public.vip_events enable row level security;
alter table public.vip_requests enable row level security;
alter table public.vip_push_tokens enable row level security;
alter table public.vip_member_sessions enable row level security;
alter table public.vip_admin_sessions enable row level security;
