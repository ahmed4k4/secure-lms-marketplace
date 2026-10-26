-- Instructor category proposals, category-gated course submission, and uploaded public covers.
begin;

create table if not exists public.category_requests (
  id uuid primary key default gen_random_uuid(),
  slug text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name_en text not null check (char_length(trim(name_en)) between 2 and 120),
  name_ar text not null check (char_length(trim(name_ar)) between 2 and 120),
  requested_by uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  category_id uuid references public.categories(id) on delete set null,
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  rejection_reason text check (rejection_reason is null or char_length(rejection_reason) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists category_requests_one_pending_per_slug
  on public.category_requests(slug) where status = 'pending';
create index if not exists category_requests_status_created_idx
  on public.category_requests(status, created_at desc);
create index if not exists category_requests_requester_idx
  on public.category_requests(requested_by, created_at desc);

alter table public.courses
  add column if not exists category_request_id uuid references public.category_requests(id) on delete set null,
  add column if not exists cover_url text check (cover_url is null or (char_length(cover_url) <= 2048 and cover_url ~* '^https://'));
create index if not exists courses_category_request_idx on public.courses(category_request_id) where category_request_id is not null;

grant insert (category_request_id, cover_url) on public.courses to authenticated;
grant update (category_request_id, cover_url) on public.courses to authenticated;

alter table public.category_requests enable row level security;
revoke all on public.category_requests from anon, authenticated;
grant select, insert on public.category_requests to authenticated;
grant select, insert, update on public.category_requests to service_role;
create policy category_requests_read_own_or_admin on public.category_requests
  for select to authenticated
  using (requested_by = auth.uid() or public.has_permission('categories.manage'));
create policy category_requests_insert_own_pending on public.category_requests
  for insert to authenticated
  with check (
    requested_by = auth.uid()
    and status = 'pending'
    and category_id is null
    and reviewed_by is null
    and reviewed_at is null
    and public.is_active_instructor()
  );

-- Course status gate. Authors can prepare courses while a category proposal is pending,
-- but the course is not publishable until the administrator approves that proposal.
create or replace function public.enforce_course_status() returns trigger
language plpgsql set search_path = public as $$
declare
  v_request_status text;
  v_request_category uuid;
begin
  if auth.uid() is null then return new; end if; -- trusted server context; RLS and server authorization still apply
  if public.has_permission('courses.review') then
    if new.status = 'published' and old.status <> 'published' then
      new.published_at := coalesce(old.published_at, now());
    end if;
    return new;
  end if;

  new.created_by := old.created_by;
  new.rejection_reason := old.rejection_reason;
  new.published_at := old.published_at;

  if new.status <> old.status then
    -- Submit or re-submit to the category hold state only when the linked proposal is pending.
    if new.status = 'category_pending' and new.category_request_id is not null
       and exists (select 1 from public.category_requests r where r.id = new.category_request_id and r.status = 'pending') then
      return new;
    end if;

    -- The category-review RPC is the only path that can approve the request; when the old
    -- request becomes approved, its exact category can move a held course into course review.
    if old.status = 'category_pending' and new.status = 'in_review' then
      select r.status, r.category_id into v_request_status, v_request_category
      from public.category_requests r where r.id = old.category_request_id;
      if v_request_status = 'approved' and v_request_category = new.category_id then return new; end if;
    end if;

    -- When a proposal is rejected, return held courses to draft so the instructor can choose
    -- an existing category or propose a different one; the course cannot be published via this path.
    if old.status = 'category_pending' and new.status = 'draft' then
      select r.status into v_request_status from public.category_requests r where r.id = old.category_request_id;
      if v_request_status = 'rejected' then return new; end if;
    end if;

    if old.status in ('draft','rejected') and new.status = 'in_review'
       and (new.category_request_id is null or exists (
         select 1 from public.category_requests r where r.id = new.category_request_id and r.status = 'approved'
       )) then
      return new;
    end if;
    if old.status = 'in_review' and new.status = 'draft' then return new; end if;
    raise exception 'invalid_status_transition' using errcode = '42501';
  end if;
  return new;
end $$;

create or replace function public.prevent_course_publish_with_pending_category() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'published' and new.category_request_id is not null and exists (
    select 1 from public.category_requests r
    where r.id = new.category_request_id and r.status <> 'approved'
  ) then
    raise exception 'course_category_approval_pending' using errcode = '23514';
  end if;
  return new;
end $$;
drop trigger if exists courses_category_approval_guard on public.courses;
create trigger courses_category_approval_guard before insert or update of status, category_request_id
  on public.courses for each row execute function public.prevent_course_publish_with_pending_category();

-- A single privileged RPC keeps category creation, request status, and held-course transitions atomic.
create or replace function public.review_category_request(p_request_id uuid, p_decision text, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_request public.category_requests%rowtype;
  v_category_id uuid;
  v_courses integer := 0;
begin
  if not public.has_permission('categories.manage') then
    raise exception 'permission_denied' using errcode = '42501';
  end if;
  if p_decision is null or p_decision not in ('approve','reject') then
    raise exception 'invalid_decision' using errcode = '22023';
  end if;
  select * into v_request from public.category_requests where id = p_request_id for update;
  if not found then raise exception 'category_request_not_found' using errcode = 'P0002'; end if;
  if v_request.status <> 'pending' then raise exception 'category_request_already_reviewed' using errcode = '55000'; end if;

  if p_decision = 'approve' then
    insert into public.categories(slug, name_en, name_ar)
    values (v_request.slug, v_request.name_en, v_request.name_ar)
    on conflict (slug) do nothing;
    select id into v_category_id from public.categories where slug = v_request.slug;
    update public.category_requests set status = 'approved', category_id = v_category_id,
      reviewed_by = auth.uid(), reviewed_at = now(), rejection_reason = null, updated_at = now()
      where id = p_request_id;
    update public.courses set category_id = v_category_id, category_request_id = null,
      status = case when status = 'category_pending' then 'in_review'::public.course_status else status end
      where category_request_id = p_request_id;
    get diagnostics v_courses = row_count;
    return jsonb_build_object('status','approved','category_id',v_category_id,'updated_courses',v_courses);
  else
    update public.category_requests set status = 'rejected', reviewed_by = auth.uid(), reviewed_at = now(),
      rejection_reason = nullif(left(trim(coalesce(p_reason,'')),500),''), updated_at = now()
      where id = p_request_id;
    update public.courses set category_id = null, category_request_id = null,
      status = case when status in ('category_pending','in_review') then 'draft'::public.course_status else status end
      where category_request_id = p_request_id and status <> 'published';
    get diagnostics v_courses = row_count;
    return jsonb_build_object('status','rejected','updated_courses',v_courses);
  end if;
end $$;
revoke all on function public.review_category_request(uuid, text, text) from public, anon, authenticated;
grant execute on function public.review_category_request(uuid, text, text) to authenticated, service_role;

-- Rebuild the public catalogue with cover_url appended, preserving all existing columns.
drop view if exists public.course_catalog;
create view public.course_catalog as
  select c.id, c.slug, c.title, c.subtitle, c.language, c.level, c.access_type, c.status, c.published_at, c.updated_at,
         c.category_id, cat.slug as category_slug, cat.name_en as category_name_en, cat.name_ar as category_name_ar,
         c.created_by as owner_id, pi.full_name as owner_name,
         pp.amount_cents as price_cents, pp.currency,
         coalesce(r.avg_rating, 0) as rating_avg, coalesce(r.cnt, 0) as rating_count,
         coalesce(l.cnt, 0) as lesson_count, coalesce(l.total_seconds, 0) as total_duration_seconds,
         coalesce(e.cnt, 0) as student_count, c.cover_url as cover_url
  from public.courses c
  left join public.categories cat on cat.id = c.category_id
  left join public.public_instructors pi on pi.id = c.created_by
  left join lateral (
    select pl.amount_cents, pl.currency from public.products pr join public.pricing_plans pl on pl.product_id = pr.id
    where pr.course_id = c.id and pr.type = 'course' and pl.active and pl.kind = 'one_time'
    order by pl.created_at desc limit 1
  ) pp on true
  left join lateral (
    select round(avg(rating)::numeric, 2) as avg_rating, count(*) as cnt
    from public.reviews where course_id = c.id and not is_hidden
  ) r on true
  left join lateral (
    select count(*) as cnt, coalesce(sum(duration_seconds), 0)::int as total_seconds
    from public.lessons where course_id = c.id
  ) l on true
  left join lateral (select count(*) as cnt from public.enrollments where course_id = c.id) e on true
  where c.status = 'published';
grant select on public.course_catalog to anon, authenticated;

comment on table public.category_requests is 'Instructor-submitted categories hidden from the public catalogue until an authorized administrator approves them.';
comment on column public.courses.cover_url is 'Public URL for a cover stored in a dedicated public R2 bucket; never used for lesson media.';
commit;
