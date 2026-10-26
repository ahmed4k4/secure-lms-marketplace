-- Super Admin-controlled video protection, resilient transcoding jobs, and refund/payout safety.
insert into public.platform_settings(key,value) values
  ('watermark_enforced','true'::jsonb),
  ('capture_deterrence_enabled','true'::jsonb),
  ('hls_max_height','1080'::jsonb)
on conflict(key) do nothing;

alter table public.video_transcode_jobs
  add column if not exists heartbeat_at timestamptz;

create or replace function public.claim_video_transcode_job()
returns setof public.video_transcode_jobs
language plpgsql security definer set search_path=public as $$
declare
begin
  -- A worker may disappear without reporting a failure. Jobs with no heartbeat for 3 minutes
  -- are retried; the worker refreshes this timestamp every 30 seconds while FFmpeg runs.
  update public.video_transcode_jobs
    set status = case when attempts >= 3 then 'failed' else 'queued' end,
        started_at = case when attempts >= 3 then started_at else null end,
        heartbeat_at = null,
        finished_at = case when attempts >= 3 then now() else null end,
        last_error = 'Worker heartbeat expired; recovered by queue supervisor.'
    where status = 'processing'
      and coalesce(heartbeat_at, started_at, created_at) < now() - interval '3 minutes';

  update public.lesson_videos lv
    set processing_status = 'failed',
        processing_error = left(j.last_error, 3000),
        last_processed_at = now()
    from public.video_transcode_jobs j
    where j.lesson_id = lv.lesson_id and j.source_key = lv.object_key
      and j.status = 'failed'
      and j.last_error = 'Worker heartbeat expired; recovered by queue supervisor.'
      and lv.processing_status <> 'ready';

  return query
    with next_job as (
      select id from public.video_transcode_jobs
      where status = 'queued' and attempts < 3
      order by created_at
      for update skip locked
      limit 1
    )
    update public.video_transcode_jobs j
      set status = 'processing', attempts = attempts + 1,
          started_at = now(), heartbeat_at = now(), last_error = null
    from next_job n where j.id = n.id
    returning j.*;
end $$;
revoke all on function public.claim_video_transcode_job() from public, anon, authenticated;
grant execute on function public.claim_video_transcode_job() to service_role;

-- Refunding a wallet purchase must not race with an already reserved/paid instructor payout.
create or replace function public.process_wallet_refund(p_refund_id uuid, p_actor_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare r public.refunds; o public.orders; oi public.order_items; p public.products; c public.courses;
  student public.wallets; instructor public.wallets; revenue public.wallets; sale_tx public.wallet_transactions; fee_tx public.wallet_transactions;
  sub_id uuid;
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
  if exists(select 1 from public.instructor_earnings e join public.payout_request_allocations a on a.earning_id=e.id join public.payout_requests pr on pr.id=a.payout_request_id where e.order_item_id=oi.id and pr.status in ('pending','approved','paid')) then
    raise exception 'refund_payout_allocated_requires_manual_review';
  end if;
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
  select id into sub_id from public.subscriptions where user_id=o.user_id and plan_id=oi.plan_id and provider='wallet' and status in ('active','past_due') order by current_period_end desc limit 1 for update;
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
  if sub_id is not null then
    update public.subscriptions set status='canceled',cancel_at_period_end=false,canceled_at=now() where id=sub_id;
    update public.entitlements set status='revoked',revoked_at=now(),revoked_reason='refund',revoked_by=p_actor_id where subscription_id=sub_id and status='active';
  end if;
  update public.instructor_earnings set status='reversed' where order_item_id=oi.id and status in ('pending','available');
  update public.refunds set status='succeeded',reviewed_by=p_actor_id,reviewed_at=now(),failure_reason=null where id=r.id;
  return jsonb_build_object('refund_id',r.id,'order_id',o.id,'amount_cents',r.amount_cents,'currency',o.currency);
end $$;
revoke all on function public.process_wallet_refund(uuid,uuid) from public, anon, authenticated;
grant execute on function public.process_wallet_refund(uuid,uuid) to service_role;

-- Record a completed refund from an external payment provider as one atomic state transition.
-- The operator must execute the refund in the actual provider dashboard/API before calling this RPC.
create or replace function public.record_external_refund(p_refund_id uuid, p_actor_id uuid, p_provider_refund_id text, p_note text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare r public.refunds; o public.orders; oi public.order_items; pr public.products; sub_id uuid;
begin
  if length(coalesce(p_provider_refund_id,'')) < 3 or length(p_provider_refund_id) > 200 then raise exception 'provider_refund_reference_required'; end if;
  select * into r from public.refunds where id=p_refund_id for update;
  if not found or r.status <> 'pending' then raise exception 'refund_not_pending'; end if;
  select * into o from public.orders where id=r.order_id for update;
  if not found or o.provider='wallet' then raise exception 'external_provider_refund_required'; end if;
  if o.status <> 'paid' or r.amount_cents <> o.total_cents then raise exception 'refund_amount_not_supported'; end if;
  select * into oi from public.order_items where order_id=o.id limit 1;
  if oi.id is null or (select count(*) from public.order_items where order_id=o.id) <> 1 then raise exception 'refund_multi_item_order_unsupported'; end if;
  select * into pr from public.products where id=oi.product_id;
  if pr.course_id is null then raise exception 'refund_course_not_found'; end if;
  if exists(select 1 from public.instructor_earnings e join public.payout_request_allocations a on a.earning_id=e.id join public.payout_requests payout on payout.id=a.payout_request_id where e.order_item_id=oi.id and payout.status in ('pending','approved','paid')) then
    raise exception 'refund_payout_allocated_requires_manual_review';
  end if;
  update public.orders set status='refunded' where id=o.id;
  update public.entitlements set status='revoked',revoked_at=now(),revoked_reason='refund',revoked_by=p_actor_id
    where user_id=o.user_id and course_id=pr.course_id and order_item_id=oi.id and status='active';
  if oi.plan_id is not null then
    with canceled as (
      update public.subscriptions set status='canceled',cancel_at_period_end=false,canceled_at=now()
      where user_id=o.user_id and plan_id=oi.plan_id and status in ('active','past_due') returning id
    )
    update public.entitlements set status='revoked',revoked_at=now(),revoked_reason='refund',revoked_by=p_actor_id
      where subscription_id in (select id from canceled) and status='active';
  end if;
  update public.instructor_earnings set status='reversed' where order_item_id=oi.id and status in ('pending','available');
  update public.refunds set status='succeeded',provider_refund_id=left(p_provider_refund_id,200),reviewed_by=p_actor_id,
      reviewed_at=now(),failure_reason=left(coalesce(p_note,''),500)
    where id=r.id;
  return jsonb_build_object('refund_id',r.id,'order_id',o.id,'provider_refund_id',p_provider_refund_id,'amount_cents',r.amount_cents,'currency',o.currency);
end $$;
revoke all on function public.record_external_refund(uuid,uuid,text,text) from public, anon, authenticated;
grant execute on function public.record_external_refund(uuid,uuid,text,text) to service_role;
