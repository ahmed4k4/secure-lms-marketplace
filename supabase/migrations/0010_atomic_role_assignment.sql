-- Change a user's single platform role atomically; service-role writes are not exposed to the browser.
begin;

create or replace function public.set_platform_role(p_user_id uuid, p_role text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role_id uuid;
  v_old_role text;
begin
  if auth.uid() is null or not public.has_permission('admins.manage') then
    raise exception 'permission_denied' using errcode = '42501';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'cannot_change_own_role' using errcode = '42501';
  end if;
  if p_role not in ('student','instructor','admin') then
    raise exception 'invalid_platform_role' using errcode = '22023';
  end if;
  if not exists (select 1 from public.profiles p where p.id = p_user_id) then
    raise exception 'user_not_found' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.user_roles ur join public.roles r on r.id = ur.role_id where ur.user_id = p_user_id and r.key = 'super_admin') then
    raise exception 'cannot_change_super_admin_role' using errcode = '42501';
  end if;

  select r.key into v_old_role
  from public.user_roles ur join public.roles r on r.id = ur.role_id
  where ur.user_id = p_user_id limit 1;
  select id into v_role_id from public.roles where key = p_role;
  if v_role_id is null then raise exception 'role_not_found' using errcode = 'P0002'; end if;

  delete from public.user_roles where user_id = p_user_id;
  insert into public.user_roles(user_id, role_id, granted_by) values (p_user_id, v_role_id, auth.uid());

  if p_role = 'instructor' then
    insert into public.instructor_profiles(user_id, status)
    values (p_user_id, 'active')
    on conflict (user_id) do update set status = 'active';
  elsif v_old_role = 'instructor' then
    update public.instructor_profiles set status = 'suspended' where user_id = p_user_id;
  end if;

  return jsonb_build_object('user_id', p_user_id, 'old_role', v_old_role, 'new_role', p_role);
end;
$$;
revoke all on function public.set_platform_role(uuid, text) from public, anon;
grant execute on function public.set_platform_role(uuid, text) to authenticated, service_role;
comment on function public.set_platform_role(uuid, text) is 'Atomically replaces the one platform role for a user; Super Admin assignment is reserved for the bootstrap process.';
commit;
