# Recovering from a partially applied database schema

## Error: `42P07: relation "profiles" already exists`

The original schema used plain `CREATE TABLE public.profiles (...)`. PostgreSQL returns `42P07` when the same relation is created twice. A partial previous attempt may have left some objects in place.

### Safe recovery

1. Confirm the Supabase project/ref is the intended **development** database and take a backup before schema changes.
2. Use the updated `supabase/migrations/0001_initial_schema.sql` in this archive. Do not reuse an older copy of that file.
3. Run the entire updated migration in the SQL Editor. If you use Supabase CLI, first rename/copy it into a timestamp-prefixed migration recognized by the CLI and use only that migration path (do not also run it in SQL Editor). The updated SQL uses `CREATE TABLE IF NOT EXISTS`, guards duplicate enum types, replaces named policies/triggers, and adds required profile columns if missing.
4. If the migration raises an explicit compatibility error for `public.profiles.id` or fails because a pre-existing table has a different structure, stop and inspect the table. Do not drop the table or reset the database without a verified backup and a deliberate data-migration plan.
5. Verify the expected tables and RLS policies in Supabase Dashboard, then test with anonymous, student, instructor, and admin accounts.

This migration is repeat-safe for objects defined by this repository. `IF NOT EXISTS` cannot prove that a same-named table created by another application has the same schema; incompatible third-party schema must be reconciled explicitly.


## Error: `42725: function public.is_admin() is not unique`

This usually means an earlier schema attempt left both a zero-argument `public.is_admin()` and a `public.is_admin(uuid DEFAULT auth.uid())`. PostgreSQL cannot choose between those candidates for calls that omit the argument. Similar ambiguity can affect the `is_active_user` and `owns_course` helpers.

**Do not drop tables or functions with `CASCADE`.** Use the included `supabase/migrations/0003_fix_admin_function_overloads.sql`, which replaces the UUID-argument helpers without default arguments and restores explicit no-argument wrappers. Run that file by itself first to unblock a partially applied setup. Then rerun the corrected `0001_initial_schema.sql` to ensure policies and triggers were installed, apply `0002_cloudflare_r2_storage.sql`, then apply `0004_auth_database_security_repair.sql` (safe to rerun). The corrected `0001` also avoids default arguments on these overloaded functions for clean installs.

Verify signatures afterwards with:

```sql
select p.proname, pg_get_function_identity_arguments(p.oid) as arguments, pg_get_function_arguments(p.oid) as full_arguments
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname in ('is_admin', 'is_active_user', 'owns_course')
order by p.proname, arguments;
```

Expected: explicit zero-argument `is_admin()` and `is_active_user()`, `owns_course(uuid)`, and separate UUID-taking overloads with **no `DEFAULT` argument values**.


## Authentication provisioning permissions

The bootstrap script deliberately uses the server-only service-role key. Migration `0004_auth_database_security_repair.sql` grants that role the required privileges only on `profiles`, `user_roles`, and `audit_logs`; it does not disable RLS or grant privileges to ordinary users. Confirm the URL and service-role key belong to the same project. The script preserves existing profile status and roles, and refuses to promote an unconfirmed account. In resume mode, run it in an interactive terminal and type the exact confirmed email address.

## Quiz view security

Migration `0004` changes `quiz_question_catalog` to a security-invoker view, adds an RLS policy for published quizzes that the student is entitled to access, and revokes table-level SELECT on `questions` from browser roles before granting only safe question columns. The `correct_answer` column remains inaccessible to `anon` and `authenticated`.


## Public course catalog permission error

If the `/courses` page reports `course_catalog_query_failed`, apply `0005_public_course_catalog_grants.sql` after the earlier migrations. It grants browser roles access only to the catalog columns needed for published-course listing; existing row-level security still controls which course rows are visible. The application now logs the sanitized PostgREST error code, message, details, and hint in JSON so the actual database failure is visible in the Next.js server terminal.


## Error: `42501: permission denied for function is_admin`

This occurs when a row-level security policy calls `public.is_admin()` but the current Supabase API role does not have `EXECUTE` permission on that function. The public course catalog policy includes this predicate, so the catalog can fail even when the `courses` table and column grants are correct.

Apply `supabase/migrations/0006_restore_rls_helper_execute_grants.sql` in the Supabase SQL Editor after migrations `0001` through `0005`. It grants `EXECUTE` on the zero-argument `is_admin()` predicate to `anon`, `authenticated`, and `service_role`, and grants the other policy helper predicates only to signed-in users and `service_role`. It does not disable RLS, expose the quiz answer key, or broaden table-level access.

After applying the migration, retry `/ar/courses` (or `/en/courses`). If the error changes to a different function name, capture the exact new error rather than granting execution to every function in the schema.


## Error: `user_roles_query_failed` or admin console not loading

In v1.0.6, `getUserRoles()` is server-only and reads role rows with the Supabase service client after the session is verified by `auth.getUser()`. Confirm `.env.local` includes the correct `SUPABASE_SERVICE_ROLE_KEY` for the same `NEXT_PUBLIC_SUPABASE_URL` project. Never rename the service key to a `NEXT_PUBLIC_*` variable. If role permissions still fail, inspect the server terminal for the sanitized query diagnostic.

The new admin console requires `0007_admin_console_and_role_grants.sql` after `0001`–`0006`. This migration creates delegated permissions and `platform_settings`, adds explicit role-helper execution privileges, locks user-role/profile-status/catalog writes behind database privileges and RLS, and changes broad `is_admin()` RLS bypasses to the Super Admin-only predicate. Back up the target database and use a development/staging project first; the SQL was not executed against the user's live database by the archive-building environment.
