-- =====================================================================
-- 0005_admin_helpers.sql — service-role-only lookups into auth.users
-- (emails live in the auth schema and are never exposed to clients)
-- =====================================================================
create function public.find_user_id_by_email(p_email text) returns uuid
language sql stable security definer set search_path = public, auth as $$
  select id from auth.users where lower(email) = lower(trim(p_email)) limit 1
$$;

create function public.user_emails(p_ids uuid[]) returns table (id uuid, email text)
language sql stable security definer set search_path = public, auth as $$
  select u.id, u.email::text from auth.users u where u.id = any(p_ids)
$$;

revoke execute on function public.find_user_id_by_email(text), public.user_emails(uuid[]) from public, anon, authenticated;
grant  execute on function public.find_user_id_by_email(text), public.user_emails(uuid[]) to service_role;
