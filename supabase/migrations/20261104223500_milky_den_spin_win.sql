-- Milky Den Spin & Win: secure database schema and RPCs.
-- Run this file once in the Supabase SQL Editor. It also upgrades the older
-- schema.sql layout by copying starts_at/ends_at into start_date/end_date.

create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 2 and 60),
  normalized_phone text not null
    check (normalized_phone ~ '^[6-9][0-9]{9}$'),
  created_at timestamptz not null default now()
);

create table if not exists public.campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  is_active boolean not null default false,
  start_date timestamptz not null default now(),
  end_date timestamptz,
  created_at timestamptz not null default now(),
  constraint campaigns_valid_dates
    check (end_date is null or end_date > start_date)
);

create table if not exists public.admin_users (
  user_id uuid primary key references auth.users (id) on delete cascade,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.spins (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id) on delete restrict,
  campaign_id uuid not null references public.campaigns (id) on delete restrict,
  prize text not null check (prize in (
    'FREE SOFTY',
    '10% OFF',
    '20% OFF',
    'FREE TOPPING',
    'BETTER LUCK NEXT TIME'
  )),
  spin_timestamp timestamptz not null default now(),
  redemption_status text not null default 'pending'
    check (redemption_status in ('pending', 'redeemed')),
  redeemed_at timestamptz,
  redeemed_by uuid references auth.users (id) on delete restrict,
  purchase_total numeric(10, 2),
  constraint spins_redemption_fields_consistent check (
    (redemption_status = 'pending' and redeemed_at is null and redeemed_by is null)
    or (redemption_status = 'redeemed' and redeemed_at is not null and redeemed_by is not null)
  ),
  constraint spins_twenty_percent_minimum check (
    prize <> '20% OFF'
    or redemption_status <> 'redeemed'
    or purchase_total >= 500
  ),
  constraint spins_nonnegative_purchase check (
    purchase_total is null or purchase_total >= 0
  )
);

-- Make the migration safe to apply to the earlier schema.sql layout too.
alter table public.campaigns
  add column if not exists start_date timestamptz;
alter table public.campaigns
  add column if not exists end_date timestamptz;
alter table public.admin_users
  add column if not exists is_active boolean not null default true;
alter table public.spins
  add column if not exists purchase_total numeric(10, 2);

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'campaigns'
      and column_name = 'starts_at'
  ) then
    execute '
      update public.campaigns
      set start_date = starts_at
      where start_date is null
    ';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'campaigns'
      and column_name = 'ends_at'
  ) then
    execute '
      update public.campaigns
      set end_date = ends_at
      where end_date is null
    ';
  end if;

  update public.campaigns
  set start_date = now()
  where start_date is null;
end;
$$;

alter table public.campaigns
  alter column start_date set default now(),
  alter column start_date set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.campaigns'::regclass
      and conname = 'campaigns_start_end_dates_check'
  ) then
    alter table public.campaigns
      add constraint campaigns_start_end_dates_check
      check (end_date is null or end_date > start_date);
  end if;
end;
$$;

create unique index if not exists customers_normalized_phone_uidx
  on public.customers (normalized_phone);
create unique index if not exists campaigns_one_active_campaign
  on public.campaigns (is_active)
  where is_active;
create unique index if not exists spins_one_per_customer_campaign_uidx
  on public.spins (customer_id, campaign_id);
create index if not exists spins_campaign_timestamp_idx
  on public.spins (campaign_id, spin_timestamp desc);
create index if not exists spins_prize_status_idx
  on public.spins (prize, redemption_status);

create or replace function public.is_milky_den_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.admin_users a
    where a.user_id = auth.uid()
      and a.is_active
  );
$$;

revoke all on function public.is_milky_den_admin() from public, anon;
grant execute on function public.is_milky_den_admin() to authenticated;

alter table public.customers enable row level security;
alter table public.campaigns enable row level security;
alter table public.spins enable row level security;
alter table public.admin_users enable row level security;

drop policy if exists "Admins can view customers" on public.customers;
create policy "Admins can view customers"
  on public.customers for select to authenticated
  using (public.is_milky_den_admin());

drop policy if exists "Admins can view campaigns" on public.campaigns;
create policy "Admins can view campaigns"
  on public.campaigns for select to authenticated
  using (public.is_milky_den_admin());

drop policy if exists "Admins can view spins" on public.spins;
create policy "Admins can view spins"
  on public.spins for select to authenticated
  using (public.is_milky_den_admin());

drop policy if exists "Users can view their own admin authorization" on public.admin_users;
create policy "Users can view their own admin authorization"
  on public.admin_users for select to authenticated
  using (user_id = auth.uid());

