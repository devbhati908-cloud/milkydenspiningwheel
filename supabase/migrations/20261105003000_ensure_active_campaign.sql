-- Ensure there is a current Milky Den Spin & Win campaign.
-- Apply after the existing customer no-OTP migration.
-- This is idempotent and reuses the named campaign if it already exists.

do $$
declare
  v_campaign_id uuid;
begin
  lock table public.campaigns in share row exclusive mode;

  if not exists (
    select 1
    from public.campaigns
    where is_active
      and start_date <= now()
      and (end_date is null or end_date > now())
  ) then
    update public.campaigns
    set is_active = false
    where is_active;

    select id into v_campaign_id
    from public.campaigns
    where name = 'Milky Den Spin & Win'
    order by created_at desc
    limit 1
    for update;

    if v_campaign_id is null then
      insert into public.campaigns (name, is_active, start_date, end_date)
      values ('Milky Den Spin & Win', true, now(), null);
    else
      update public.campaigns
      set is_active = true,
          start_date = now(),
          end_date = null
      where id = v_campaign_id;
    end if;
  end if;
end;
$$;
