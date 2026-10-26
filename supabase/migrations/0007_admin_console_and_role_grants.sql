-- Admin console foundation + repair role-query privileges without bypassing RLS.
-- Safe to re-run. Does not drop business data or disable RLS.
begin;

create or replace function public.is_super_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    join public.user_roles r on r.user_id = p.id
    where p.id = auth.uid()
      and p.status = 'active'
      and r.role = 'super_admin'
  );
$$;
revoke all on function public.is_super_admin() from public, anon;
grant execute on function public.is_super_admin() to anon, authenticated, service_role;

-- PostgREST requires table SELECT privileges in addition to a permissive RLS policy.
-- These grants restore only the operations already scoped by existing RLS policies.
grant usage on schema public to anon, authenticated, service_role;

-- Remove any broader default/public table grants first, then re-grant least privilege.
-- Profile owners may edit only display fields/localization; account status is server-managed.
revoke insert, update, delete on table public.profiles from public, anon, authenticated;
revoke insert, update, delete on table public.user_roles from public, anon, authenticated;
revoke insert, update, delete on table public.audit_logs from public, anon, authenticated;
revoke insert, update, delete on table public.categories from public, anon, authenticated;
revoke insert, update, delete on table public.instructor_profiles from public, anon, authenticated;
revoke insert, update, delete on table public.courses from public, anon, authenticated;
grant update(display_name, avatar_url, preferred_locale) on public.profiles to authenticated;
-- Instructors can still author their own content; the RLS policies below require ownership.
grant insert, update, delete on table public.courses to authenticated;

grant select on table public.profiles, public.user_roles, public.instructor_profiles,
  public.courses, public.categories, public.audit_logs to authenticated;
grant select on table public.categories to anon;
grant select, insert, update, delete on table public.profiles, public.user_roles,
  public.audit_logs, public.courses, public.categories, public.instructor_profiles to service_role;

-- Media authorization is enforced by trusted routes. Avoid inherited PUBLIC grants and preserve
-- the existing instructor editor's safe column allowlist while protecting media/publication fields.
revoke insert, update, delete on table public.lessons from public, anon, authenticated;
revoke insert (section_id, title_en, title_ar, kind, body_en, body_ar, stream_uid, r2_object_key, r2_size_bytes, processing_status, is_published, is_preview, sort_order),
       update (section_id, title_en, title_ar, kind, body_en, body_ar, stream_uid, r2_object_key, r2_size_bytes, processing_status, is_published, is_preview, sort_order)
  on table public.lessons from public, anon, authenticated;
grant insert (section_id, title_en, title_ar, kind, body_en, body_ar, is_preview, sort_order)
  on table public.lessons to authenticated;
grant update (title_en, title_ar, body_en, body_ar, is_preview, sort_order)
  on table public.lessons to authenticated;
revoke all on table public.stream_uploads from public, anon, authenticated;
revoke insert (stream_uid, uploader_id, expires_at), update (claimed_lesson_id)
  on table public.stream_uploads from public, anon, authenticated;
grant select, insert, update, delete on table public.lessons to service_role;
grant all on table public.stream_uploads to service_role;

-- Prevent an ordinary admin from promoting themselves or other users to admin/super_admin.
-- Mutations go through server routes using service-role access only after a role check.
drop policy if exists "roles admin manage" on public.user_roles;
drop policy if exists "roles super admin manage" on public.user_roles;
create policy "roles super admin manage" on public.user_roles
  for all to authenticated
  using (public.is_super_admin())
  with check (public.is_super_admin());