revoke all on public.customers, public.campaigns, public.spins, public.admin_users
  from anon, authenticated;
grant select on public.customers, public.campaigns, public.spins, public.admin_users
  to authenticated;

create or replace function public.normalize_indian_phone(p_phone text)
returns text
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  v_digits text := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
begin
  if length(v_digits) = 12 and left(v_digits, 2) = '91' then
    v_digits := substring(v_digits from 3);
  elsif length(v_digits) = 11 and left(v_digits, 1) = '0' then
    v_digits := substring(v_digits from 2);
  end if;

  if v_digits !~ '^[6-9][0-9]{9}$' then
    raise exception 'Enter a valid Indian mobile number.' using errcode = '22023';
  end if;
  return v_digits;
end;
$$;

revoke all on function public.normalize_indian_phone(text) from public, anon;
grant execute on function public.normalize_indian_phone(text) to authenticated;

-- Customers can call this only with a Supabase-authenticated phone matching
-- their verified phone claim. The unique spin index resolves concurrent calls.
create or replace function public.spin_and_win(p_name text, p_phone text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_name text := regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g');
  v_phone text;
  v_customer_id uuid;
  v_campaign_id uuid;
  v_prize text;
  v_roll numeric;
  v_spin public.spins%rowtype;
begin
  if auth.uid() is null or nullif(auth.jwt() ->> 'phone', '') is null then
    raise exception 'A verified customer phone session is required.'
      using errcode = '42501';
  end if;
  if coalesce((auth.jwt() ->> 'phone_verified')::boolean, false) is not true then
    raise exception 'Verify your phone number before spinning.'
      using errcode = '42501';
  end if;
  if char_length(v_name) not between 2 and 60 then
    raise exception 'Enter a valid customer name.' using errcode = '22023';
  end if;

  v_phone := public.normalize_indian_phone(p_phone);
  if public.normalize_indian_phone(auth.jwt() ->> 'phone') <> v_phone then
    raise exception 'The authenticated phone number does not match.'
      using errcode = '42501';
  end if;

  select id into v_campaign_id
  from public.campaigns
  where is_active
    and start_date <= now()
    and (end_date is null or end_date > now())
  limit 1;
  if v_campaign_id is null then
    raise exception 'There is no active campaign.' using errcode = 'P0002';
  end if;

  insert into public.customers (name, normalized_phone)
  values (v_name, v_phone)
  on conflict (normalized_phone) do nothing
  returning id into v_customer_id;

  if v_customer_id is null then
    select id into v_customer_id
    from public.customers
    where normalized_phone = v_phone;
  end if;

  select * into v_spin
  from public.spins
  where customer_id = v_customer_id
    and campaign_id = v_campaign_id;
  if found then
    return jsonb_build_object(
      'status', 'already_played',
      'spin_id', v_spin.id,
      'prize', v_spin.prize,
      'spin_timestamp', v_spin.spin_timestamp
    );
  end if;

  v_roll := random() * 100;
  v_prize := case
    when v_roll < 2 then 'FREE SOFTY'
    when v_roll < 5 then 'FREE TOPPING'
    when v_roll < 20 then '20% OFF'
    else '10% OFF'
  end;

  insert into public.spins (customer_id, campaign_id, prize)
  values (v_customer_id, v_campaign_id, v_prize)
  on conflict (customer_id, campaign_id) do nothing
  returning * into v_spin;

  if not found then
    select * into v_spin
    from public.spins
    where customer_id = v_customer_id
      and campaign_id = v_campaign_id;
    return jsonb_build_object(
      'status', 'already_played',
      'spin_id', v_spin.id,
      'prize', v_spin.prize,
      'spin_timestamp', v_spin.spin_timestamp
    );
  end if;

  return jsonb_build_object(
    'status', 'completed',
    'spin_id', v_spin.id,
    'prize', v_spin.prize,
    'spin_timestamp', v_spin.spin_timestamp
  );
end;
$$;

revoke all on function public.spin_and_win(text, text) from public, anon;
grant execute on function public.spin_and_win(text, text) to authenticated;

create or replace function public.admin_dashboard(
  p_search text default null,
  p_prize text default null,
  p_redemption_status text default null,
  p_page integer default 1,
  p_page_size integer default 20
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
  v_page integer := greatest(coalesce(p_page, 1), 1);
  v_page_size integer := least(greatest(coalesce(p_page_size, 20), 1), 100);
  v_total integer;
  v_rows jsonb;
  v_summary jsonb;
begin
  if not public.is_milky_den_admin() then
    raise exception 'Administrator access is required.' using errcode = '42501';
  end if;
  if p_prize is not null and p_prize not in (
    'FREE SOFTY', '10% OFF', '20% OFF', 'FREE TOPPING', 'BETTER LUCK NEXT TIME'
  ) then
    raise exception 'Invalid prize filter.' using errcode = '22023';
  end if;
  if p_redemption_status is not null
    and p_redemption_status not in ('pending', 'redeemed') then
    raise exception 'Invalid redemption filter.' using errcode = '22023';
  end if;

  select count(*)::integer into v_total
  from public.spins s
  join public.customers c on c.id = s.customer_id
  where (v_search is null
      or c.name ilike '%' || v_search || '%'
      or c.normalized_phone like '%'
        || regexp_replace(v_search, '[^0-9]', '', 'g') || '%')
    and (p_prize is null or s.prize = p_prize)
    and (p_redemption_status is null or s.redemption_status = p_redemption_status);

  select coalesce(jsonb_agg(to_jsonb(page_rows)
    order by page_rows.spin_timestamp desc), '[]'::jsonb)
  into v_rows
  from (
    select
      s.id,
      c.name as customer_name,
      c.normalized_phone,
      s.prize,
      s.spin_timestamp,
      s.redemption_status,
      s.redeemed_at,
      s.redeemed_by,
      s.purchase_total,
      s.campaign_id,
      campaign.name as campaign_name
    from public.spins s
    join public.customers c on c.id = s.customer_id
    join public.campaigns campaign on campaign.id = s.campaign_id
    where (v_search is null
        or c.name ilike '%' || v_search || '%'
        or c.normalized_phone like '%'
          || regexp_replace(v_search, '[^0-9]', '', 'g') || '%')
      and (p_prize is null or s.prize = p_prize)
      and (p_redemption_status is null or s.redemption_status = p_redemption_status)
    order by s.spin_timestamp desc
    limit v_page_size offset (v_page - 1) * v_page_size
  ) page_rows;

  select jsonb_build_object(
    'total_customers', (select count(*) from public.customers),
    'total_spins', count(*),
    'free_softy_winners', count(*) filter (where prize = 'FREE SOFTY'),
    'free_topping_winners', count(*) filter (where prize = 'FREE TOPPING'),
    'twenty_off_winners', count(*) filter (where prize = '20% OFF'),
    'ten_off_winners', count(*) filter (where prize = '10% OFF'),
    'pending_redemptions', count(*) filter (where redemption_status = 'pending'),
    'completed_redemptions', count(*) filter (where redemption_status = 'redeemed')
  )
  into v_summary
  from public.spins;

  return jsonb_build_object(
    'summary', v_summary,
    'total', v_total,
    'page', v_page,
    'page_size', v_page_size,
    'rows', v_rows
  );
end;
$$;

revoke all on function public.admin_dashboard(text, text, text, integer, integer)
  from public, anon;
grant execute on function public.admin_dashboard(text, text, text, integer, integer)
  to authenticated;

create or replace function public.admin_redeem_spin(
  p_spin_id uuid,
  p_purchase_total numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_spin public.spins%rowtype;
begin
  if not public.is_milky_den_admin() then
    raise exception 'Administrator access is required.' using errcode = '42501';
  end if;
  if p_purchase_total is not null and p_purchase_total < 0 then
    raise exception 'Purchase total cannot be negative.' using errcode = '22023';
  end if;

  select * into v_spin
  from public.spins
  where id = p_spin_id
  for update;
  if not found then
    raise exception 'Spin record was not found.' using errcode = 'P0002';
  end if;
  if v_spin.redemption_status = 'redeemed' then
    raise exception 'This prize has already been redeemed.' using errcode = '23505';
  end if;
  if v_spin.prize = '20% OFF' and coalesce(p_purchase_total, 0) < 500 then
    raise exception '20%% OFF is valid only on purchases of ₹500 or more.'
      using errcode = '22023';
  end if;

  update public.spins
  set redemption_status = 'redeemed',
      redeemed_at = now(),
      redeemed_by = auth.uid(),
      purchase_total = p_purchase_total
  where id = p_spin_id
  returning * into v_spin;

  return jsonb_build_object(
    'id', v_spin.id,
    'prize', v_spin.prize,
    'redemption_status', v_spin.redemption_status,
    'redeemed_at', v_spin.redeemed_at,
    'redeemed_by', v_spin.redeemed_by,
    'purchase_total', v_spin.purchase_total
  );
end;
$$;

revoke all on function public.admin_redeem_spin(uuid, numeric) from public, anon;
grant execute on function public.admin_redeem_spin(uuid, numeric) to authenticated;
