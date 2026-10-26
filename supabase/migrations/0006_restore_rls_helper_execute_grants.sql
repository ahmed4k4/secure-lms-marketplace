-- Restore the minimum function EXECUTE grants required by the RLS policies and the
-- student/instructor views when database-level default privileges are restrictive.
-- This does NOT disable RLS or grant table access. The functions are explicit,
-- SECURITY DEFINER predicates that return authorization decisions only.
begin;

-- The public courses SELECT policy calls is_admin() even for anonymous catalog reads.
grant execute on function public.is_admin() to anon, authenticated, service_role;

-- These helpers are called directly by authenticated-user RLS policies and the
-- security-invoker quiz catalog. Keep them unavailable to anonymous callers.
grant execute on function public.is_active_user(uuid) to authenticated, service_role;
grant execute on function public.has_role(uuid, public.app_role) to authenticated, service_role;
grant execute on function public.owns_course(uuid) to authenticated, service_role;
grant execute on function public.has_active_entitlement(uuid, uuid) to authenticated, service_role;

commit;
