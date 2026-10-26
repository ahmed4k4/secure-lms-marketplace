-- 0015_service_role_privileges.sql
-- The server-only Supabase service_role client bypasses RLS, but PostgreSQL
-- table privileges are still required. Earlier migrations granted privileges
-- to anon/authenticated selectively but did not explicitly grant service_role
-- access to all existing application tables. This caused admin pages to fail
-- with `permission denied for table profiles/courses` before RLS was evaluated.
--
-- This migration is intentionally restricted to service_role. Do NOT grant
-- these privileges to anon or authenticated, and never expose the service key
-- to a browser/client component.

GRANT USAGE ON SCHEMA public TO service_role;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO service_role;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role;

-- Keep privileges correct for tables/sequences/functions created by later
-- migrations executed by the usual Supabase postgres owner.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT ALL PRIVILEGES ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO service_role;

-- RLS remains enabled and unchanged. service_role has bypassrls by design;
-- app code must still authorize the current user before using admin client.
