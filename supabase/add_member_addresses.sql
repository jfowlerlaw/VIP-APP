-- Run in Supabase's SQL Editor before deploying the full-address sign-up form.
-- Safe to rerun. Existing member records are left intact.
begin;

alter table public.vip_members
  add column if not exists address_line1 text not null default '',
  add column if not exists address_line2 text not null default '',
  add column if not exists state text not null default '',
  add column if not exists postal_code text not null default '',
  add column if not exists country text not null default '';

notify pgrst, 'reload schema';

commit;
