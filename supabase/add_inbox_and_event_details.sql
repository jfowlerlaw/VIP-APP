-- Run once in the Supabase SQL editor before deploying this app update. Safe to rerun.
alter table public.vip_events
  add column if not exists starts_at timestamptz,
  add column if not exists ends_at timestamptz,
  add column if not exists time_zone text not null default 'America/New_York',
  add column if not exists address text not null default '';

create table if not exists public.vip_notifications (
  id text primary key,
  title text not null,
  body text not null,
  member_id text references public.vip_members(id) on delete cascade,
  action_view text not null default 'events'
    check (action_view in ('events', 'perks', 'card', 'concierge')),
  created_at timestamptz not null default now()
);

create index if not exists vip_notifications_member_created
  on public.vip_notifications (member_id, created_at desc);

create table if not exists public.vip_notification_reads (
  notification_id text not null references public.vip_notifications(id) on delete cascade,
  member_id text not null references public.vip_members(id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (notification_id, member_id)
);

create index if not exists vip_notification_reads_member
  on public.vip_notification_reads (member_id);

alter table public.vip_notifications enable row level security;
alter table public.vip_notification_reads enable row level security;
