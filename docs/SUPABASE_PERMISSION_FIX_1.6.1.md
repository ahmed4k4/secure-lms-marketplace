# Supabase table permission fix — 1.6.1

## Symptoms addressed

- `profiles: permission denied for table profiles`
- `permission denied for table courses`
- Admin user/instructor directory and overview failing when they use the server-only service-role client.

## Root cause

`service_role` bypasses Row Level Security, but RLS bypass does not replace PostgreSQL table/schema privileges. The existing migration set enabled RLS and granted selected privileges to `anon`/`authenticated`, but did not explicitly grant the service role access to every application table/sequence/function. The admin pages therefore failed at the PostgreSQL privilege layer.

## Required database step

Apply `supabase/migrations/0015_service_role_privileges.sql` to the **same Supabase project used by the deployment**. Recommended: stage first, then deploy using `supabase db push`; if CLI migration history is not configured, inspect and run the new migration once in Supabase SQL Editor. Do not rerun or edit older applied migrations and do not drop tables.

After applying, verify in SQL Editor:

```sql
select
  has_table_privilege('service_role', 'public.profiles', 'select') as service_can_select_profiles,
  has_table_privilege('service_role', 'public.profiles', 'insert') as service_can_insert_profiles,
  has_table_privilege('service_role', 'public.courses', 'select') as service_can_select_courses;
```

All three values should be `true`.

## Deployment environment check

Confirm `SUPABASE_SERVICE_ROLE_KEY` in the server environment is the **service_role secret key for the same Supabase project** as `NEXT_PUBLIC_SUPABASE_URL`. Do not use `NEXT_PUBLIC_SUPABASE_ANON_KEY` for it. Update Production and Preview separately, then redeploy/restart. Never paste the key into chat or commit it.

## Security

The migration does not disable RLS and does not grant broad table privileges to `anon` or `authenticated`. It grants database privileges only to `service_role`. Keep that key server-only and keep explicit role/permission checks before every privileged admin operation.
