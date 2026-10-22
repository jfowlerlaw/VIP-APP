-- Run in Supabase's SQL Editor before deploying this update. Safe to rerun.
-- Existing announcements and their buttons are not changed.
begin;

alter table public.vip_notifications
  drop constraint if exists vip_notifications_action_view_check;

alter table public.vip_notifications
  add constraint vip_notifications_action_view_check
  check (action_view in ('none', 'events', 'perks', 'card', 'concierge'));

alter table public.vip_notifications
  alter column action_view set default 'none';

commit;
