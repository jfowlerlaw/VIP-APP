create table if not exists public.vip_perks (
  id text primary key,
  title text not null,
  description text not null default '',
  note text not null default '',
  icon text not null default 'star',
  accent text not null default 'red',
  button_label text not null default 'View',
  action_url text not null default '',
  action_message text not null default '',
  visible boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists vip_perks_visible_created_at
  on public.vip_perks (visible, created_at desc);

insert into public.vip_perks (
  id,
  title,
  description,
  note,
  icon,
  accent,
  button_label,
  action_url,
  action_message,
  visible
) values
  (
    'perk_private_group',
    'Private group',
    'Access the members-only Just Call Moe VIP Facebook community.',
    'Members-only access',
    'users',
    'green',
    'Join',
    'https://www.facebook.com/share/g/1B5JVZj46a/',
    '',
    true
  ),
  (
    'perk_shop_discount',
    'Shop discount',
    'Use code MOEVIP for merchandise at Shop.JustCallMoe.com.',
    'Available now',
    'badge-percent',
    'red',
    'Copy',
    '',
    'VIP shop code copied: MOEVIP',
    true
  ),
  (
    'perk_merch_alerts',
    'Free merch alerts',
    'Be first to hear when new VIP merchandise drops.',
    'SMS and email eligible',
    'megaphone',
    'blue',
    'On',
    '',
    'Merch alerts enabled.',
    true
  )
on conflict (id) do nothing;

alter table public.vip_perks enable row level security;
