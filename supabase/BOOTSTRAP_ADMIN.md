# Create the first Super Admin account

The application deliberately has **no public Super Admin registration endpoint**. The first platform administrator must be provisioned by the trusted project operator. The supplied script creates the account in Supabase Auth and assigns the `super_admin` role.

## Recommended: create the account with the included script

1. Apply the database migrations in `supabase/migrations`. If the existing database currently fails with `function public.is_admin() is not unique`, run `0003_fix_admin_function_overloads.sql` by itself first, then rerun the corrected `0001_initial_schema.sql` and `0002_cloudflare_r2_storage.sql`; then apply `0003_fix_admin_function_overloads.sql`, `0004_auth_database_security_repair.sql`, and `0005_public_course_catalog_grants.sql` in order. If `0001` and `0002` already completed successfully, apply `0003`, then `0004`, then `0005`.
2. Copy `.env.example` to `.env.local`. Set `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (server-side only), then set `BOOTSTRAP_SUPER_ADMIN_EMAIL`, `BOOTSTRAP_SUPER_ADMIN_PASSWORD` (unique and at least 16 characters), and `BOOTSTRAP_SUPER_ADMIN_NAME`. Never commit `.env.local`.
3. Run `npm install`, then `npm run bootstrap:super-admin`. The script creates a confirmed Supabase Auth user, creates a missing profile without overwriting an existing profile, preserves current profile status and role assignments, adds `super_admin` idempotently, verifies the role, and attempts to write an audit record.
4. Sign in at `/ar/sign-in` or `/en/sign-in`. Remove `BOOTSTRAP_SUPER_ADMIN_PASSWORD` from `.env.local` immediately after success and keep the service-role key private.

## If the script created the Auth user but failed before role assignment

Verify in Supabase Dashboard → Authentication → Users that the exact email is yours. Keep the service-role key private, set the same `BOOTSTRAP_SUPER_ADMIN_EMAIL`, and run the explicit resume command:

```bash
npm run bootstrap:super-admin:resume
```

Resume mode requires the existing Auth email to be confirmed and asks you to type the exact email interactively. It does not overwrite profile status or delete existing roles. The password is not used in resume mode; after a successful bootstrap, the script clears it from `.env.local` automatically.

## Trusted SQL alternative (only if CLI is unavailable)

Use this only in Supabase SQL Editor while signed in as a trusted project owner. First verify the user UUID in Authentication → Users and verify the account is yours. This preserves an existing profile's status and existing role assignments; it only creates a profile if missing and adds the privileged role idempotently.

```sql
do $$
declare
  target_user_id uuid := 'PASTE_AUTH_USER_UUID_HERE'::uuid;
begin
  if not exists (select 1 from auth.users where id = target_user_id and email_confirmed_at is not null) then
    raise exception 'No confirmed Supabase Auth user exists for this UUID';
  end if;

  insert into public.profiles (id, display_name, status)
  select u.id, coalesce(nullif(u.raw_user_meta_data->>'display_name',''), 'Platform Super Administrator'), 'active'
  from auth.users u where u.id = target_user_id
  on conflict (id) do nothing;

  if not exists (select 1 from public.profiles where id = target_user_id and status = 'active') then
    raise exception 'Existing profile is not active; review it manually without overwriting its status';
  end if;

  insert into public.user_roles (user_id, role)
  values (target_user_id, 'super_admin')
  on conflict (user_id, role) do nothing;

  insert into public.audit_logs (actor_id, action, target_type, target_id, metadata)
  values (target_user_id, 'platform.bootstrap_super_admin', 'profile', target_user_id::text, jsonb_build_object('source','trusted_sql_bootstrap'));
end $$;
```

Do not run the SQL for a UUID unless you have verified that it belongs to your account. Keep SQL Editor access restricted to trusted operators.


## Admin console prerequisite

After the initial database migrations `0001` through `0006`, apply `0007_admin_console_and_role_grants.sql` from a backed-up development/staging project before using `/ar/admin` or `/en/admin`. It creates the delegated permission tables and platform settings used by the console. Confirm `SUPABASE_SERVICE_ROLE_KEY` belongs to the same project as `NEXT_PUBLIC_SUPABASE_URL`; it must remain server-only.


After the previous migration set, also apply `0012_category_requests.sql` to enable instructor-proposed categories and admin approval.
