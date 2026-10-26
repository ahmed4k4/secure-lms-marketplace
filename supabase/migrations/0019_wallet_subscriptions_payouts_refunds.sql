-- Complete wallet commerce flows: wallet-funded subscriptions, controlled instructor payouts,
-- refund review/reversal, and financial reconciliation. External-provider settlement still requires its provider API.

alter table public.wallets add column if not exists bucket text not null default 'user'
  check (bucket in ('user','platform_revenue','payout_clearing'));
update public.wallets set bucket='platform_revenue' where is_platform = true and bucket='user';
drop index if exists public.wallets_one_platform_per_currency;
create unique index if not exists wallets_platform_bucket_currency_unique
  on public.wallets(bucket,currency) where is_platform = true;
create unique index if not exists wallets_user_bucket_currency_unique
  on public.wallets(user_id,currency) where is_platform = false;

alter table public.wallet_transactions drop constraint if exists wallet_transactions_kind_check;
alter table public.wallet_transactions add constraint wallet_transactions_kind_check
  check (kind in ('admin_credit','course_purchase','course_sale','platform_commission','refund','adjustment',
                  'subscription_purchase','subscription_renewal','payout_hold','payout_release','payout_paid','settlement'));

alter table public.refunds
  add column if not exists requested_by uuid references public.profiles(id) on delete set null,
  add column if not exists reviewed_by uuid references public.profiles(id) on delete set null,
  add column if not exists reviewed_at timestamptz,
  add column if not exists failure_reason text;
create unique index if not exists refunds_one_open_or_succeeded_per_order
  on public.refunds(order_id) where status in ('pending','succeeded');

