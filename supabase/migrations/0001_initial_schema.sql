-- Secure LMS Marketplace: initial PostgreSQL schema
create extension if not exists pgcrypto;
do $$ begin
  create type public.account_status as enum ('active','suspended','pending');
exception when duplicate_object then null;
end $$;
do $$ begin
  create type public.app_role as enum ('super_admin','admin','instructor','student');
exception when duplicate_object then null;
end $$;
do $$ begin
  create type public.course_status as enum ('draft','in_review','published','archived');
exception when duplicate_object then null;
end $$;
do $$ begin
  create type public.lesson_kind as enum ('video','text','file','live');
exception when duplicate_object then null;
end $$;
do $$ begin
  create type public.access_duration as enum ('lifetime','fixed_days','subscription_period');
exception when duplicate_object then null;
end $$;
do $$ begin
  create type public.product_kind as enum ('course','instructor_membership','platform_membership','bundle');
exception when duplicate_object then null;
end $$;
do $$ begin
  create type public.plan_billing_period as enum ('one_time','monthly','quarterly','yearly');
exception when duplicate_object then null;
end $$;
do $$ begin
  create type public.order_status as enum ('pending','paid','failed','cancelled','refunded','partially_refunded');
exception when duplicate_object then null;
end $$;
do $$ begin
  create type public.entitlement_source as enum ('purchase','subscription','admin_grant','free_enrollment','bundle');
exception when duplicate_object then null;
end $$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '', avatar_url text,
  status public.account_status not null default 'active',
  preferred_locale text not null default 'ar' check (preferred_locale in ('ar','en')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
-- A previous attempt may have created public.profiles before failing. Add missing non-key columns safely.
alter table public.profiles add column if not exists display_name text not null default '';
alter table public.profiles add column if not exists avatar_url text;
alter table public.profiles add column if not exists status public.account_status not null default 'active';
alter table public.profiles add column if not exists preferred_locale text not null default 'ar';
alter table public.profiles add column if not exists created_at timestamptz not null default now();
alter table public.profiles add column if not exists updated_at timestamptz not null default now();
do $$ begin
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='profiles' and column_name='id') then
    raise exception 'Existing public.profiles table is incompatible: missing required id column. Back up and reconcile this table before applying the LMS migration.';
  end if;
  if not exists (select 1 from pg_constraint where conrelid='public.profiles'::regclass and conname='profiles_preferred_locale_check') then
    alter table public.profiles add constraint profiles_preferred_locale_check check (preferred_locale in ('ar','en'));
  end if;
end $$;
create table if not exists public.user_roles (
  user_id uuid not null references public.profiles(id) on delete cascade,
  role public.app_role not null,
  created_at timestamptz not null default now(), primary key(user_id, role)
);

-- New Auth accounts receive a profile and the least-privileged student role. Elevated roles are assigned privately by trusted operators.
create or replace function public.handle_new_auth_user()
returns trigger language plpgsql security definer set search_path = public
as $$ begin
  insert into public.profiles(id, display_name) values (new.id, coalesce(new.raw_user_meta_data->>'display_name','')) on conflict (id) do nothing;
  insert into public.user_roles(user_id, role) values (new.id, 'student') on conflict (user_id, role) do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute procedure public.handle_new_auth_user();

create table if not exists public.instructor_profiles (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  slug text not null unique, headline text, bio text, website_url text,
  is_approved boolean not null default false, created_at timestamptz not null default now()
);
create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(), slug text not null unique,
  name_en text not null, name_ar text not null, sort_order integer not null default 0,
  created_at timestamptz not null default now()
);
create table if not exists public.courses (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references public.profiles(id),
  slug text not null unique, title_en text not null, title_ar text not null,
  summary_en text not null default '', summary_ar text not null default '',
  description_en text not null default '', description_ar text not null default '',
  thumbnail_url text, level text not null default 'all_levels', language text not null default 'ar',
  category_id uuid references public.categories(id) on delete set null,
  status public.course_status not null default 'draft', is_featured boolean not null default false,
  published_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint course_language_check check (language in ('ar','en','both'))
);
create or replace function public.enforce_course_publication_review()
returns trigger language plpgsql security definer set search_path = public
as $$ begin
  if new.status='published' and (tg_op='INSERT' or old.status is distinct from 'published') and coalesce(auth.role(),'') <> 'service_role' and not public.is_admin(auth.uid()) then
    raise exception 'course_requires_admin_publication' using errcode='42501';
  end if;
  return new;
end $$;
drop trigger if exists courses_require_review on public.courses;
create trigger courses_require_review before insert or update of status on public.courses
for each row execute procedure public.enforce_course_publication_review();

