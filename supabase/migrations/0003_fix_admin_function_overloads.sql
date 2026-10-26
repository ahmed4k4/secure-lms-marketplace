-- Repair ambiguous auth helper overloads on databases that already have an older
-- public.is_admin() plus public.is_admin(uuid DEFAULT auth.uid()). This migration
-- is repeat-safe, removes DEFAULT arguments from parameterized helper signatures,
-- and restores explicit zero-argument wrappers. It never drops tables or user data.
-- Apply this immediately to repair an existing `function public.is_admin() is not unique`
-- error, then re-run the corrected 0001 migration if its policies were not all created.

begin;

create or replace function public.is_admin(_user_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select
    (_user_id = auth.uid() or exists (
      select 1 from public.profiles me
      join public.user_roles mr on mr.user_id = me.id
      where me.id = auth.uid() and me.status = 'active'
        and mr.role in ('super_admin', 'admin')
    ))
    and exists (select 1 from public.profiles pr where pr.id = _user_id and pr.status = 'active')
    and exists (select 1 from public.user_roles ur where ur.user_id = _user_id and ur.role in ('super_admin', 'admin'));
$$;

create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public
as $$ select public.is_admin(auth.uid()) $$;

create or replace function public.is_active_user(_user_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select (_user_id = auth.uid() or public.is_admin(auth.uid()))
    and exists (select 1 from public.profiles where id = _user_id and status = 'active');
$$;

create or replace function public.is_active_user()
returns boolean
language sql stable security definer set search_path = public
as $$ select public.is_active_user(auth.uid()) $$;

create or replace function public.owns_course(_course_id uuid, _user_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select (_user_id = auth.uid() or public.is_admin(auth.uid()))
    and public.is_active_user(_user_id)
    and (exists (select 1 from public.courses where id = _course_id and owner_id = _user_id)
      or public.is_admin(_user_id));
$$;

create or replace function public.owns_course(_course_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$ select public.owns_course(_course_id, auth.uid()) $$;

comment on function public.is_admin() is 'Explicit current-user admin predicate; kept separate from the UUID overload to avoid default-argument ambiguity.';
comment on function public.is_admin(uuid) is 'Checks an explicit target user UUID; has no default argument by design.';

commit;
