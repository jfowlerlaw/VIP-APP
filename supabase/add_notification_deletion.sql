-- Run in Supabase's SQL Editor before deploying this update. Safe to rerun.
-- Adds per-member deletion state; no messages or read receipts are removed.
begin;

alter table public.vip_notification_reads
  add column if not exists deleted_at timestamptz;

create index if not exists vip_notification_reads_member_deleted
  on public.vip_notification_reads (member_id, notification_id)
  where deleted_at is not null;

commit;
