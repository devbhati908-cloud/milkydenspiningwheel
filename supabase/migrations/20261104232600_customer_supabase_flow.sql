-- Supabase-backed customer registration and spin flow.
-- Apply after 20261104223500_milky_den_spin_win.sql.
-- Verified phone ownership is checked against Supabase Auth in the database.

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
  v_auth_phone text;
  v_customer_id uuid;
  v_customer_name text;
  v_campaign_id uuid;
  v_spin public.spins%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Verify your mobile number before registering.'
      using errcode = '42501';
  end if;

  select u.phone into v_auth_phone
  from auth.users as u
  where u.id = auth.uid()
    and u.phone_confirmed_at is not null;

  if v_auth_phone is null then
    raise exception 'Verify your mobile number before registering.'
      using errcode = '42501';
  end if;

  if char_length(v_name) not between 2 and 60 then
    raise exception 'Enter a valid customer name.' using errcode = '22023';
  end if;

  v_phone := public.normalize_indian_phone(p_phone);
  if public.normalize_indian_phone(v_auth_phone) <> v_phone then
    raise exception 'The verified mobile number does not match.'
      using errcode = '42501';
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
    where c.normalized_phone = v_phone
    for update;
  end if;

  select * into v_spin
  from public.spins as s
  where s.customer_id = v_customer_id
    and s.campaign_id = v_campaign_id;

  if found then
    return jsonb_build_object(
      'status', 'already_played',
      'customer_id', v_customer_id,
      'campaign_id', v_campaign_id,
      'name', v_customer_name,
      'normalized_phone', v_phone,
      'prize', v_spin.prize,
      'spin_timestamp', v_spin.spin_timestamp
    );
  end if;

  if v_customer_name <> v_name then
    update public.customers
    set name = v_name
    where id = v_customer_id
    returning name into v_customer_name;
  end if;

  return jsonb_build_object(
    'status', 'ready',
    'customer_id', v_customer_id,
    'campaign_id', v_campaign_id,
    'name', v_customer_name,
    'normalized_phone', v_phone
  );
end;
$$;

revoke all on function public.register_customer(text, text) from public, anon;
grant execute on function public.register_customer(text, text) to authenticated;

create or replace function public.spin_and_win(p_name text, p_phone text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_name text := regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g');
  v_phone text;
  v_auth_phone text;
  v_customer_id uuid;
  v_customer_name text;
  v_campaign_id uuid;
  v_prize text;
  v_roll numeric;
  v_spin public.spins%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Verify your mobile number before spinning.'
      using errcode = '42501';
  end if;

  select u.phone into v_auth_phone
  from auth.users as u
  where u.id = auth.uid()
    and u.phone_confirmed_at is not null;

  if v_auth_phone is null then
    raise exception 'Verify your mobile number before spinning.'
      using errcode = '42501';
  end if;

  if char_length(v_name) not between 2 and 60 then
    raise exception 'Enter a valid customer name.' using errcode = '22023';
  end if;

  v_phone := public.normalize_indian_phone(p_phone);
  if public.normalize_indian_phone(v_auth_phone) <> v_phone then
    raise exception 'The verified mobile number does not match.'
      using errcode = '42501';
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
      'customer_id', v_customer_id,
      'campaign_id', v_campaign_id,
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
      'customer_id', v_customer_id,
      'campaign_id', v_campaign_id,
      'name', v_customer_name,
      'normalized_phone', v_phone,
      'prize', v_spin.prize,
      'spin_timestamp', v_spin.spin_timestamp
    );
  end if;

  return jsonb_build_object(
    'status', 'completed',
    'customer_id', v_customer_id,
    'campaign_id', v_campaign_id,
    'name', v_customer_name,
    'normalized_phone', v_phone,
    'prize', v_spin.prize,
    'spin_timestamp', v_spin.spin_timestamp
  );
end;
$$;

revoke all on function public.spin_and_win(text, text) from public, anon;
grant execute on function public.spin_and_win(text, text) to authenticated;
