-- Wallets use integer minor units (cents) and immutable ledger entries.
-- Balances are only mutated by security-definer transaction functions.
create table public.wallets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade,
  is_platform boolean not null default false,
  currency text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  balance_cents bigint not null default 0 check (balance_cents >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((is_platform and user_id is null) or (not is_platform and user_id is not null))
);
create unique index wallets_user_currency_unique on public.wallets(user_id,currency);
create unique index wallets_one_platform_per_currency on public.wallets(currency) where is_platform;
create table public.wallet_transactions (
  id uuid primary key default gen_random_uuid(),
  wallet_id uuid not null references public.wallets(id) on delete restrict,
  amount_cents bigint not null check (amount_cents <> 0),
  balance_after_cents bigint not null check (balance_after_cents >= 0),
  kind text not null check (kind in ('admin_credit','course_purchase','course_sale','platform_commission','refund','adjustment')),
  reference_id uuid,
  actor_id uuid references public.profiles(id) on delete set null,
  description text not null default '',
  created_at timestamptz not null default now()
);
create index wallet_transactions_wallet_created_idx on public.wallet_transactions(wallet_id, created_at desc);
alter table public.wallets enable row level security;
alter table public.wallet_transactions enable row level security;
revoke all on public.wallets, public.wallet_transactions from anon, authenticated;
grant select on public.wallets, public.wallet_transactions to authenticated;
create policy wallet_owner_read on public.wallets for select to authenticated using (user_id = auth.uid());
create policy wallet_ledger_owner_read on public.wallet_transactions for select to authenticated using (exists(select 1 from public.wallets w where w.id = wallet_id and w.user_id = auth.uid()));

create or replace function public.admin_credit_wallet(p_user_id uuid, p_amount_cents bigint, p_currency text, p_description text, p_actor_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_wallet public.wallets; v_tx uuid;
begin
  if p_amount_cents <= 0 or p_amount_cents > 100000000 or p_currency !~ '^[A-Z]{3}$' then raise exception 'invalid_amount'; end if;
  insert into public.wallets(user_id,currency) values(p_user_id,p_currency) on conflict(user_id,currency) do nothing;
  select * into v_wallet from public.wallets where user_id=p_user_id and currency=p_currency for update;
  if not found then raise exception 'wallet_not_found'; end if;
  update public.wallets set balance_cents=balance_cents+p_amount_cents, updated_at=now() where id=v_wallet.id returning * into v_wallet;
  insert into public.wallet_transactions(wallet_id,amount_cents,balance_after_cents,kind,actor_id,description)
  values(v_wallet.id,p_amount_cents,v_wallet.balance_cents,'admin_credit',p_actor_id,left(coalesce(p_description,'Admin wallet credit'),300)) returning id into v_tx;
  return v_tx;
end $$;
revoke all on function public.admin_credit_wallet(uuid,bigint,text,text,uuid) from public, anon, authenticated;
grant execute on function public.admin_credit_wallet(uuid,bigint,text,text,uuid) to service_role;

create or replace function public.purchase_course_with_wallet(p_plan_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_user uuid := auth.uid(); v_plan public.pricing_plans; v_product public.products; v_course public.courses;
  v_student public.wallets; v_instructor public.wallets; v_platform public.wallets; v_order uuid; v_commission bigint; v_net bigint; v_percent numeric := 0;
begin
  if v_user is null then raise exception 'authentication_required'; end if;
  select pl.* into v_plan from public.pricing_plans pl where pl.id=p_plan_id and pl.active=true for share;
  if not found or v_plan.kind <> 'one_time' or v_plan.amount_cents <= 0 then raise exception 'plan_not_purchasable'; end if;
  select pr.* into v_product from public.products pr where pr.id=v_plan.product_id and pr.active=true and pr.type='course';
  select c.* into v_course from public.courses c where c.id=v_product.course_id and c.status='published';
  if not found then raise exception 'course_unavailable'; end if;
  if v_course.created_by=v_user then raise exception 'cannot_buy_own_course'; end if;
  if exists(select 1 from public.entitlements e where e.user_id=v_user and e.course_id=v_course.id and e.status='active') then raise exception 'already_enrolled'; end if;
  insert into public.wallets(user_id,currency) values(v_user,v_plan.currency) on conflict(user_id,currency) do nothing;
  select * into v_student from public.wallets where user_id=v_user and currency=v_plan.currency for update;
  if v_student.balance_cents < v_plan.amount_cents then raise exception 'insufficient_balance'; end if;
  select coalesce((value #>> '{}')::numeric,0) into v_percent from public.platform_settings where key='commission_percent';
  v_percent := greatest(0,least(100,coalesce(v_percent,0)));
  v_commission := floor(v_plan.amount_cents*v_percent/100)::bigint; v_net := v_plan.amount_cents-v_commission;
  insert into public.orders(user_id,status,currency,total_cents,provider,paid_at) values(v_user,'paid',v_plan.currency,v_plan.amount_cents,'wallet',now()) returning id into v_order;
  insert into public.order_items(order_id,product_id,plan_id,unit_amount_cents) values(v_order,v_product.id,v_plan.id,v_plan.amount_cents);
  update public.wallets set balance_cents=balance_cents-v_plan.amount_cents,updated_at=now() where id=v_student.id returning * into v_student;
  insert into public.wallet_transactions(wallet_id,amount_cents,balance_after_cents,kind,reference_id,description) values(v_student.id,-v_plan.amount_cents,v_student.balance_cents,'course_purchase',v_order,'Course purchase: '||v_course.title);
  insert into public.wallets(user_id,currency) values(v_course.created_by,v_plan.currency) on conflict(user_id,currency) do nothing;
  select * into v_instructor from public.wallets where user_id=v_course.created_by and currency=v_plan.currency for update;
  update public.wallets set balance_cents=balance_cents+v_net,updated_at=now() where id=v_instructor.id returning * into v_instructor;
  insert into public.wallet_transactions(wallet_id,amount_cents,balance_after_cents,kind,reference_id,description) values(v_instructor.id,v_net,v_instructor.balance_cents,'course_sale',v_order,'Course sale: '||v_course.title);
  if v_commission>0 then
    insert into public.wallets(user_id,is_platform,currency) values(null,true,v_plan.currency) on conflict do nothing;
    select * into v_platform from public.wallets where is_platform=true and currency=v_plan.currency for update;
    update public.wallets set balance_cents=balance_cents+v_commission,updated_at=now() where id=v_platform.id returning * into v_platform;
    insert into public.wallet_transactions(wallet_id,amount_cents,balance_after_cents,kind,reference_id,description) values(v_platform.id,v_commission,v_platform.balance_cents,'platform_commission',v_order,'Platform commission: '||v_course.title);
  end if;
  insert into public.entitlements(user_id,course_id,source,status,product_id) values(v_user,v_course.id,'purchase','active',v_product.id);
  insert into public.enrollments(user_id,course_id) values(v_user,v_course.id) on conflict(user_id,course_id) do nothing;
  return jsonb_build_object('order_id',v_order,'charged_cents',v_plan.amount_cents,'instructor_credited_cents',v_net,'commission_cents',v_commission,'currency',v_plan.currency);
end $$;
revoke all on function public.purchase_course_with_wallet(uuid) from public, anon;
grant execute on function public.purchase_course_with_wallet(uuid) to authenticated;
