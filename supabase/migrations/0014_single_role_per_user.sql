begin;

-- Normalize historic accounts to exactly one role, preserving the strongest role.
with ranked as (
  select ctid, row_number() over (
    partition by user_id
    order by case role
      when 'super_admin' then 1
      when 'admin' then 2
      when 'instructor' then 3
      when 'student' then 4
      else 5 end, created_at asc
  ) as rn
  from public.user_roles
)
delete from public.user_roles target
using ranked
where target.ctid = ranked.ctid and ranked.rn > 1;

alter table public.user_roles drop constraint if exists user_roles_pkey;
alter table public.user_roles add constraint user_roles_pkey primary key (user_id);

-- Repair older Auth accounts whose role row was missing; student is the least-privileged safe default.
insert into public.user_roles(user_id, role)
select p.id, 'student'::public.app_role
from public.profiles p
where not exists (select 1 from public.user_roles r where r.user_id = p.id)
on conflict (user_id) do nothing;
comment on table public.user_roles is 'Exactly one platform role per account. Administrator permissions remain separately scoped in user_permissions.';
commit;
