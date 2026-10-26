-- Restore the documented Cloudflare Stream workflow for video lessons.
-- R2 remains available for lesson resources and private attachments, not video delivery.
begin;

alter table public.lessons add column if not exists stream_uid text;
alter table public.lessons add column if not exists processing_status text not null default 'pending';
alter table public.lessons add column if not exists duration_seconds integer;
alter table public.stream_uploads add column if not exists processing_status text not null default 'pending';
alter table public.stream_uploads add column if not exists expected_size_bytes bigint;
alter table public.stream_uploads add column if not exists claimed_lesson_id uuid unique references public.lessons(id) on delete set null;

do $$ begin
  if not exists (select 1 from pg_constraint where conrelid='public.lessons'::regclass and conname='lessons_stream_duration_nonnegative') then
    alter table public.lessons add constraint lessons_stream_duration_nonnegative check (duration_seconds is null or duration_seconds >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conrelid='public.stream_uploads'::regclass and conname='stream_uploads_expected_size_positive') then
    alter table public.stream_uploads add constraint stream_uploads_expected_size_positive check (expected_size_bytes is null or expected_size_bytes > 0);
  end if;
end $$;

create index if not exists lessons_stream_uid_idx on public.lessons(stream_uid) where stream_uid is not null;
create index if not exists stream_uploads_owner_expiry_idx on public.stream_uploads(uploader_id, expires_at desc);
create index if not exists pricing_plans_active_product_idx on public.pricing_plans(product_id, amount_minor) where is_active = true;
create index if not exists products_course_lookup_idx on public.products(course_id, kind) where course_id is not null;

create or replace function public.guard_lesson_stream_state()
returns trigger language plpgsql security definer set search_path = public
as $$
declare _upload_state text;
begin
  if coalesce(auth.role(), '') = 'service_role' or public.is_super_admin() then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.kind = 'video' then
      if new.stream_uid is null or new.r2_object_key is not null or new.r2_size_bytes is not null then
        raise exception 'video_requires_cloudflare_stream_upload' using errcode = '42501';
      end if;
      select su.processing_status into _upload_state
        from public.stream_uploads su
       where su.stream_uid = new.stream_uid
         and su.uploader_id = auth.uid()
         and su.claimed_lesson_id is null
         and su.expires_at > now();
      if not found then
        raise exception 'stream_upload_not_owned_or_expired' using errcode = '42501';
      end if;
      new.processing_status := _upload_state;
      new.is_published := false;
    else
      if new.stream_uid is not null or new.r2_object_key is not null or new.r2_size_bytes is not null then
        raise exception 'non_video_lesson_cannot_have_video_media' using errcode = '42501';
      end if;
      new.processing_status := 'pending';
      new.is_published := false;
    end if;
  else
    -- Media UID/readiness/publication are server-controlled and immutable from user sessions.
    new.stream_uid := old.stream_uid;
    new.r2_object_key := old.r2_object_key;
    new.r2_size_bytes := old.r2_size_bytes;
    new.processing_status := old.processing_status;
    new.is_published := old.is_published;
  end if;
  return new;
end $$;

drop trigger if exists guard_lesson_stream_state on public.lessons;
create trigger guard_lesson_stream_state before insert or update on public.lessons
for each row execute procedure public.guard_lesson_stream_state();

-- Browser sessions may create a lesson only by referencing a valid, unclaimed Stream upload.
revoke insert, update on public.lessons from anon, authenticated;
grant insert(section_id, title_en, title_ar, kind, body_en, body_ar, stream_uid, is_preview, sort_order) on public.lessons to authenticated;
grant update(title_en, title_ar, body_en, body_ar, is_preview, sort_order) on public.lessons to authenticated;

-- Upload session metadata and processing state are managed exclusively by trusted server routes.
revoke insert, update, delete on public.stream_uploads from public, anon, authenticated;
drop policy if exists "stream uploads uploader read" on public.stream_uploads;
create policy "stream uploads uploader read" on public.stream_uploads for select to authenticated using (uploader_id = auth.uid() or public.is_super_admin());
grant select on public.stream_uploads to authenticated;