create table if not exists public.course_instructors (
  course_id uuid not null references public.courses(id) on delete cascade,
  instructor_id uuid not null references public.profiles(id) on delete cascade,
  is_primary boolean not null default false, primary key(course_id,instructor_id)
);
create table if not exists public.sections (
  id uuid primary key default gen_random_uuid(), course_id uuid not null references public.courses(id) on delete cascade,
  title_en text not null, title_ar text not null, sort_order integer not null default 0,
  created_at timestamptz not null default now()
);
create table if not exists public.lessons (
  id uuid primary key default gen_random_uuid(), section_id uuid not null references public.sections(id) on delete cascade,
  title_en text not null, title_ar text not null, kind public.lesson_kind not null default 'video',
  body_en text, body_ar text, stream_uid text, processing_status text not null default 'pending' check (processing_status in ('pending','ready','error')), duration_seconds integer,
  is_preview boolean not null default false, is_published boolean not null default false,
  sort_order integer not null default 0, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.stream_uploads (
  stream_uid text primary key, uploader_id uuid not null references public.profiles(id) on delete cascade,
  processing_status text not null default 'pending' check (processing_status in ('pending','ready','error')),
  created_at timestamptz not null default now(), expires_at timestamptz not null,
  claimed_lesson_id uuid unique references public.lessons(id) on delete set null
);
alter table public.stream_uploads add column if not exists processing_status text not null default 'pending';
do $$ begin
  if not exists (select 1 from pg_constraint where conrelid='public.stream_uploads'::regclass and conname='stream_uploads_processing_status_check') then
    alter table public.stream_uploads add constraint stream_uploads_processing_status_check check (processing_status in ('pending','ready','error'));
  end if;
end $$;
alter table public.lessons add column if not exists processing_status text not null default 'pending';
do $$ begin
  if not exists (select 1 from pg_constraint where conrelid='public.lessons'::regclass and conname='lessons_processing_status_check') then
    alter table public.lessons add constraint lessons_processing_status_check check (processing_status in ('pending','ready','error'));
  end if;
end $$;
create table if not exists public.lesson_resources (
  id uuid primary key default gen_random_uuid(), lesson_id uuid not null references public.lessons(id) on delete cascade,
  title text not null, storage_path text not null, mime_type text, size_bytes bigint,
  created_at timestamptz not null default now()
);
create table if not exists public.products (
  id uuid primary key default gen_random_uuid(), kind public.product_kind not null,
  owner_id uuid references public.profiles(id) on delete cascade, course_id uuid references public.courses(id) on delete cascade,
  title_en text not null, title_ar text not null, is_active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint product_target_check check ((kind='course' and course_id is not null) or (kind<>'course'))
);
create table if not exists public.pricing_plans (
  id uuid primary key default gen_random_uuid(), product_id uuid not null references public.products(id) on delete cascade,
  name_en text not null, name_ar text not null, currency char(3) not null,
  amount_minor bigint not null check (amount_minor >= 0), billing_period public.plan_billing_period not null,
  access_duration public.access_duration not null default 'lifetime', access_days integer,
  trial_days integer not null default 0 check (trial_days >= 0), is_active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint plan_access_days_check check ((access_duration='fixed_days' and access_days > 0) or (access_duration<>'fixed_days' and access_days is null))
);
create table if not exists public.plan_items (
  plan_id uuid not null references public.pricing_plans(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  primary key(plan_id, product_id)
);
create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(), buyer_id uuid not null references public.profiles(id),
  status public.order_status not null default 'pending', currency char(3) not null,
  subtotal_minor bigint not null check(subtotal_minor >= 0), tax_minor bigint not null default 0 check(tax_minor >= 0),
  total_minor bigint not null check(total_minor >= 0), provider text, provider_checkout_id text, idempotency_key text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(provider,provider_checkout_id), unique(buyer_id,idempotency_key)
);
create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(), order_id uuid not null references public.orders(id) on delete cascade,
  product_id uuid not null references public.products(id), plan_id uuid references public.pricing_plans(id),
  title_snapshot text not null, quantity integer not null default 1 check(quantity > 0),
  unit_amount_minor bigint not null check(unit_amount_minor >= 0), total_amount_minor bigint not null check(total_amount_minor >= 0)
);
create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles(id),
  plan_id uuid not null references public.pricing_plans(id), provider text, provider_subscription_id text,
  status text not null check(status in ('pending','active','past_due','cancelled','expired')),
  current_period_start timestamptz, current_period_end timestamptz, cancel_at_period_end boolean not null default false,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(provider,provider_subscription_id)
);
create table if not exists public.entitlements (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  source public.entitlement_source not null, order_item_id uuid references public.order_items(id),
  subscription_id uuid references public.subscriptions(id), starts_at timestamptz not null default now(),
  expires_at timestamptz, revoked_at timestamptz, grant_reason text, created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  constraint entitlement_expiry_check check (expires_at is null or expires_at > starts_at)
);
create index if not exists entitlements_active_lookup on public.entitlements(user_id,product_id,expires_at) where revoked_at is null;
create table if not exists public.enrollments (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete cascade,
  entitlement_id uuid references public.entitlements(id), enrolled_at timestamptz not null default now(),
  completed_at timestamptz, unique(user_id,course_id)
);
create table if not exists public.lesson_progress (
  user_id uuid not null references public.profiles(id) on delete cascade,
  lesson_id uuid not null references public.lessons(id) on delete cascade,
  last_position_seconds integer not null default 0 check(last_position_seconds >= 0),
  completed_at timestamptz, updated_at timestamptz not null default now(), primary key(user_id,lesson_id)
);
create table if not exists public.quizzes (
  id uuid primary key default gen_random_uuid(), course_id uuid not null references public.courses(id) on delete cascade,
  title_en text not null, title_ar text not null, passing_score numeric(5,2) not null default 70 check(passing_score between 0 and 100),
  is_published boolean not null default false, created_at timestamptz not null default now()
);
create table if not exists public.questions (
  id uuid primary key default gen_random_uuid(), quiz_id uuid not null references public.quizzes(id) on delete cascade,
  prompt_en text not null, prompt_ar text not null, question_type text not null default 'single_choice' check(question_type in ('single_choice','multiple_choice','short_answer')),
  options jsonb not null default '[]'::jsonb, correct_answer jsonb, points numeric(8,2) not null default 1 check(points > 0), sort_order integer not null default 0
);
create table if not exists public.quiz_attempts (
  id uuid primary key default gen_random_uuid(), quiz_id uuid not null references public.quizzes(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade, answers jsonb not null default '{}'::jsonb,
  score numeric(5,2), passed boolean, submitted_at timestamptz, created_at timestamptz not null default now()
);
create table if not exists public.assignments (
  id uuid primary key default gen_random_uuid(), course_id uuid not null references public.courses(id) on delete cascade,
  title_en text not null, title_ar text not null, instructions_en text not null default '', instructions_ar text not null default '',
  due_at timestamptz, created_at timestamptz not null default now()
);
create table if not exists public.submissions (
  id uuid primary key default gen_random_uuid(), assignment_id uuid not null references public.assignments(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade, answer_text text, resource_path text,
  grade numeric(8,2), feedback text, submitted_at timestamptz not null default now(), reviewed_at timestamptz,
  reviewed_by uuid references public.profiles(id), unique(assignment_id,student_id)
);
create table if not exists public.reviews (
  id uuid primary key default gen_random_uuid(), course_id uuid not null references public.courses(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade, rating integer not null check(rating between 1 and 5),
  body text, is_published boolean not null default false, created_at timestamptz not null default now(), unique(course_id,user_id)
);
create table if not exists public.certificates (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete cascade, certificate_code text not null unique,
  issued_at timestamptz not null default now(), revoked_at timestamptz, unique(user_id,course_id)
);
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null, body text not null, href text, read_at timestamptz, created_at timestamptz not null default now()
);
create table if not exists public.payment_events (
  id uuid primary key default gen_random_uuid(), provider text not null, provider_event_id text not null,
  event_type text not null, payload jsonb not null default '{}'::jsonb, processed_at timestamptz,
  processing_error text, created_at timestamptz not null default now(), unique(provider,provider_event_id)
);
create table if not exists public.refunds (
  id uuid primary key default gen_random_uuid(), order_id uuid not null references public.orders(id),
  provider_refund_id text, amount_minor bigint not null check(amount_minor > 0), currency char(3) not null,
  status text not null check(status in ('pending','succeeded','failed')), reason text, created_at timestamptz not null default now()
);
create table if not exists public.instructor_earnings (
  id uuid primary key default gen_random_uuid(), instructor_id uuid not null references public.profiles(id),
  order_item_id uuid not null references public.order_items(id), gross_minor bigint not null, platform_fee_minor bigint not null default 0,
  net_minor bigint not null, currency char(3) not null, status text not null default 'pending' check(status in ('pending','available','paid','reversed')),
  created_at timestamptz not null default now()
);
create table if not exists public.audit_logs (
  id bigint generated always as identity primary key, actor_id uuid references public.profiles(id) on delete set null,
  action text not null, target_type text not null, target_id text, metadata jsonb not null default '{}'::jsonb,
  ip_hash text, created_at timestamptz not null default now()
);
create index if not exists courses_catalog_idx on public.courses(status, published_at desc);
create index if not exists lessons_section_order_idx on public.lessons(section_id,sort_order);
create index if not exists enrollments_user_idx on public.enrollments(user_id, enrolled_at desc);
create index if not exists orders_buyer_idx on public.orders(buyer_id,created_at desc);

create or replace function public.is_admin(_user_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$ select (_user_id=auth.uid() or exists(select 1 from public.profiles me join public.user_roles mr on mr.user_id=me.id where me.id=auth.uid() and me.status='active' and mr.role in ('super_admin','admin'))) and exists(select 1 from public.profiles pr where pr.id=_user_id and pr.status='active') and exists(select 1 from public.user_roles ur where ur.user_id=_user_id and ur.role in ('super_admin','admin')) $$;
create or replace function public.is_active_user(_user_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$ select (_user_id=auth.uid() or public.is_admin(auth.uid())) and exists(select 1 from public.profiles where id=_user_id and status='active') $$;
create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean language sql stable security definer set search_path = public
as $$ select (_user_id=auth.uid() or public.is_admin(auth.uid())) and exists(select 1 from public.user_roles where user_id=_user_id and role=_role) $$;
create or replace function public.owns_course(_course_id uuid, _user_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$ select (_user_id=auth.uid() or public.is_admin(auth.uid())) and public.is_active_user(_user_id) and (exists(select 1 from public.courses where id=_course_id and owner_id=_user_id) or public.is_admin(_user_id)) $$;
-- Keep zero-argument helpers as explicit wrappers. Do not use DEFAULT auth.uid() on
-- the parameterized versions: older installs may already contain the zero-argument
-- overload, which makes public.is_admin() ambiguous in RLS policies.
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public
as $$ select public.is_admin(auth.uid()) $$;
create or replace function public.is_active_user()
returns boolean language sql stable security definer set search_path = public
as $$ select public.is_active_user(auth.uid()) $$;
create or replace function public.owns_course(_course_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$ select public.owns_course(_course_id, auth.uid()) $$;

-- Explicit EXECUTE grants for helpers directly referenced by RLS policies.
-- In Supabase projects with restrictive default function privileges, omitting these
-- grants causes errors such as 42501: permission denied for function is_admin.
grant execute on function public.is_admin() to anon, authenticated, service_role;
grant execute on function public.is_active_user(uuid) to authenticated, service_role;
grant execute on function public.has_role(uuid, public.app_role) to authenticated, service_role;
grant execute on function public.owns_course(uuid) to authenticated, service_role;

create or replace function public.has_active_entitlement(_user_id uuid, _course_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$ select (_user_id=auth.uid() or public.is_admin(auth.uid())) and exists (
  select 1 from public.entitlements e join public.products p on p.id=e.product_id
  where e.user_id=_user_id and e.revoked_at is null and e.starts_at <= now() and (e.expires_at is null or e.expires_at > now())
  and (p.course_id=_course_id or (p.kind='bundle' and exists(select 1 from public.plan_items pi join public.products cp on cp.id=pi.product_id where pi.plan_id in (select pp.id from public.pricing_plans pp where pp.product_id=p.id) and cp.course_id=_course_id)))
) $$;
grant execute on function public.has_active_entitlement(uuid, uuid) to authenticated, service_role;

-- RLS: enable on all user-data tables.
do $$ declare t text; begin
  foreach t in array array['profiles','user_roles','instructor_profiles','categories','courses','course_instructors','sections','lessons','stream_uploads','lesson_resources','products','pricing_plans','plan_items','orders','order_items','subscriptions','entitlements','enrollments','lesson_progress','quizzes','questions','quiz_attempts','assignments','submissions','reviews','certificates','notifications','payment_events','refunds','instructor_earnings','audit_logs'] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

drop policy if exists "profiles read self or admin" on public.profiles;
create policy "profiles read self or admin" on public.profiles for select to authenticated using (id=auth.uid() or public.is_admin());
drop policy if exists "profiles update self or admin" on public.profiles;
create policy "profiles update self or admin" on public.profiles for update to authenticated using (id=auth.uid() or public.is_admin()) with check (id=auth.uid() or public.is_admin());
-- Prevent users from changing their own status or other privileged columns via PostgREST.
revoke update on public.profiles from authenticated;
grant update(display_name, avatar_url, preferred_locale) on public.profiles to authenticated;
drop policy if exists "roles read self or admin" on public.user_roles;
create policy "roles read self or admin" on public.user_roles for select to authenticated using (user_id=auth.uid() or public.is_admin());
drop policy if exists "roles admin manage" on public.user_roles;
create policy "roles admin manage" on public.user_roles for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists "instructor profiles public approved" on public.instructor_profiles;
create policy "instructor profiles public approved" on public.instructor_profiles for select using (is_approved or user_id=auth.uid() or public.is_admin());
drop policy if exists "instructor profiles owner manage" on public.instructor_profiles;
drop policy if exists "instructor profiles owner insert pending" on public.instructor_profiles;
create policy "instructor profiles owner insert pending" on public.instructor_profiles for insert to authenticated
  with check (user_id=auth.uid() and public.is_active_user(auth.uid()) and is_approved=false);
drop policy if exists "instructor profiles owner update pending" on public.instructor_profiles;
create policy "instructor profiles owner update pending" on public.instructor_profiles for update to authenticated
  using (user_id=auth.uid() and public.is_active_user(auth.uid()))
  with check (user_id=auth.uid() and public.is_active_user(auth.uid()));
drop policy if exists "instructor profiles admin manage" on public.instructor_profiles;
create policy "instructor profiles admin manage" on public.instructor_profiles for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
drop policy if exists "categories public read" on public.categories;
create policy "categories public read" on public.categories for select using (true);
drop policy if exists "categories admin manage" on public.categories;
create policy "categories admin manage" on public.categories for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists "courses published or owner read" on public.courses;
create policy "courses published or owner read" on public.courses for select using (status='published' or owner_id=auth.uid() or public.is_admin());
drop policy if exists "courses owner insert" on public.courses;
create policy "courses owner insert" on public.courses for insert to authenticated with check (owner_id=auth.uid() and public.is_active_user(auth.uid()) and (public.has_role(auth.uid(),'instructor') or public.is_admin()));
drop policy if exists "courses owner update" on public.courses;
create policy "courses owner update" on public.courses for update to authenticated using ((owner_id=auth.uid() and public.is_active_user(auth.uid())) or public.is_admin()) with check ((owner_id=auth.uid() and public.is_active_user(auth.uid())) or public.is_admin());
drop policy if exists "courses owner delete draft" on public.courses;
create policy "courses owner delete draft" on public.courses for delete to authenticated using ((owner_id=auth.uid() and public.is_active_user(auth.uid()) and status='draft') or public.is_admin());
drop policy if exists "course instructors read" on public.course_instructors;
create policy "course instructors read" on public.course_instructors for select using (exists(select 1 from public.courses c where c.id=course_id and (c.status='published' or c.owner_id=auth.uid() or public.is_admin())));
drop policy if exists "course instructors owner manage" on public.course_instructors;
create policy "course instructors owner manage" on public.course_instructors for all to authenticated using (public.owns_course(course_id)) with check (public.owns_course(course_id));
drop policy if exists "sections read published course or owner" on public.sections;
create policy "sections read published course or owner" on public.sections for select using (exists(select 1 from public.courses c where c.id=course_id and (c.status='published' or c.owner_id=auth.uid() or public.is_admin())));
drop policy if exists "sections owner manage" on public.sections;
create policy "sections owner manage" on public.sections for all to authenticated using (public.owns_course(course_id)) with check (public.owns_course(course_id));
drop policy if exists "lessons read published or owner" on public.lessons;
create policy "lessons read published or owner" on public.lessons for select using (
  exists(select 1 from public.sections s join public.courses c on c.id=s.course_id
    where s.id=section_id and (
      (c.status='published' and is_published and (is_preview or (
        public.is_active_user(auth.uid()) and (public.has_active_entitlement(auth.uid(),c.id)
          or exists(select 1 from public.enrollments e where e.user_id=auth.uid() and e.course_id=c.id))
      ))) or c.owner_id=auth.uid() or public.is_admin()
    )));
drop policy if exists "lessons owner manage" on public.lessons;
create policy "lessons owner manage" on public.lessons for all to authenticated using (exists(select 1 from public.sections s where s.id=section_id and public.owns_course(s.course_id))) with check (exists(select 1 from public.sections s where s.id=section_id and public.owns_course(s.course_id)));
drop policy if exists "stream uploads uploader read" on public.stream_uploads;
create policy "stream uploads uploader read" on public.stream_uploads for select to authenticated using (uploader_id=auth.uid() or public.is_admin());
drop policy if exists "stream uploads owner insert" on public.stream_uploads;
create policy "stream uploads owner insert" on public.stream_uploads for insert to authenticated with check (uploader_id=auth.uid() and public.is_active_user(auth.uid()));
drop policy if exists "stream uploads owner claim" on public.stream_uploads;
create policy "stream uploads owner claim" on public.stream_uploads for update to authenticated
  using (uploader_id=auth.uid() and claimed_lesson_id is null and expires_at > now())
  with check (uploader_id=auth.uid() and claimed_lesson_id is not null and exists(
    select 1 from public.lessons l join public.sections s on s.id=l.section_id
    join public.courses c on c.id=s.course_id
    where l.id=claimed_lesson_id and l.stream_uid=stream_uploads.stream_uid and c.owner_id=auth.uid()
  ));
drop policy if exists "resources enrolled or owner read" on public.lesson_resources;
create policy "resources enrolled or owner read" on public.lesson_resources for select to authenticated using (
  exists(select 1 from public.lessons l join public.sections s on s.id=l.section_id where l.id=lesson_id and (
    public.owns_course(s.course_id) or (public.is_active_user(auth.uid()) and
      (public.has_active_entitlement(auth.uid(),s.course_id) or exists(select 1 from public.enrollments e where e.user_id=auth.uid() and e.course_id=s.course_id)))
  )));
drop policy if exists "resources owner manage" on public.lesson_resources;
create policy "resources owner manage" on public.lesson_resources for all to authenticated using (exists(select 1 from public.lessons l join public.sections s on s.id=l.section_id where l.id=lesson_id and public.owns_course(s.course_id))) with check (exists(select 1 from public.lessons l join public.sections s on s.id=l.section_id where l.id=lesson_id and public.owns_course(s.course_id)));
drop policy if exists "products active read" on public.products;
create policy "products active read" on public.products for select using (is_active or owner_id=auth.uid() or public.is_admin());
drop policy if exists "products owner manage" on public.products;
create policy "products owner manage" on public.products for all to authenticated using ((owner_id=auth.uid() and (course_id is null or public.owns_course(course_id))) or public.is_admin()) with check ((owner_id=auth.uid() and (course_id is null or public.owns_course(course_id))) or public.is_admin());
drop policy if exists "plans active read" on public.pricing_plans;
create policy "plans active read" on public.pricing_plans for select using (is_active or public.is_admin() or exists(select 1 from public.products p where p.id=product_id and p.owner_id=auth.uid()));
drop policy if exists "plans owner manage" on public.pricing_plans;
create policy "plans owner manage" on public.pricing_plans for all to authenticated using (public.is_admin() or exists(select 1 from public.products p where p.id=product_id and p.owner_id=auth.uid())) with check (public.is_admin() or exists(select 1 from public.products p where p.id=product_id and p.owner_id=auth.uid()));
drop policy if exists "plan items read active" on public.plan_items;
drop policy if exists "plan items read active" on public.plan_items;
create policy "plan items read active" on public.plan_items for select using (
  exists(select 1 from public.pricing_plans pp join public.products p on p.id=pp.product_id
    where pp.id=plan_id and ((pp.is_active and p.is_active) or p.owner_id=auth.uid() or public.is_admin()))
);
drop policy if exists "plan items owner manage" on public.plan_items;
create policy "plan items owner manage" on public.plan_items for all to authenticated
  using (public.is_admin() or (
    exists(select 1 from public.products bundle join public.pricing_plans pp on pp.product_id=bundle.id
      where pp.id=plan_id and bundle.kind='bundle' and bundle.owner_id=auth.uid())
    and exists(select 1 from public.products item where item.id=product_id
      and (item.owner_id=auth.uid() or (item.course_id is not null and public.owns_course(item.course_id)))
  )))
  with check (public.is_admin() or (
    exists(select 1 from public.products bundle join public.pricing_plans pp on pp.product_id=bundle.id
      where pp.id=plan_id and bundle.kind='bundle' and bundle.owner_id=auth.uid())
    and exists(select 1 from public.products item where item.id=product_id
      and (item.owner_id=auth.uid() or (item.course_id is not null and public.owns_course(item.course_id)))
  )));
drop policy if exists "orders buyer read" on public.orders;
create policy "orders buyer read" on public.orders for select to authenticated using (buyer_id=auth.uid() or public.is_admin());
drop policy if exists "order items buyer read" on public.order_items;
create policy "order items buyer read" on public.order_items for select to authenticated using (exists(select 1 from public.orders o where o.id=order_id and (o.buyer_id=auth.uid() or public.is_admin())));
drop policy if exists "subscriptions owner read" on public.subscriptions;
create policy "subscriptions owner read" on public.subscriptions for select to authenticated using (user_id=auth.uid() or public.is_admin());
drop policy if exists "entitlements owner read" on public.entitlements;
create policy "entitlements owner read" on public.entitlements for select to authenticated using (user_id=auth.uid() or public.is_admin());
drop policy if exists "enrollments owner or course owner read" on public.enrollments;
drop policy if exists "enrollments owner or course owner read" on public.enrollments;
create policy "enrollments owner or course owner read" on public.enrollments for select to authenticated
  using (public.is_active_user(auth.uid()) and (user_id=auth.uid() or public.owns_course(course_id)));
drop policy if exists "enrollments admin manage" on public.enrollments;
create policy "enrollments admin manage" on public.enrollments for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists "progress self or instructor read" on public.lesson_progress;
create policy "progress self or instructor read" on public.lesson_progress for select to authenticated using (user_id=auth.uid() or exists(select 1 from public.lessons l join public.sections s on s.id=l.section_id where l.id=lesson_id and public.owns_course(s.course_id)));
drop policy if exists "progress self manage" on public.lesson_progress;
drop policy if exists "progress self manage" on public.lesson_progress;
create policy "progress self manage" on public.lesson_progress for all to authenticated
  using (user_id=auth.uid() and public.is_active_user(auth.uid()) and exists(
    select 1 from public.lessons l join public.sections s on s.id=l.section_id join public.courses c on c.id=s.course_id
    where l.id=lesson_id and c.status='published' and l.is_published and
      (l.is_preview or public.has_active_entitlement(auth.uid(),c.id) or exists(select 1 from public.enrollments e where e.user_id=auth.uid() and e.course_id=c.id))
  ))
  with check (user_id=auth.uid() and public.is_active_user(auth.uid()) and exists(
    select 1 from public.lessons l join public.sections s on s.id=l.section_id join public.courses c on c.id=s.course_id
    where l.id=lesson_id and c.status='published' and l.is_published and
      (l.is_preview or public.has_active_entitlement(auth.uid(),c.id) or exists(select 1 from public.enrollments e where e.user_id=auth.uid() and e.course_id=c.id))
  ));
drop policy if exists "quizzes published or owner read" on public.quizzes;
drop policy if exists "quizzes published or owner read" on public.quizzes;
create policy "quizzes published or owner read" on public.quizzes for select to authenticated using (
  public.owns_course(course_id) or (is_published and public.is_active_user(auth.uid()) and exists(
    select 1 from public.courses c where c.id=course_id and c.status='published'
      and (public.has_active_entitlement(auth.uid(),c.id) or exists(select 1 from public.enrollments e where e.user_id=auth.uid() and e.course_id=c.id))
  ))
);
drop policy if exists "quizzes owner manage" on public.quizzes;
create policy "quizzes owner manage" on public.quizzes for all to authenticated using (public.owns_course(course_id)) with check (public.owns_course(course_id));
drop policy if exists "questions read published quiz or owner" on public.questions;
drop policy if exists "questions owner or admin read" on public.questions;
create policy "questions owner or admin read" on public.questions for select to authenticated
  using (exists(select 1 from public.quizzes q where q.id=quiz_id and public.owns_course(q.course_id)));
drop policy if exists "questions owner manage" on public.questions;
create policy "questions owner manage" on public.questions for all to authenticated using (exists(select 1 from public.quizzes q where q.id=quiz_id and public.owns_course(q.course_id))) with check (exists(select 1 from public.quizzes q where q.id=quiz_id and public.owns_course(q.course_id)));
drop policy if exists "quiz attempts self or instructor read" on public.quiz_attempts;
drop policy if exists "quiz attempts self or instructor read" on public.quiz_attempts;
create policy "quiz attempts self or instructor read" on public.quiz_attempts for select to authenticated using (
  (user_id=auth.uid() and public.is_active_user(auth.uid()))
  or exists(select 1 from public.quizzes q where q.id=quiz_id and public.owns_course(q.course_id))
);
drop policy if exists "quiz attempts self insert" on public.quiz_attempts;
drop policy if exists "quiz attempts enrolled insert" on public.quiz_attempts;
create policy "quiz attempts enrolled insert" on public.quiz_attempts for insert to authenticated with check (
  user_id=auth.uid() and public.is_active_user(auth.uid()) and exists(
    select 1 from public.quizzes q where q.id=quiz_id and q.is_published and (
      public.owns_course(q.course_id) or public.has_active_entitlement(auth.uid(),q.course_id)
      or exists(select 1 from public.enrollments e where e.user_id=auth.uid() and e.course_id=q.course_id)
    )
  ));
drop policy if exists "assignments enrolled or owner read" on public.assignments;
drop policy if exists "assignments enrolled or owner read" on public.assignments;
create policy "assignments enrolled or owner read" on public.assignments for select to authenticated using (
  public.owns_course(course_id) or (public.is_active_user(auth.uid()) and exists(
    select 1 from public.enrollments e where e.course_id=assignments.course_id and e.user_id=auth.uid()
  ))
);
drop policy if exists "assignments owner manage" on public.assignments;
create policy "assignments owner manage" on public.assignments for all to authenticated using (public.owns_course(course_id)) with check (public.owns_course(course_id));
drop policy if exists "submissions student or instructor read" on public.submissions;
drop policy if exists "submissions student or instructor read" on public.submissions;
create policy "submissions student or instructor read" on public.submissions for select to authenticated using (
  (student_id=auth.uid() and public.is_active_user(auth.uid()))
  or exists(select 1 from public.assignments a where a.id=assignment_id and public.owns_course(a.course_id))
);
drop policy if exists "submissions student insert" on public.submissions;
drop policy if exists "submissions enrolled insert" on public.submissions;
create policy "submissions enrolled insert" on public.submissions for insert to authenticated with check (
  student_id=auth.uid() and public.is_active_user(auth.uid()) and exists(
    select 1 from public.assignments a where a.id=assignment_id and (
      public.owns_course(a.course_id) or public.has_active_entitlement(auth.uid(),a.course_id)
      or exists(select 1 from public.enrollments e where e.user_id=auth.uid() and e.course_id=a.course_id)
    )
  ));
drop policy if exists "submissions student update or instructor" on public.submissions;
create policy "submissions student update or instructor" on public.submissions for update to authenticated
  using (student_id=auth.uid() or exists(select 1 from public.assignments a where a.id=assignment_id and public.owns_course(a.course_id)))
  with check ((student_id=auth.uid() and public.is_active_user(auth.uid()) and exists(
    select 1 from public.assignments a where a.id=assignment_id and (
      public.owns_course(a.course_id) or public.has_active_entitlement(auth.uid(),a.course_id)
      or exists(select 1 from public.enrollments e where e.user_id=auth.uid() and e.course_id=a.course_id)
    ))) or exists(select 1 from public.assignments a where a.id=assignment_id and public.owns_course(a.course_id)));
drop policy if exists "reviews public published or own" on public.reviews;
create policy "reviews public published or own" on public.reviews for select using (is_published or user_id=auth.uid() or public.is_admin());
drop policy if exists "reviews enrolled write" on public.reviews;
drop policy if exists "reviews enrolled write" on public.reviews;
create policy "reviews enrolled write" on public.reviews for insert to authenticated with check (
  user_id=auth.uid() and public.is_active_user(auth.uid()) and exists(
    select 1 from public.enrollments e where e.course_id=reviews.course_id and e.user_id=auth.uid()
  )
);
drop policy if exists "reviews owner/admin moderate" on public.reviews;
drop policy if exists "reviews owner/admin moderate" on public.reviews;
create policy "reviews owner/admin moderate" on public.reviews for update to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists "certificates owner read" on public.certificates;
create policy "certificates owner read" on public.certificates for select to authenticated using (user_id=auth.uid() or public.is_admin());
drop policy if exists "notifications owner read update" on public.notifications;
create policy "notifications owner read update" on public.notifications for select to authenticated using (user_id=auth.uid() or public.is_admin());
drop policy if exists "notifications owner update" on public.notifications;
create policy "notifications owner update" on public.notifications for update to authenticated using (user_id=auth.uid()) with check (user_id=auth.uid());
drop policy if exists "payment events admin only" on public.payment_events;
create policy "payment events admin only" on public.payment_events for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists "refunds buyer or admin read" on public.refunds;
create policy "refunds buyer or admin read" on public.refunds for select to authenticated using (public.is_admin() or exists(select 1 from public.orders o where o.id=order_id and o.buyer_id=auth.uid()));
drop policy if exists "earnings instructor or admin read" on public.instructor_earnings;
drop policy if exists "earnings instructor or admin read" on public.instructor_earnings;
create policy "earnings instructor or admin read" on public.instructor_earnings for select to authenticated using (
  (instructor_id=auth.uid() and public.is_active_user(auth.uid())) or public.is_admin()
);
drop policy if exists "audit admin read" on public.audit_logs;
create policy "audit admin read" on public.audit_logs for select to authenticated using (public.is_admin());
-- Writes to orders, entitlements, subscriptions, refunds, earnings, payment events, and audit logs must occur only in trusted server workflows.

-- Trusted, atomic free-course enrollment. Does not allow client-supplied price or paid access.
create or replace function public.enroll_free_course(_course_id uuid)
returns uuid language plpgsql security definer set search_path = public
as $$
declare _uid uuid := auth.uid(); _product_id uuid; _entitlement_id uuid;
begin
  if _uid is null then raise exception 'authentication_required' using errcode='28000'; end if;
  if not exists(select 1 from public.profiles where id=_uid and status='active') then raise exception 'account_inactive' using errcode='42501'; end if;
  if not exists(select 1 from public.courses where id=_course_id and status='published') then raise exception 'course_unavailable' using errcode='P0002'; end if;
  select p.id into _product_id from public.products p join public.pricing_plans pp on pp.product_id=p.id
    where p.course_id=_course_id and p.kind='course' and p.is_active and pp.is_active and pp.amount_minor=0 and pp.billing_period='one_time' limit 1;
  if _product_id is null then raise exception 'free_plan_not_found' using errcode='P0002'; end if;
  if exists(select 1 from public.enrollments where user_id=_uid and course_id=_course_id) then
    return (select id from public.enrollments where user_id=_uid and course_id=_course_id);
  end if;
  insert into public.entitlements(user_id,product_id,source,grant_reason) values (_uid,_product_id,'free_enrollment','Free course enrollment') returning id into _entitlement_id;
  insert into public.enrollments(user_id,course_id,entitlement_id) values (_uid,_course_id,_entitlement_id) returning id into _entitlement_id;
  return _entitlement_id;
end $$;
revoke all on function public.enroll_free_course(uuid) from public, anon;
grant execute on function public.enroll_free_course(uuid) to authenticated;

-- Instructor approval can only be changed by an admin; profile owners can edit other fields.
create or replace function public.guard_instructor_approval()
returns trigger language plpgsql security definer set search_path=public
as $$
begin
  if coalesce(auth.role(),'') <> 'service_role' and not public.is_admin() then
    if tg_op='INSERT' then new.is_approved := false;
    else new.is_approved := old.is_approved;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists guard_instructor_approval on public.instructor_profiles;
create trigger guard_instructor_approval before insert or update on public.instructor_profiles
for each row execute procedure public.guard_instructor_approval();

-- Students can read only safe question columns for an entitled, published quiz.
-- The answer key is never granted to anon/authenticated; grading must use trusted server code.
drop policy if exists "questions student enrolled read" on public.questions;
create policy "questions student enrolled read" on public.questions for select to authenticated using (
  exists (
    select 1 from public.quizzes z join public.courses c on c.id=z.course_id
    where z.id=questions.quiz_id and z.is_published and c.status='published'
      and public.is_active_user(auth.uid())
      and (public.has_active_entitlement(auth.uid(),z.course_id)
        or exists(select 1 from public.enrollments e where e.user_id=auth.uid() and e.course_id=z.course_id))
  )
);
revoke select on table public.questions from public, anon, authenticated;
grant select (id, quiz_id, prompt_en, prompt_ar, question_type, options, points, sort_order) on table public.questions to authenticated;
-- Security-invoker means the caller's grants and RLS apply to underlying questions/quizzes/courses.
create or replace view public.quiz_question_catalog with (security_barrier=true, security_invoker=true) as
select q.id, q.quiz_id, q.prompt_en, q.prompt_ar, q.question_type, q.options, q.points, q.sort_order
from public.questions q
join public.quizzes z on z.id=q.quiz_id
join public.courses c on c.id=z.course_id
where public.owns_course(z.course_id) or (
  z.is_published and c.status='published' and public.is_active_user(auth.uid()) and (
    public.has_active_entitlement(auth.uid(),z.course_id)
    or exists(select 1 from public.enrollments e where e.user_id=auth.uid() and e.course_id=z.course_id)
  )
);
revoke all on public.quiz_question_catalog from public, anon;
grant select on public.quiz_question_catalog to authenticated;

-- Student inserts/updates cannot self-award a grade or overwrite review metadata.
create or replace function public.guard_submission_grading_fields()
returns trigger language plpgsql security definer set search_path=public
as $$
begin
  if coalesce(auth.role(),'') <> 'service_role' and not public.is_admin() and not exists(
    select 1 from public.assignments a where a.id=new.assignment_id and public.owns_course(a.course_id)
  ) then
    if tg_op='INSERT' then
      new.grade := null; new.feedback := null; new.reviewed_at := null; new.reviewed_by := null;
    else
      new.grade := old.grade; new.feedback := old.feedback; new.reviewed_at := old.reviewed_at; new.reviewed_by := old.reviewed_by;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists guard_submission_grading_fields on public.submissions;
create trigger guard_submission_grading_fields before insert or update on public.submissions
for each row execute procedure public.guard_submission_grading_fields();

-- Student-submitted reviews remain pending until a trusted moderator publishes them.
create or replace function public.guard_review_moderation()
returns trigger language plpgsql security definer set search_path=public
as $$
begin
  if coalesce(auth.role(),'') <> 'service_role' and not public.is_admin() then
    if tg_op='INSERT' then new.is_published := false;
    else new.is_published := old.is_published; new.user_id := old.user_id; new.course_id := old.course_id;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists guard_review_moderation on public.reviews;
create trigger guard_review_moderation before insert or update on public.reviews
for each row execute procedure public.guard_review_moderation();

-- Students cannot insert a pre-scored quiz attempt.
create or replace function public.guard_quiz_attempt_score()
returns trigger language plpgsql security definer set search_path=public
as $$
begin
  if coalesce(auth.role(),'') <> 'service_role' and not public.is_admin() and not exists(
    select 1 from public.quizzes q where q.id=new.quiz_id and public.owns_course(q.course_id)
  ) then
    new.score := null; new.passed := null; new.submitted_at := null;
  end if;
  return new;
end $$;
drop trigger if exists guard_quiz_attempt_score on public.quiz_attempts;
create trigger guard_quiz_attempt_score before insert or update on public.quiz_attempts
for each row execute procedure public.guard_quiz_attempt_score();

-- Validate video UID ownership at the database boundary and reserve processing status for trusted webhook updates.
create or replace function public.guard_lesson_stream_state()
returns trigger language plpgsql security definer set search_path=public
as $$
declare _upload_state text;
begin
  if coalesce(auth.role(),'')='service_role' or public.is_admin() then
    return new;
  end if;
  if tg_op='INSERT' then
    if new.kind='video' then
      if new.stream_uid is null then
        raise exception 'video_requires_stream_upload' using errcode='42501';
      end if;
      select su.processing_status into _upload_state
      from public.stream_uploads su
      where su.stream_uid=new.stream_uid and su.uploader_id=auth.uid()
        and su.claimed_lesson_id is null and su.expires_at > now();
      if not found then
        raise exception 'stream_upload_not_owned_or_expired' using errcode='42501';
      end if;
      new.processing_status := _upload_state;
      new.is_published := false;
    else
      if new.stream_uid is not null then
        raise exception 'non_video_lesson_cannot_have_stream_uid' using errcode='42501';
      end if;
      new.processing_status := 'pending';
      new.is_published := false;
    end if;
  else
    new.stream_uid := old.stream_uid;
    new.processing_status := old.processing_status;
    new.is_published := old.is_published;
  end if;
  return new;
end $$;
drop trigger if exists guard_lesson_stream_state on public.lessons;
create trigger guard_lesson_stream_state before insert or update on public.lessons
for each row execute procedure public.guard_lesson_stream_state();

-- Column-level grants ensure a browser session cannot forge video readiness or publish a lesson directly.
revoke insert, update on public.lessons from anon, authenticated;
grant insert(section_id,title_en,title_ar,kind,body_en,body_ar,stream_uid,is_preview,sort_order) on public.lessons to authenticated;
grant update(title_en,title_ar,body_en,body_ar,is_preview,sort_order) on public.lessons to authenticated;
revoke insert, update on public.stream_uploads from anon, authenticated;
grant insert(stream_uid,uploader_id,expires_at) on public.stream_uploads to authenticated;
grant update(claimed_lesson_id) on public.stream_uploads to authenticated;