create table if not exists public.payout_requests (
  id uuid primary key default gen_random_uuid(),
  instructor_id uuid not null references public.profiles(id) on delete restrict,
  amount_cents bigint not null check (amount_cents > 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  status text not null default 'pending' check (status in ('pending','approved','rejected','paid')),
  payout_method text not null check (payout_method in ('bank_transfer','paypal','wise','other')),
  payout_details jsonb not null default '{}'::jsonb,
  transfer_reference text,
  admin_note text,
  requested_at timestamptz not null default now(),
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  paid_at timestamptz
);
create index if not exists payout_requests_instructor_idx on public.payout_requests(instructor_id, requested_at desc);
create index if not exists payout_requests_review_idx on public.payout_requests(status, requested_at) where status in ('pending','approved');

create table if not exists public.payout_request_allocations (
  id uuid primary key default gen_random_uuid(),
  payout_request_id uuid not null references public.payout_requests(id) on delete cascade,
  earning_id uuid not null references public.instructor_earnings(id) on delete restrict,
  amount_cents bigint not null check (amount_cents > 0),
  created_at timestamptz not null default now(),
  unique(payout_request_id, earning_id)
);
create index if not exists payout_alloc_earning_idx on public.payout_request_allocations(earning_id);

create table if not exists public.financial_reconciliation_runs (
  id uuid primary key default gen_random_uuid(),
  period_start timestamptz not null,
  period_end timestamptz not null,
  created_by uuid references public.profiles(id) on delete set null,
  summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (period_end > period_start)
);

alter table public.payout_requests enable row level security;
alter table public.payout_request_allocations enable row level security;
alter table public.financial_reconciliation_runs enable row level security;
revoke all on public.payout_requests, public.payout_request_allocations, public.financial_reconciliation_runs from anon, authenticated;
grant select on public.payout_requests to authenticated;
create policy payout_request_owner_read on public.payout_requests for select to authenticated using (instructor_id = auth.uid());
grant select on public.financial_reconciliation_runs to authenticated;
create policy finance_runs_admin_read on public.financial_reconciliation_runs for select to authenticated using (public.has_permission('users.manage'));

-- Redefine wallet purchase to record auditable instructor earnings and use a revenue bucket.
create or replace function public.purchase_course_with_wallet(p_plan_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid(); v_plan public.pricing_plans; v_product public.products; v_course public.courses;
  v_student public.wallets; v_instructor public.wallets; v_platform public.wallets; v_order uuid; v_item uuid;
  v_commission bigint; v_net bigint; v_percent numeric := 0;
begin
  if v_user is null then raise exception 'authentication_required'; end if;
  select * into v_plan from public.pricing_plans pl where pl.id=p_plan_id and pl.active=true for share;
  if not found or v_plan.kind <> 'one_time' or v_plan.amount_cents <= 0 then raise exception 'plan_not_purchasable'; end if;
  select pr.* into v_product from public.products pr where pr.id=v_plan.product_id and pr.active=true and pr.type='course';
  if not found then raise exception 'course_unavailable'; end if;
  select c.* into v_course from public.courses c where c.id=v_product.course_id and c.status='published';
  if not found then raise exception 'course_unavailable'; end if;
  if v_course.created_by=v_user then raise exception 'cannot_buy_own_course'; end if;
  if exists(select 1 from public.entitlements e where e.user_id=v_user and e.course_id=v_course.id and e.status='active' and (e.expires_at is null or e.expires_at>now())) then raise exception 'already_enrolled'; end if;
  insert into public.wallets(user_id,currency,bucket) values(v_user,v_plan.currency,'user') on conflict(user_id,currency) where is_platform=false do nothing;
  select * into v_student from public.wallets where user_id=v_user and currency=v_plan.currency and is_platform=false for update;
  if not found or v_student.balance_cents < v_plan.amount_cents then raise exception 'insufficient_balance'; end if;
  select coalesce((value #>> '{}')::numeric,0) into v_percent from public.platform_settings where key='commission_percent';
  v_percent := greatest(0,least(100,coalesce(v_percent,0)));
  v_commission := floor(v_plan.amount_cents*v_percent/100)::bigint; v_net := v_plan.amount_cents-v_commission;
  insert into public.orders(user_id,status,currency,total_cents,provider,paid_at) values(v_user,'paid',v_plan.currency,v_plan.amount_cents,'wallet',now()) returning id into v_order;
  insert into public.order_items(order_id,product_id,plan_id,unit_amount_cents) values(v_order,v_product.id,v_plan.id,v_plan.amount_cents) returning id into v_item;
  update public.wallets set balance_cents=balance_cents-v_plan.amount_cents,updated_at=now() where id=v_student.id returning * into v_student;
  insert into public.wallet_transactions(wallet_id,amount_cents,balance_after_cents,kind,reference_id,description) values(v_student.id,-v_plan.amount_cents,v_student.balance_cents,'course_purchase',v_order,'Course purchase: '||v_course.title);
  insert into public.wallets(user_id,currency,bucket) values(v_course.created_by,v_plan.currency,'user') on conflict(user_id,currency) where is_platform=false do nothing;
  select * into v_instructor from public.wallets where user_id=v_course.created_by and currency=v_plan.currency and is_platform=false for update;
  update public.wallets set balance_cents=balance_cents+v_net,updated_at=now() where id=v_instructor.id returning * into v_instructor;
  insert into public.wallet_transactions(wallet_id,amount_cents,balance_after_cents,kind,reference_id,description) values(v_instructor.id,v_net,v_instructor.balance_cents,'course_sale',v_order,'Course sale: '||v_course.title);
  insert into public.instructor_earnings(instructor_id,order_item_id,gross_cents,commission_cents,net_cents,status) values(v_course.created_by,v_item,v_plan.amount_cents,v_commission,v_net,'pending');
  if v_commission>0 then
    insert into public.wallets(user_id,is_platform,currency,bucket) values(null,true,v_plan.currency,'platform_revenue') on conflict(bucket,currency) where is_platform=true do nothing;
    select * into v_platform from public.wallets where is_platform=true and currency=v_plan.currency and bucket='platform_revenue' for update;
    update public.wallets set balance_cents=balance_cents+v_commission,updated_at=now() where id=v_platform.id returning * into v_platform;
    insert into public.wallet_transactions(wallet_id,amount_cents,balance_after_cents,kind,reference_id,description) values(v_platform.id,v_commission,v_platform.balance_cents,'platform_commission',v_order,'Platform commission: '||v_course.title);
  end if;
  insert into public.entitlements(user_id,course_id,source,status,product_id,order_item_id) values(v_user,v_course.id,'purchase','active',v_product.id,v_item);
  insert into public.enrollments(user_id,course_id) values(v_user,v_course.id) on conflict(user_id,course_id) do nothing;
  return jsonb_build_object('order_id',v_order,'charged_cents',v_plan.amount_cents,'instructor_credited_cents',v_net,'commission_cents',v_commission,'currency',v_plan.currency);
end $$;
revoke all on function public.purchase_course_with_wallet(uuid) from public, anon;
grant execute on function public.purchase_course_with_wallet(uuid) to authenticated;

create or replace function public.purchase_subscription_with_wallet(p_plan_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_user uuid := auth.uid(); v_plan public.pricing_plans; v_product public.products; v_course public.courses;
  v_wallet public.wallets; v_platform public.wallets; v_sub uuid; v_order uuid; v_item uuid;
  v_start timestamptz := now(); v_end timestamptz; v_percent numeric := 0; v_commission bigint; v_net bigint;
begin
  if v_user is null then raise exception 'authentication_required'; end if;
  select * into v_plan from public.pricing_plans where id=p_plan_id and active=true for share;
  if not found or v_plan.kind<>'subscription' or v_plan.amount_cents<=0 then raise exception 'plan_not_purchasable'; end if;
  select * into v_product from public.products where id=v_plan.product_id and active=true and type='course';
  if not found then raise exception 'course_unavailable'; end if;
  select * into v_course from public.courses where id=v_product.course_id and status='published';
  if not found then raise exception 'course_unavailable'; end if;
  if v_course.created_by=v_user then raise exception 'cannot_buy_own_course'; end if;
  if exists(select 1 from public.subscriptions s join public.pricing_plans pl on pl.id=s.plan_id where s.user_id=v_user and s.status in ('active','past_due') and pl.product_id=v_product.id) then raise exception 'subscription_already_active'; end if;
  v_end := case when v_plan.billing_interval='year' then v_start + interval '1 year' else v_start + interval '1 month' end;
  insert into public.wallets(user_id,currency,bucket) values(v_user,v_plan.currency,'user') on conflict(user_id,currency) where is_platform=false do nothing;
  select * into v_wallet from public.wallets where user_id=v_user and currency=v_plan.currency and is_platform=false for update;
  if not found or v_wallet.balance_cents<v_plan.amount_cents then raise exception 'insufficient_balance'; end if;
  select coalesce((value #>> '{}')::numeric,0) into v_percent from public.platform_settings where key='commission_percent';
  v_percent := greatest(0,least(100,coalesce(v_percent,0)));
  v_commission := floor(v_plan.amount_cents*v_percent/100)::bigint; v_net:=v_plan.amount_cents-v_commission;
  insert into public.orders(user_id,status,currency,total_cents,provider,paid_at) values(v_user,'paid',v_plan.currency,v_plan.amount_cents,'wallet',now()) returning id into v_order;
  insert into public.order_items(order_id,product_id,plan_id,unit_amount_cents) values(v_order,v_product.id,v_plan.id,v_plan.amount_cents) returning id into v_item;
  insert into public.subscriptions(user_id,plan_id,status,current_period_start,current_period_end,provider) values(v_user,v_plan.id,'active',v_start,v_end,'wallet') returning id into v_sub;
  update public.wallets set balance_cents=balance_cents-v_plan.amount_cents,updated_at=now() where id=v_wallet.id returning * into v_wallet;
  insert into public.wallet_transactions(wallet_id,amount_cents,balance_after_cents,kind,reference_id,description) values(v_wallet.id,-v_plan.amount_cents,v_wallet.balance_cents,'subscription_purchase',v_order,'Subscription purchase: '||v_course.title);
  insert into public.wallets(user_id,currency,bucket) values(v_course.created_by,v_plan.currency,'user') on conflict(user_id,currency) where is_platform=false do nothing;
  select * into v_wallet from public.wallets where user_id=v_course.created_by and currency=v_plan.currency and is_platform=false for update;
  update public.wallets set balance_cents=balance_cents+v_net,updated_at=now() where id=v_wallet.id returning * into v_wallet;
  insert into public.wallet_transactions(wallet_id,amount_cents,balance_after_cents,kind,reference_id,description) values(v_wallet.id,v_net,v_wallet.balance_cents,'course_sale',v_order,'Subscription sale: '||v_course.title);
  insert into public.instructor_earnings(instructor_id,order_item_id,gross_cents,commission_cents,net_cents,status) values(v_course.created_by,v_item,v_plan.amount_cents,v_commission,v_net,'pending');
  if v_commission>0 then
    insert into public.wallets(user_id,is_platform,currency,bucket) values(null,true,v_plan.currency,'platform_revenue') on conflict(bucket,currency) where is_platform=true do nothing;
    select * into v_platform from public.wallets where is_platform=true and currency=v_plan.currency and bucket='platform_revenue' for update;
    update public.wallets set balance_cents=balance_cents+v_commission,updated_at=now() where id=v_platform.id returning * into v_platform;
    insert into public.wallet_transactions(wallet_id,amount_cents,balance_after_cents,kind,reference_id,description) values(v_platform.id,v_commission,v_platform.balance_cents,'platform_commission',v_order,'Platform subscription commission: '||v_course.title);
  end if;
  insert into public.entitlements(user_id,course_id,source,status,product_id,order_item_id,subscription_id,starts_at,expires_at) values(v_user,v_course.id,'subscription','active',v_product.id,v_item,v_sub,v_start,v_end);
  insert into public.enrollments(user_id,course_id) values(v_user,v_course.id) on conflict(user_id,course_id) do nothing;
  return jsonb_build_object('subscription_id',v_sub,'order_id',v_order,'expires_at',v_end,'currency',v_plan.currency);
end $$;
revoke all on function public.purchase_subscription_with_wallet(uuid) from public, anon;
grant execute on function public.purchase_subscription_with_wallet(uuid) to authenticated;

-- Renewal is a server-only scheduled task. A failed charge marks the subscription past_due and does not grant extra access.
create or replace function public.renew_wallet_subscriptions()
returns jsonb language plpgsql security definer set search_path=public as $$
declare s record; p public.pricing_plans; pr public.products; c public.courses; w public.wallets; iw public.wallets; pw public.wallets;
  v_order uuid; v_item uuid; v_commission bigint; v_net bigint; v_percent numeric; v_new_end timestamptz; v_key text; v_renewed int:=0; v_past_due int:=0;
begin
  for s in select * from public.subscriptions where provider='wallet' and status in ('active','past_due') and current_period_end<=now() order by current_period_end for update skip locked limit 100 loop
    if s.cancel_at_period_end then
      update public.subscriptions set status='canceled',canceled_at=coalesce(canceled_at,now()) where id=s.id;
      update public.entitlements set status='expired' where subscription_id=s.id and status='active';
      continue;
    end if;
    select * into p from public.pricing_plans where id=s.plan_id and active=true;
    select * into pr from public.products where id=p.product_id and active=true and type='course';
    select * into c from public.courses where id=pr.course_id;
    if p.id is null or c.id is null then update public.subscriptions set status='expired' where id=s.id; continue; end if;
    insert into public.wallets(user_id,currency,bucket) values(s.user_id,p.currency,'user') on conflict(user_id,currency) where is_platform=false do nothing;
    select * into w from public.wallets where user_id=s.user_id and currency=p.currency and is_platform=false for update;
    if w.id is null or w.balance_cents<p.amount_cents then
      update public.subscriptions set status='past_due' where id=s.id;
      update public.entitlements set status='expired' where subscription_id=s.id and status='active';
      if not exists(select 1 from public.notifications n where n.user_id=s.user_id and n.type='subscription.past_due' and n.created_at>now()-interval '1 day') then
        insert into public.notifications(user_id,type,title,body,link) values(s.user_id,'subscription.past_due','Subscription payment failed','Your course subscription could not be renewed because the wallet balance is insufficient.','/wallet');
      end if;
      v_past_due:=v_past_due+1; continue;
    end if;
    v_key:='wallet-renewal:'||s.id::text||':'||to_char(s.current_period_end at time zone 'UTC','YYYYMMDDHH24MISS');
    select coalesce((value #>> '{}')::numeric,0) into v_percent from public.platform_settings where key='commission_percent';
    v_percent:=greatest(0,least(100,coalesce(v_percent,0)));
    v_commission:=floor(p.amount_cents*v_percent/100)::bigint; v_net:=p.amount_cents-v_commission;
    insert into public.orders(user_id,status,currency,total_cents,provider,paid_at,idempotency_key) values(s.user_id,'paid',p.currency,p.amount_cents,'wallet',now(),v_key) on conflict(idempotency_key) do nothing returning id into v_order;
    if v_order is null then continue; end if;
    insert into public.order_items(order_id,product_id,plan_id,unit_amount_cents) values(v_order,pr.id,p.id,p.amount_cents) returning id into v_item;
    update public.wallets set balance_cents=balance_cents-p.amount_cents,updated_at=now() where id=w.id returning * into w;
    insert into public.wallet_transactions(wallet_id,amount_cents,balance_after_cents,kind,reference_id,description) values(w.id,-p.amount_cents,w.balance_cents,'subscription_renewal',v_order,'Subscription renewal: '||c.title);
    insert into public.wallets(user_id,currency,bucket) values(c.created_by,p.currency,'user') on conflict(user_id,currency) where is_platform=false do nothing;
    select * into iw from public.wallets where user_id=c.created_by and currency=p.currency and is_platform=false for update;
    update public.wallets set balance_cents=balance_cents+v_net,updated_at=now() where id=iw.id returning * into iw;
    insert into public.wallet_transactions(wallet_id,amount_cents,balance_after_cents,kind,reference_id,description) values(iw.id,v_net,iw.balance_cents,'course_sale',v_order,'Subscription renewal sale: '||c.title);
    insert into public.instructor_earnings(instructor_id,order_item_id,gross_cents,commission_cents,net_cents,status) values(c.created_by,v_item,p.amount_cents,v_commission,v_net,'pending');
    if v_commission>0 then
      insert into public.wallets(user_id,is_platform,currency,bucket) values(null,true,p.currency,'platform_revenue') on conflict(bucket,currency) where is_platform=true do nothing;
      select * into pw from public.wallets where is_platform=true and currency=p.currency and bucket='platform_revenue' for update;
      update public.wallets set balance_cents=balance_cents+v_commission,updated_at=now() where id=pw.id returning * into pw;
      insert into public.wallet_transactions(wallet_id,amount_cents,balance_after_cents,kind,reference_id,description) values(pw.id,v_commission,pw.balance_cents,'platform_commission',v_order,'Platform subscription commission: '||c.title);
    end if;
    v_new_end:=case when p.billing_interval='year' then greatest(now(),s.current_period_end)+interval '1 year' else greatest(now(),s.current_period_end)+interval '1 month' end;
    update public.subscriptions set current_period_start=greatest(now(),s.current_period_end),current_period_end=v_new_end,status='active' where id=s.id;
    update public.entitlements set status='active',starts_at=now(),expires_at=v_new_end where subscription_id=s.id;
    v_renewed:=v_renewed+1;
  end loop;
  return jsonb_build_object('renewed',v_renewed,'past_due',v_past_due);
end $$;
revoke all on function public.renew_wallet_subscriptions() from public, anon, authenticated;
grant execute on function public.renew_wallet_subscriptions() to service_role;

-- Refund requests are user-submitted, but only a finance-authorized server action can call the processing RPC.
create or replace function public.process_wallet_refund(p_refund_id uuid, p_actor_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare r public.refunds; o public.orders; oi public.order_items; p public.products; c public.courses;
  student public.wallets; instructor public.wallets; revenue public.wallets; sale_tx public.wallet_transactions; fee_tx public.wallet_transactions;
begin
  select * into r from public.refunds where id=p_refund_id for update;
  if not found or r.status<>'pending' then raise exception 'refund_not_pending'; end if;
  select * into o from public.orders where id=r.order_id for update;
  if o.provider is distinct from 'wallet' then raise exception 'external_provider_refund_required'; end if;
  if o.status<>'paid' or r.amount_cents<>o.total_cents then raise exception 'refund_amount_not_supported'; end if;
  select * into oi from public.order_items where order_id=o.id limit 1;
  if oi.id is null or (select count(*) from public.order_items where order_id=o.id)<>1 then raise exception 'refund_multi_item_order_unsupported'; end if;
  select * into p from public.products where id=oi.product_id;
  select * into c from public.courses where id=p.course_id;
  if c.id is null then raise exception 'refund_course_not_found'; end if;
  select * into student from public.wallets where user_id=o.user_id and currency=o.currency and is_platform=false for update;
  select * into instructor from public.wallets where user_id=c.created_by and currency=o.currency and is_platform=false for update;
  select * into sale_tx from public.wallet_transactions where reference_id=o.id and kind='course_sale' order by created_at desc limit 1;
  select * into fee_tx from public.wallet_transactions where reference_id=o.id and kind='platform_commission' order by created_at desc limit 1;
  if student.id is null or instructor.id is null or sale_tx.id is null then raise exception 'refund_ledger_incomplete'; end if;
  if instructor.balance_cents < sale_tx.amount_cents then raise exception 'seller_balance_insufficient'; end if;
  if fee_tx.id is not null then
    select * into revenue from public.wallets where id=fee_tx.wallet_id for update;
    if revenue.id is null or revenue.balance_cents < fee_tx.amount_cents then raise exception 'platform_balance_insufficient'; end if;
  end if;
  update public.wallets set balance_cents=balance_cents-sale_tx.amount_cents,updated_at=now() where id=instructor.id returning * into instructor;
  insert into public.wallet_transactions(wallet_id,amount_cents,balance_after_cents,kind,reference_id,actor_id,description) values(instructor.id,-sale_tx.amount_cents,instructor.balance_cents,'refund',o.id,p_actor_id,'Refund reversal: instructor share');
  if fee_tx.id is not null then
    update public.wallets set balance_cents=balance_cents-fee_tx.amount_cents,updated_at=now() where id=revenue.id returning * into revenue;
    insert into public.wallet_transactions(wallet_id,amount_cents,balance_after_cents,kind,reference_id,actor_id,description) values(revenue.id,-fee_tx.amount_cents,revenue.balance_cents,'refund',o.id,p_actor_id,'Refund reversal: platform fee');
  end if;
  update public.wallets set balance_cents=balance_cents+r.amount_cents,updated_at=now() where id=student.id returning * into student;
  insert into public.wallet_transactions(wallet_id,amount_cents,balance_after_cents,kind,reference_id,actor_id,description) values(student.id,r.amount_cents,student.balance_cents,'refund',o.id,p_actor_id,'Course refund: '||coalesce(r.reason,''));
  update public.orders set status='refunded' where id=o.id;
  update public.entitlements set status='revoked',revoked_at=now(),revoked_reason='refund',revoked_by=p_actor_id where user_id=o.user_id and course_id=c.id and order_item_id=oi.id and status='active';
  update public.subscriptions set status='canceled',canceled_at=now() where user_id=o.user_id and plan_id=oi.plan_id and status in ('active','past_due');
  update public.instructor_earnings set status='reversed' where order_item_id=oi.id and status in ('pending','available');
  update public.refunds set status='succeeded',reviewed_by=p_actor_id,reviewed_at=now(),failure_reason=null where id=r.id;
  return jsonb_build_object('refund_id',r.id,'order_id',o.id,'amount_cents',r.amount_cents,'currency',o.currency);
end $$;
revoke all on function public.process_wallet_refund(uuid,uuid) from public, anon, authenticated;
grant execute on function public.process_wallet_refund(uuid,uuid) to service_role;

create or replace function public.settle_instructor_earnings(p_cutoff timestamptz, p_actor_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_count int; v_start timestamptz; v_summary jsonb;
begin
  update public.instructor_earnings e set status='available'
  from public.order_items oi join public.orders o on o.id=oi.order_id
  where oi.id=e.order_item_id and e.status='pending' and o.status='paid' and o.paid_at<=p_cutoff;
  get diagnostics v_count = row_count;
  select coalesce(jsonb_agg(jsonb_build_object('currency',q.currency,'gross_cents',q.gross_cents,'commission_cents',q.commission_cents,'net_cents',q.net_cents,'available_earnings_cents',q.available_cents)), '[]'::jsonb)
  into v_summary from (
    select o.currency, sum(e.gross_cents)::bigint gross_cents, sum(e.commission_cents)::bigint commission_cents,
      sum(e.net_cents)::bigint net_cents, coalesce(sum(e.net_cents) filter (where e.status='available'),0)::bigint available_cents
    from public.instructor_earnings e join public.order_items oi on oi.id=e.order_item_id join public.orders o on o.id=oi.order_id
    where o.paid_at<=p_cutoff group by o.currency order by o.currency
  ) q;
  insert into public.financial_reconciliation_runs(period_start,period_end,created_by,summary)
  values(coalesce((select max(period_end) from public.financial_reconciliation_runs),p_cutoff-interval '30 days'),p_cutoff,p_actor_id,
    jsonb_build_object('settled_earnings_rows',v_count,'currencies',v_summary,'ledger_totals',(
      select coalesce(jsonb_agg(jsonb_build_object('currency',z.currency,'net_ledger_cents',z.net_cents,'platform_commission_cents',z.platform_commission_cents,'refunds_cents',z.refunds_cents,'payout_holds_cents',z.payout_holds_cents,'payout_paid_cents',z.payout_paid_cents)), '[]'::jsonb)
      from (select w.currency, sum(t.amount_cents)::bigint net_cents,
        coalesce(sum(t.amount_cents) filter(where t.kind='platform_commission'),0)::bigint platform_commission_cents,
        coalesce(sum(t.amount_cents) filter(where t.kind='refund'),0)::bigint refunds_cents,
        coalesce(sum(t.amount_cents) filter(where t.kind='payout_hold'),0)::bigint payout_holds_cents,
        coalesce(sum(t.amount_cents) filter(where t.kind='payout_paid'),0)::bigint payout_paid_cents
        from public.wallet_transactions t join public.wallets w on w.id=t.wallet_id where t.created_at<=p_cutoff group by w.currency) z
    )) ) returning summary into v_summary;
  return jsonb_build_object('settled_earnings_rows',v_count,'summary',v_summary);
end $$;
revoke all on function public.settle_instructor_earnings(timestamptz,uuid) from public, anon, authenticated;
grant execute on function public.settle_instructor_earnings(timestamptz,uuid) to service_role;

create or replace function public.create_instructor_payout(p_amount_cents bigint, p_currency text, p_method text, p_details jsonb)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_user uuid:=auth.uid(); v_wallet public.wallets; v_clearing public.wallets; v_id uuid; v_remaining bigint; e record; v_alloc bigint;
begin
  if v_user is null or not public.has_role('instructor') or not public.is_active_instructor() then raise exception 'instructor_required'; end if;
  if p_amount_cents<1000 or p_amount_cents>100000000 or p_currency !~ '^[A-Z]{3}$' or p_method not in ('bank_transfer','paypal','wise','other') then raise exception 'invalid_payout'; end if;
  if jsonb_typeof(coalesce(p_details,'{}'::jsonb))<>'object' or length(p_details::text)>2000 then raise exception 'invalid_payout_details'; end if;
  insert into public.wallets(user_id,currency,bucket) values(v_user,p_currency,'user') on conflict(user_id,currency) where is_platform=false do nothing;
  select * into v_wallet from public.wallets where user_id=v_user and currency=p_currency and is_platform=false for update;
  if v_wallet.id is null or v_wallet.balance_cents<p_amount_cents then raise exception 'insufficient_balance'; end if;
  -- Only settled earnings may fund a payout. Existing reservations count against the earnings to prevent duplicate allocation.
  v_remaining:=p_amount_cents;
  for e in select ie.id, ie.net_cents - coalesce((select sum(a.amount_cents) from public.payout_request_allocations a join public.payout_requests r on r.id=a.payout_request_id where a.earning_id=ie.id and r.status in ('pending','approved','paid')),0) remaining
    from public.instructor_earnings ie join public.order_items oi on oi.id=ie.order_item_id join public.orders o on o.id=oi.order_id
    where ie.instructor_id=v_user and ie.status='available' and o.currency=p_currency
    order by ie.created_at,ie.id for update of ie loop
    exit when v_remaining<=0;
    v_alloc:=least(v_remaining,greatest(0,e.remaining));
    if v_alloc>0 then v_remaining:=v_remaining-v_alloc; end if;
  end loop;
  if v_remaining>0 then raise exception 'insufficient_settled_earnings'; end if;
  insert into public.payout_requests(instructor_id,amount_cents,currency,payout_method,payout_details) values(v_user,p_amount_cents,p_currency,p_method,p_details) returning id into v_id;
  v_remaining:=p_amount_cents;
  for e in select ie.id, ie.net_cents - coalesce((select sum(a.amount_cents) from public.payout_request_allocations a join public.payout_requests r on r.id=a.payout_request_id where a.earning_id=ie.id and r.status in ('pending','approved','paid')),0) remaining
    from public.instructor_earnings ie join public.order_items oi on oi.id=ie.order_item_id join public.orders o on o.id=oi.order_id
    where ie.instructor_id=v_user and ie.status='available' and o.currency=p_currency
    order by ie.created_at,ie.id for update of ie loop
    exit when v_remaining<=0;
    v_alloc:=least(v_remaining,greatest(0,e.remaining));
    if v_alloc>0 then insert into public.payout_request_allocations(payout_request_id,earning_id,amount_cents) values(v_id,e.id,v_alloc); v_remaining:=v_remaining-v_alloc; end if;
  end loop;
  insert into public.wallets(user_id,is_platform,currency,bucket) values(null,true,p_currency,'payout_clearing') on conflict(bucket,currency) where is_platform=true do nothing;
  select * into v_clearing from public.wallets where is_platform=true and currency=p_currency and bucket='payout_clearing' for update;
  update public.wallets set balance_cents=balance_cents-p_amount_cents,updated_at=now() where id=v_wallet.id returning * into v_wallet;
  update public.wallets set balance_cents=balance_cents+p_amount_cents,updated_at=now() where id=v_clearing.id returning * into v_clearing;
  insert into public.wallet_transactions(wallet_id,amount_cents,balance_after_cents,kind,reference_id,description) values(v_wallet.id,-p_amount_cents,v_wallet.balance_cents,'payout_hold',v_id,'Instructor payout reserved');
  insert into public.wallet_transactions(wallet_id,amount_cents,balance_after_cents,kind,reference_id,description) values(v_clearing.id,p_amount_cents,v_clearing.balance_cents,'payout_hold',v_id,'Instructor payout clearing reserve');
  return v_id;
end $$;
revoke all on function public.create_instructor_payout(bigint,text,text,jsonb) from public, anon;
grant execute on function public.create_instructor_payout(bigint,text,text,jsonb) to authenticated;

create or replace function public.review_payout_request(p_payout_id uuid,p_decision text,p_actor_id uuid,p_note text default null,p_transfer_reference text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare r public.payout_requests; user_wallet public.wallets; clearing public.wallets;
begin
  select * into r from public.payout_requests where id=p_payout_id for update;
  if not found then raise exception 'payout_not_found'; end if;
  if p_decision='approve' then
    if r.status<>'pending' then raise exception 'payout_not_pending'; end if;
    update public.payout_requests set status='approved',reviewed_by=p_actor_id,reviewed_at=now(),admin_note=left(coalesce(p_note,''),1000) where id=r.id;
  elsif p_decision='reject' then
    if r.status not in ('pending','approved') then raise exception 'payout_not_rejectable'; end if;
    select * into user_wallet from public.wallets where user_id=r.instructor_id and currency=r.currency and is_platform=false for update;
    select * into clearing from public.wallets where is_platform=true and currency=r.currency and bucket='payout_clearing' for update;
    if clearing.id is null or clearing.balance_cents<r.amount_cents then raise exception 'payout_clearing_inconsistent'; end if;
    update public.wallets set balance_cents=balance_cents+r.amount_cents,updated_at=now() where id=user_wallet.id returning * into user_wallet;
    update public.wallets set balance_cents=balance_cents-r.amount_cents,updated_at=now() where id=clearing.id returning * into clearing;
    insert into public.wallet_transactions(wallet_id,amount_cents,balance_after_cents,kind,reference_id,actor_id,description) values(user_wallet.id,r.amount_cents,user_wallet.balance_cents,'payout_release',r.id,p_actor_id,'Rejected payout released');
    insert into public.wallet_transactions(wallet_id,amount_cents,balance_after_cents,kind,reference_id,actor_id,description) values(clearing.id,-r.amount_cents,clearing.balance_cents,'payout_release',r.id,p_actor_id,'Rejected payout reserve released');
    update public.payout_requests set status='rejected',reviewed_by=p_actor_id,reviewed_at=now(),admin_note=left(coalesce(p_note,''),1000) where id=r.id;
  elsif p_decision='paid' then
    if r.status<>'approved' then raise exception 'payout_not_approved'; end if;
    if length(coalesce(p_transfer_reference,''))<3 then raise exception 'transfer_reference_required'; end if;
    select * into clearing from public.wallets where is_platform=true and currency=r.currency and bucket='payout_clearing' for update;
    if clearing.id is null or clearing.balance_cents<r.amount_cents then raise exception 'payout_clearing_inconsistent'; end if;
    update public.wallets set balance_cents=balance_cents-r.amount_cents,updated_at=now() where id=clearing.id returning * into clearing;
    insert into public.wallet_transactions(wallet_id,amount_cents,balance_after_cents,kind,reference_id,actor_id,description) values(clearing.id,-r.amount_cents,clearing.balance_cents,'payout_paid',r.id,p_actor_id,'Payout marked as externally transferred');
    update public.payout_requests set status='paid',reviewed_by=p_actor_id,reviewed_at=now(),paid_at=now(),transfer_reference=left(p_transfer_reference,200),admin_note=left(coalesce(p_note,''),1000) where id=r.id;
    update public.instructor_earnings e set status='paid' from public.payout_request_allocations a where a.payout_request_id=r.id and e.id=a.earning_id and not exists (
      select 1 from public.payout_request_allocations a2 join public.payout_requests r2 on r2.id=a2.payout_request_id where a2.earning_id=e.id and r2.status in ('pending','approved') and r2.id<>r.id
    ) and (select coalesce(sum(a3.amount_cents),0) from public.payout_request_allocations a3 join public.payout_requests r3 on r3.id=a3.payout_request_id where a3.earning_id=e.id and r3.status='paid') >= e.net_cents;
  else raise exception 'invalid_payout_decision';
  end if;
  return jsonb_build_object('payout_id',r.id,'decision',p_decision);
end $$;
revoke all on function public.review_payout_request(uuid,text,uuid,text,text) from public, anon, authenticated;
grant execute on function public.review_payout_request(uuid,text,uuid,text,text) to service_role;