-- Explicitly ensure browser roles cannot alter paid-access records or forge orders/entitlements.
revoke insert, update, delete on public.orders, public.order_items, public.subscriptions,
  public.entitlements, public.payment_events, public.refunds, public.instructor_earnings from public, anon, authenticated;

-- Public catalog reads must never reveal pricing for unpublished course drafts.
drop policy if exists "products active read" on public.products;
create policy "products active read" on public.products for select using (
  public.is_super_admin()
  or owner_id = auth.uid()
  or (is_active and (kind <> 'course' or exists (
    select 1 from public.courses c where c.id = course_id and c.status = 'published'
  )))
);
drop policy if exists "plans active read" on public.pricing_plans;
create policy "plans active read" on public.pricing_plans for select using (
  public.is_super_admin()
  or exists (
    select 1 from public.products p
    left join public.courses c on c.id = p.course_id
    where p.id = product_id and (
      p.owner_id = auth.uid()
      or (pricing_plans.is_active and p.is_active and (p.kind <> 'course' or c.status = 'published'))
    )
  )
);
drop policy if exists "plan items read active" on public.plan_items;
create policy "plan items read active" on public.plan_items for select using (
  public.is_super_admin()
  or exists (
    select 1 from public.pricing_plans pp
    join public.products bundle on bundle.id = pp.product_id
    join public.products item on item.id = plan_items.product_id
    left join public.courses course on course.id = bundle.course_id
    where pp.id = plan_id and (
      bundle.owner_id = auth.uid() or item.owner_id = auth.uid()
      or (pp.is_active and bundle.is_active and (bundle.kind <> 'course' or course.status = 'published'))
    )
  )
);
-- Free enrollment is valid only for an active, published, zero-price lifetime plan.
create or replace function public.enroll_free_course(_course_id uuid)
returns uuid language plpgsql security definer set search_path = public
as $$
declare _uid uuid := auth.uid(); _product_id uuid; _entitlement_id uuid;
begin
  if _uid is null then raise exception 'authentication_required' using errcode='28000'; end if;
  if not exists(select 1 from public.profiles where id=_uid and status='active') then raise exception 'account_inactive' using errcode='42501'; end if;
  if not exists(select 1 from public.courses where id=_course_id and status='published') then raise exception 'course_unavailable' using errcode='P0002'; end if;
  select p.id into _product_id from public.products p join public.pricing_plans pp on pp.product_id=p.id
    where p.course_id=_course_id and p.kind='course' and p.is_active and pp.is_active
      and pp.amount_minor=0 and pp.billing_period='one_time'
      and pp.access_duration='lifetime' and pp.access_days is null and pp.trial_days=0
    limit 1;
  if _product_id is null then raise exception 'free_lifetime_plan_not_found' using errcode='P0002'; end if;
  if exists(select 1 from public.enrollments where user_id=_uid and course_id=_course_id) then
    return (select id from public.enrollments where user_id=_uid and course_id=_course_id);
  end if;
  insert into public.entitlements(user_id,product_id,source,grant_reason) values (_uid,_product_id,'free_enrollment','Free lifetime course enrollment') returning id into _entitlement_id;
  insert into public.enrollments(user_id,course_id,entitlement_id) values (_uid,_course_id,_entitlement_id) returning id into _entitlement_id;
  return _entitlement_id;
end $$;
revoke all on function public.enroll_free_course(uuid) from public, anon;
grant execute on function public.enroll_free_course(uuid) to authenticated;

-- All commercial metadata writes go through validated server routes, never direct browser table writes.
revoke insert, update, delete on public.products, public.pricing_plans, public.plan_items from public, anon, authenticated;
grant select on public.products, public.pricing_plans, public.plan_items to anon, authenticated;

insert into public.permissions(key, name_en, name_ar, description)
values ('courses.manage_pricing', 'Manage course pricing', 'إدارة أسعار الكورسات', 'Manage pricing plans for courses not owned by the administrator.')
on conflict (key) do update set name_en=excluded.name_en, name_ar=excluded.name_ar, description=excluded.description;
commit;
