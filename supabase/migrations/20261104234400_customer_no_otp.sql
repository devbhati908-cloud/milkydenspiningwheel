-- No-OTP customer registration and spin RPCs.
-- Apply after 20261104232600_customer_supabase_flow.sql.
-- Phone numbers identify records but do not prove ownership; see README.md.

create table if not exists public.customer_operation_limits (
  normalized_phone text not null
    check (normalized_phone ~ '^[6-9][0-9]{9}$'),
  operation text not null
    check (operation in ('register', 'spin')),
  window_started_at timestamptz not null,
  request_count integer not null check (request_count > 0),
  primary key (normalized_phone, operation)
);

alter table public.customer_operation_limits enable row level security;
revoke all on public.customer_operation_limits from public, anon, authenticated;
create index if not exists customer_operation_limits_window_idx
  on public.customer_operation_limits (window_started_at);

create or replace function public.consume_customer_operation_limit(
  p_phone text,
  p_operation text
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_window interval;
  v_max_requests integer;
  v_request_count integer;
begin
  delete from public.customer_operation_limits
  where ctid in (
    select limits.ctid
    from public.customer_operation_limits as limits
    where limits.window_started_at < now() - interval '1 day'
    order by limits.window_started_at
    limit 100
  );

  if p_operation = 'register' then
    v_window := interval '15 minutes';
    v_max_requests := 10;
  elsif p_operation = 'spin' then
    v_window := interval '10 minutes';
    v_max_requests := 5;
  else
    raise exception 'Invalid customer operation.' using errcode = '22023';
  end if;

  insert into public.customer_operation_limits as limits (
    normalized_phone,
    operation,
    window_started_at,
    request_count
  )
  values (p_phone, p_operation, now(), 1)
  on conflict (normalized_phone, operation) do update
  set window_started_at = case
        when limits.window_started_at <= now() - v_window then now()
        else limits.window_started_at
      end,
      request_count = case
        when limits.window_started_at <= now() - v_window then 1
        else least(limits.request_count + 1, v_max_requests + 1)
      end
  returning request_count into v_request_count;

  return v_request_count <= v_max_requests;
end;
$$;

revoke all on function public.consume_customer_operation_limit(text, text)
  from public, anon, authenticated;

create or replace function public.register_customer(
  p_name text,
  p_phone text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_name text := regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g');
  v_phone text;
  v_customer_id uuid;
  v_customer_name text;
  v_campaign_id uuid;
  v_spin public.spins%rowtype;
begin
  if char_length(v_name) not between 2 and 60 then
    raise exception 'Enter a valid customer name.' using errcode = '22023';
  end if;

  v_phone := public.normalize_indian_phone(p_phone);
  if not public.consume_customer_operation_limit(v_phone, 'register') then
    return jsonb_build_object('status', 'rate_limited');
  end if;

  select c.id into v_campaign_id
  from public.campaigns as c
  where c.is_active
    and c.start_date <= now()
    and (c.end_date is null or c.end_date > now())
  limit 1;

  if v_campaign_id is null then
    raise exception 'There is no active campaign.' using errcode = 'P0002';
  end if;

  insert into public.customers (name, normalized_phone)
  values (v_name, v_phone)
  on conflict (normalized_phone) do nothing
  returning id, name into v_customer_id, v_customer_name;

  if v_customer_id is null then
    select c.id, c.name into v_customer_id, v_customer_name
    from public.customers as c
    where c.normalized_phone = v_phone;
  end if;

  select * into v_spin
  from public.spins as s
  where s.customer_id = v_customer_id
    and s.campaign_id = v_campaign_id;

  if found then
    return jsonb_build_object(
      'status', 'already_played',
      'name', v_customer_name,
      'normalized_phone', v_phone,
      'prize', v_spin.prize,
      'spin_timestamp', v_spin.spin_timestamp
    );
  end if;

  return jsonb_build_object(
    'status', 'ready',
    'name', v_customer_name,
    'normalized_phone', v_phone
  );
end;
$$;

revoke all on function public.register_customer(text, text) from public, anon;
grant execute on function public.register_customer(text, text) to anon, authenticated;

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
  v_customer_name text;
  v_campaign_id uuid;
  v_prize text;
  v_roll numeric;
  v_spin public.spins%rowtype;
begin
  if char_length(v_name) not between 2 and 60 then
    raise exception 'Enter a valid customer name.' using errcode = '22023';
  end if;

  v_phone := public.normalize_indian_phone(p_phone);
  if not public.consume_customer_operation_limit(v_phone, 'spin') then
    return jsonb_build_object('status', 'rate_limited');
  end if;

  select c.id into v_campaign_id
  from public.campaigns as c
  where c.is_active
    and c.start_date <= now()
    and (c.end_date is null or c.end_date > now())
  limit 1;

  if v_campaign_id is null then
    raise exception 'There is no active campaign.' using errcode = 'P0002';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(v_phone || ':' || v_campaign_id::text, 0)
  );

  insert into public.customers (name, normalized_phone)
  values (v_name, v_phone)
  on conflict (normalized_phone) do nothing
  returning id, name into v_customer_id, v_customer_name;

  if v_customer_id is null then
    select c.id, c.name into v_customer_id, v_customer_name
    from public.customers as c
    where c.normalized_phone = v_phone;
  end if;

  select * into v_spin
  from public.spins as s
  where s.customer_id = v_customer_id
    and s.campaign_id = v_campaign_id;

  if found then
    return jsonb_build_object(
      'status', 'already_played',
      'name', v_customer_name,
      'normalized_phone', v_phone,
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
    from public.spins as s
    where s.customer_id = v_customer_id
      and s.campaign_id = v_campaign_id;

    return jsonb_build_object(
      'status', 'already_played',
      'name', v_customer_name,
      'normalized_phone', v_phone,
      'prize', v_spin.prize,
      'spin_timestamp', v_spin.spin_timestamp
    );
  end if;

  return jsonb_build_object(
    'status', 'completed',
    'name', v_customer_name,
    'normalized_phone', v_phone,
    'prize', v_spin.prize,
    'spin_timestamp', v_spin.spin_timestamp
  );
end;
$$;

revoke all on function public.spin_and_win(text, text) from public, anon;
grant execute on function public.spin_and_win(text, text) to anon, authenticated;

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
  from (
    select
      c.name as customer_name,
      c.normalized_phone,
      s.prize,
      s.redemption_status
    from public.spins as s
    join public.customers as c on c.id = s.customer_id
    union all
    select
      c.name as customer_name,
      c.normalized_phone,
      null::text as prize,
      null::text as redemption_status
    from public.customers as c
    where not exists (
      select 1
      from public.spins as s
      where s.customer_id = c.id
    )
  ) as records
  where (v_search is null
      or records.customer_name ilike '%' || v_search || '%'
      or records.normalized_phone like '%'
        || regexp_replace(v_search, '[^0-9]', '', 'g') || '%')
    and (p_prize is null or records.prize = p_prize)
    and (p_redemption_status is null
      or records.redemption_status = p_redemption_status);

  select coalesce(jsonb_agg(to_jsonb(page_rows)
    order by page_rows.spin_timestamp desc nulls last,
      page_rows.customer_created_at desc,
      page_rows.customer_name), '[]'::jsonb)
  into v_rows
  from (
    select records.*
    from (
      select
        s.id,
        c.id as customer_id,
        s.id as spin_id,
        c.name as customer_name,
        c.normalized_phone,
        s.prize,
        s.spin_timestamp,
        s.redemption_status,
        s.redeemed_at,
        s.redeemed_by,
        s.purchase_total,
        s.campaign_id,
        campaign.name as campaign_name,
        c.created_at as customer_created_at
      from public.spins as s
      join public.customers as c on c.id = s.customer_id
      join public.campaigns as campaign on campaign.id = s.campaign_id
      union all
      select
        null::uuid as id,
        c.id as customer_id,
        null::uuid as spin_id,
        c.name as customer_name,
        c.normalized_phone,
        null::text as prize,
        null::timestamptz as spin_timestamp,
        null::text as redemption_status,
        null::timestamptz as redeemed_at,
        null::uuid as redeemed_by,
        null::numeric as purchase_total,
        null::uuid as campaign_id,
        null::text as campaign_name,
        c.created_at as customer_created_at
      from public.customers as c
      where not exists (
        select 1
        from public.spins as s
        where s.customer_id = c.id
      )
    ) as records
    where (v_search is null
        or records.customer_name ilike '%' || v_search || '%'
        or records.normalized_phone like '%'
          || regexp_replace(v_search, '[^0-9]', '', 'g') || '%')
      and (p_prize is null or records.prize = p_prize)
      and (p_redemption_status is null
        or records.redemption_status = p_redemption_status)
    order by records.spin_timestamp desc nulls last,
      records.customer_created_at desc,
      records.customer_name
    limit v_page_size offset (v_page - 1) * v_page_size
  ) as page_rows;

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
