-- Change course pricing as one transaction. An insertion failure must not leave the course with no active plan.
-- Supported in phase 1: free/one-time/monthly/yearly pricing metadata. No payment or entitlement is created.
begin;
create or replace function public.configure_course_pricing(
  p_course_id uuid,
  p_model text,
  p_amount_cents integer,
  p_currency text default 'USD',
  p_access_days integer default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_course public.courses%rowtype;
  v_product_id uuid;
  v_plan_id uuid;
  v_kind public.plan_kind;
  v_interval public.billing_interval;
  v_amount integer;
  v_days integer;
begin
  if auth.uid() is null or not public.can_manage_course(p_course_id) then
    raise exception 'permission_denied' using errcode = '42501';
  end if;
  select * into v_course from public.courses where id = p_course_id for update;
  if not found then raise exception 'course_not_found' using errcode = 'P0002'; end if;
  if p_model is null or p_model not in ('free','one_time','monthly','yearly') then
    raise exception 'invalid_pricing_model' using errcode = '22023';
  end if;
  if p_currency is null or p_currency !~ '^[A-Z]{3}$' then
    raise exception 'invalid_currency' using errcode = '22023';
  end if;

  if p_model = 'free' then
    v_kind := 'free'; v_interval := null; v_amount := 0; v_days := null;
  elsif p_model = 'one_time' then
    v_kind := 'one_time'; v_interval := null; v_amount := p_amount_cents; v_days := p_access_days;
  elsif p_model = 'monthly' then
    v_kind := 'subscription'; v_interval := 'month'; v_amount := p_amount_cents; v_days := null;
  else
    v_kind := 'subscription'; v_interval := 'year'; v_amount := p_amount_cents; v_days := null;
  end if;

  if v_kind <> 'free' and (v_amount is null or v_amount < 1 or v_amount > 10000000) then
    raise exception 'invalid_price' using errcode = '22023';
  end if;
  if v_kind = 'one_time' and v_days is not null and (v_days < 1 or v_days > 3650) then
    raise exception 'invalid_access_days' using errcode = '22023';
  end if;

  update public.courses set access_type = case when p_model = 'free' then 'free'::public.course_access_type else 'paid'::public.course_access_type end
    where id = p_course_id;

  select id into v_product_id from public.products where type = 'course' and course_id = p_course_id for update;
  if v_product_id is null then
    insert into public.products(type, course_id, title) values ('course', p_course_id, v_course.title) returning id into v_product_id;
  end if;

  update public.pricing_plans set active = false where product_id = v_product_id and active = true;
  insert into public.pricing_plans(product_id, kind, billing_interval, amount_cents, currency, access_days, active)
    values (v_product_id, v_kind, v_interval, v_amount, p_currency, v_days, true)
    returning id into v_plan_id;
  return v_plan_id;
end $$;
revoke all on function public.configure_course_pricing(uuid, text, integer, text, integer) from public, anon;
grant execute on function public.configure_course_pricing(uuid, text, integer, text, integer) to authenticated, service_role;
commit;
