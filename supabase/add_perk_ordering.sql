begin;

alter table public.vip_perks add column if not exists sort_order integer;

with positions as (
  select id, (row_number() over (order by created_at desc, id) - 1)::integer as position
  from public.vip_perks
)
update public.vip_perks as perk
set sort_order = positions.position
from positions
where perk.id = positions.id and perk.sort_order is null;

alter table public.vip_perks
  alter column sort_order set default 0,
  alter column sort_order set not null;

create index if not exists vip_perks_display_order
  on public.vip_perks (sort_order, created_at desc, id);

create or replace function public.reorder_vip_perks(perk_ids text[])
returns setof public.vip_perks
language plpgsql
security invoker
set search_path = ''
as $$
begin
  lock table public.vip_perks in share row exclusive mode;

  if perk_ids is null
    or coalesce(array_ndims(perk_ids), 1) <> 1
    or cardinality(perk_ids) > 5000
    or exists (select 1 from unnest(perk_ids) as ids(id) where id is null or btrim(id) = '')
    or (select count(distinct id) from unnest(perk_ids) as ids(id)) <> cardinality(perk_ids)
  then
    raise exception 'Invalid perk order' using errcode = '22023';
  end if;

  if cardinality(perk_ids) <> (select count(*) from public.vip_perks)
    or exists (
      select 1 from unnest(perk_ids) as ids(id)
      where not exists (select 1 from public.vip_perks as perk where perk.id = ids.id)
    )
  then
    raise exception 'PERK_ORDER_CHANGED' using errcode = '40001';
  end if;

  update public.vip_perks as perk
  set sort_order = (positions.position - 1)::integer
  from unnest(perk_ids) with ordinality as positions(id, position)
  where perk.id = positions.id;

  return query
    select perk.* from public.vip_perks as perk
    order by perk.sort_order, perk.created_at desc, perk.id;
end;
$$;

revoke all on function public.reorder_vip_perks(text[]) from public, anon, authenticated;
grant execute on function public.reorder_vip_perks(text[]) to service_role;

notify pgrst, 'reload schema';
commit;
