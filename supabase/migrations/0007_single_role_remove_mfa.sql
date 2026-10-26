-- Consolidate role assignment to exactly one platform role per account and remove MFA gates.
-- Safe for installations that already applied migrations 0001-0006 with the older policy.
begin;

-- Preserve the strongest historic role if an account previously had several assignments.
with ranked as (
  select ur.ctid,
         row_number() over (
           partition by ur.user_id
           order by case r.key
             when 'super_admin' then 1
             when 'admin' then 2
             when 'instructor' then 3
             when 'student' then 4
             else 5 end,
             ur.created_at asc
         ) as rn
  from public.user_roles ur
  join public.roles r on r.id = ur.role_id
)
delete from public.user_roles target
using ranked
where target.ctid = ranked.ctid and ranked.rn > 1;

create unique index if not exists user_roles_one_role_per_user on public.user_roles(user_id);

-- Repair users that predate the signup trigger. Student is the least-privileged default.
insert into public.user_roles(user_id, role_id)
select p.id, r.id
from public.profiles p
cross join public.roles r
where r.key = 'student'
  and not exists (select 1 from public.user_roles ur where ur.user_id = p.id)
on conflict (user_id) do nothing;

-- Drop the legacy security gate before removing the column it depended on.
create or replace function public.has_permission(p_perm text) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_account_active() and exists (
    select 1
    from public.user_roles ur join public.roles r on r.id = ur.role_id
    where ur.user_id = auth.uid()
      and (r.key = 'super_admin'
           or exists (select 1 from public.role_permissions rp where rp.role_id = r.id and rp.permission_key = p_perm))
  )
$$;

drop function if exists public.admin_mfa_ok();
alter table public.roles drop column if exists is_privileged;
delete from public.platform_settings where key = 'require_admin_mfa';

comment on table public.user_roles is 'Exactly one platform role per account; fine-grained administrator permissions remain in role_permissions.';
comment on function public.has_permission(text) is 'Checks active account and permission assignment without a second-factor requirement.';
commit;