create table if not exists public.platform_settings (
  key text primary key check (key ~ '^[a-z][a-z0-9_.-]{1,79}$'),
  value jsonb not null default '{}'::jsonb,
  description text not null default '',
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table public.platform_settings enable row level security;
drop policy if exists "platform settings admin read" on public.platform_settings;
create policy "platform settings admin read" on public.platform_settings
  for select to authenticated using (public.is_admin());
drop policy if exists "platform settings super admin manage" on public.platform_settings;
create policy "platform settings super admin manage" on public.platform_settings
  for all to authenticated using (public.is_super_admin()) with check (public.is_super_admin());
revoke insert, update, delete on table public.platform_settings from public, anon, authenticated;
grant select on table public.platform_settings to authenticated;
grant select, insert, update, delete on table public.platform_settings to service_role;

-- Store business configuration as non-secret data only; provider credentials stay in env vars.
insert into public.platform_settings(key, value, description)
values
 ('platform.commission_bps', '0'::jsonb, 'Platform commission in basis points. Payments are disabled in Phase 1.'),
 ('instructors.require_approval', 'true'::jsonb, 'New instructor profiles require admin approval.'),
 ('courses.require_review', 'true'::jsonb, 'Courses must pass admin review before publication.'),
 ('uploads.max_resource_bytes', '26214400'::jsonb, 'Maximum general resource upload in bytes; server enforcement remains required.')
on conflict (key) do nothing;

-- A course owner may edit content, but may not self-assign ownership, feature their course,
-- forge publication timestamps, or set a privileged initial status through direct REST calls.
create or replace function public.guard_course_privileged_fields()
returns trigger language plpgsql security definer set search_path = public
as $$
declare review_required boolean;
begin
  if coalesce(auth.role(), '') = 'service_role' or public.is_super_admin() then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.owner_id is distinct from auth.uid() then
      raise exception 'course_owner_must_match_authenticated_user' using errcode = '42501';
    end if;
    new.status := 'draft';
    new.is_featured := false;
    new.published_at := null;
  else
    if new.owner_id is distinct from old.owner_id then
      raise exception 'course_owner_is_immutable' using errcode = '42501';
    end if;
    new.is_featured := old.is_featured;
    select coalesce((value #>> '{}')::boolean, true) into review_required
    from public.platform_settings where key = 'courses.require_review';
    review_required := coalesce(review_required, true);
    if new.status = 'published' and old.status is distinct from 'published' and not review_required then
      new.published_at := now();
    else
      new.published_at := old.published_at;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists courses_guard_privileged_fields on public.courses;
create trigger courses_guard_privileged_fields before insert or update on public.courses
for each row execute procedure public.guard_course_privileged_fields();

create or replace function public.enforce_course_publication_review()
returns trigger language plpgsql security definer set search_path = public
as $$
declare review_required boolean;
begin
  select coalesce((value #>> '{}')::boolean, true) into review_required
  from public.platform_settings where key = 'courses.require_review';
  review_required := coalesce(review_required, true);
  if new.status = 'published' and review_required
     and (tg_op = 'INSERT' or old.status is distinct from 'published')
     and coalesce(auth.role(), '') <> 'service_role'
     and not public.is_super_admin() then
    raise exception 'course_requires_admin_publication' using errcode='42501';
  end if;
  return new;
end $$;


-- Per-administrator permission grants. Super Admin is always the policy authority;
-- these grants let it delegate a limited set of operational capabilities explicitly.
create table if not exists public.permissions (
  key text primary key check (key ~ '^[a-z][a-z0-9_.-]{1,79}$'),
  name_en text not null,
  name_ar text not null,
  description text not null default '',
  created_at timestamptz not null default now()
);
create table if not exists public.user_permissions (
  user_id uuid not null references public.profiles(id) on delete cascade,
  permission_key text not null references public.permissions(key) on delete cascade,
  granted_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key(user_id, permission_key)
);
create index if not exists user_permissions_key_lookup on public.user_permissions(permission_key, user_id);
alter table public.permissions enable row level security;
alter table public.user_permissions enable row level security;
drop policy if exists "permissions super admin read" on public.permissions;
create policy "permissions super admin read" on public.permissions for select to authenticated using (public.is_super_admin());
drop policy if exists "user permissions super admin read" on public.user_permissions;
create policy "user permissions super admin read" on public.user_permissions for select to authenticated using (public.is_super_admin());
drop policy if exists "user permissions super admin manage" on public.user_permissions;
create policy "user permissions super admin manage" on public.user_permissions for all to authenticated using (public.is_super_admin()) with check (public.is_super_admin());
revoke insert, update, delete on table public.permissions, public.user_permissions from public, anon, authenticated;
grant select on table public.permissions, public.user_permissions to authenticated;
grant select, insert, update, delete on table public.permissions, public.user_permissions to service_role;

insert into public.permissions(key, name_en, name_ar, description) values
 ('users.manage_instructors', 'Manage students and instructors', 'إدارة الطلاب والمدرسين', 'Invite and manage non-administrator accounts and instructor approvals.'),
 ('courses.review', 'Review courses', 'مراجعة الكورسات', 'Approve, reject and archive instructor courses.'),
 ('categories.manage', 'Manage categories', 'إدارة التصنيفات', 'Create, rename, sort and remove course categories.'),
 ('audit.read', 'Read audit log', 'عرض سجل النشاط', 'View recent administrative audit events.')
on conflict (key) do update set name_en=excluded.name_en, name_ar=excluded.name_ar, description=excluded.description;

-- Preserve expected baseline work for existing admin accounts; Super Admins can refine grants later.
insert into public.user_permissions(user_id, permission_key)
select ur.user_id, p.key
from public.user_roles ur
cross join public.permissions p
where ur.role = 'admin'
  and p.key in ('users.manage_instructors','courses.review','categories.manage','audit.read')
on conflict (user_id, permission_key) do nothing;


-- Course ownership must mean ownership (or Super Admin), not simply being an ordinary admin.
-- Keep the existing overloads explicit so older installations don't create ambiguous calls.
create or replace function public.owns_course(_course_id uuid, _user_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select public.is_active_user(_user_id) and (
    public.is_super_admin()
    or (_user_id = auth.uid() and exists (
      select 1 from public.courses c where c.id = _course_id and c.owner_id = _user_id
    ))
  );
$$;
create or replace function public.owns_course(_course_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$ select public.owns_course(_course_id, auth.uid()) $$;
revoke all on function public.owns_course(uuid, uuid) from public, anon;
revoke all on function public.owns_course(uuid) from public, anon;
grant execute on function public.owns_course(uuid, uuid) to authenticated, service_role;
grant execute on function public.owns_course(uuid) to authenticated, service_role;

-- Existing policies used is_admin() as a broad bypass. Replace its zero-argument calls
-- inside RLS policies with is_super_admin(), so delegated admin permissions must go through
-- server routes that check user_permissions. The rewrite preserves policy names, roles,
-- commands, permissive/restrictive mode, and all non-admin predicates.
do $$
declare
  p record;
  new_qual text;
  new_check text;
  statement text;
begin
  for p in
    select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
    from pg_policies
    where schemaname = 'public'
      and (coalesce(qual, '') like '%is_admin()%'
        or coalesce(with_check, '') like '%is_admin()%')
  loop
    new_qual := case when p.qual is null then null else
      replace(replace(p.qual, 'public.is_admin()', 'public.is_super_admin()'), 'is_admin()', 'public.is_super_admin()') end;
    new_check := case when p.with_check is null then null else
      replace(replace(p.with_check, 'public.is_admin()', 'public.is_super_admin()'), 'is_admin()', 'public.is_super_admin()') end;

    execute format('drop policy %I on %I.%I', p.policyname, p.schemaname, p.tablename);
    statement := format('create policy %I on %I.%I as %s for %s to %s',
      p.policyname, p.schemaname, p.tablename, p.permissive, p.cmd,
      case when cardinality(p.roles) = 0 then 'public' else array_to_string(p.roles, ', ') end);
    if new_qual is not null then statement := statement || format(' using (%s)', new_qual); end if;
    if new_check is not null then statement := statement || format(' with check (%s)', new_check); end if;
    execute statement;
  end loop;
end $$;

-- A normal administrator may act through the permission-checked server API; it must not
-- use direct table access or trigger exceptions to bypass review/grade/media safeguards.
create or replace function public.guard_instructor_approval()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' and not public.is_super_admin() then
    if tg_op = 'INSERT' then new.is_approved := false;
    else new.is_approved := old.is_approved;
    end if;
  end if;
  return new;
end $$;

create or replace function public.guard_submission_grading_fields()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' and not public.is_super_admin() and not exists (
    select 1 from public.assignments a where a.id = new.assignment_id and public.owns_course(a.course_id)
  ) then
    if tg_op = 'INSERT' then
      new.grade := null; new.feedback := null; new.reviewed_at := null; new.reviewed_by := null;
    else
      new.grade := old.grade; new.feedback := old.feedback; new.reviewed_at := old.reviewed_at; new.reviewed_by := old.reviewed_by;
    end if;
  end if;
  return new;
end $$;

create or replace function public.guard_review_moderation()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' and not public.is_super_admin() then
    if tg_op = 'INSERT' then new.is_published := false;
    else new.is_published := old.is_published; new.user_id := old.user_id; new.course_id := old.course_id;
    end if;
  end if;
  return new;
end $$;

create or replace function public.guard_quiz_attempt_score()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' and not public.is_super_admin() and not exists (
    select 1 from public.quizzes q where q.id = new.quiz_id and public.owns_course(q.course_id)
  ) then
    new.score := null; new.passed := null; new.submitted_at := null;
  end if;
  return new;
end $$;

create or replace function public.guard_lesson_stream_state()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  -- This repository currently stores private video files in Cloudflare R2. Keep the old
  -- function name for schema compatibility, but do not require a legacy Cloudflare Stream UID.
  if coalesce(auth.role(), '') = 'service_role' or public.is_super_admin() then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.stream_uid is not null or new.r2_object_key is not null or new.r2_size_bytes is not null then
      raise exception 'lesson_media_fields_are_server_managed' using errcode = '42501';
    end if;
    new.processing_status := 'pending';
    new.is_published := false;
  else
    new.stream_uid := old.stream_uid;
    new.r2_object_key := old.r2_object_key;
    new.r2_size_bytes := old.r2_size_bytes;
    new.processing_status := old.processing_status;
    new.is_published := old.is_published;
  end if;
  return new;
end $$;

commit;
