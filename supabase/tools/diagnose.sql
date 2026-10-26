-- Run in the Supabase SQL editor. Expected: tables=5, roles seeded=4, functions lists all 5 names, trigger=1,
-- and (after repair) auth user / profile are ids and "roles of admin" contains super_admin.
select 'tables (expect 5)' as check, count(*)::text as value
  from information_schema.tables where table_schema = 'public' and table_name in ('profiles','roles','user_roles','courses','entitlements')
union all select 'roles seeded (expect 4)', count(*)::text from public.roles
union all select 'functions (expect 5)', coalesce(string_agg(proname, ', ' order by proname), 'NONE')
  from pg_proc where pronamespace = 'public'::regnamespace and proname in ('rate_limit_hit','has_permission','can_access_lesson','find_user_id_by_email','handle_new_user')
union all select 'signup trigger (expect 1)', count(*)::text from pg_trigger where tgname = 'on_auth_user_created'
union all select 'auth user', coalesce((select id::text from auth.users where lower(email) = 'admin@gmail.com'), 'MISSING')
union all select 'profile', coalesce((select id::text from public.profiles where id = (select id from auth.users where lower(email) = 'admin@gmail.com')), 'MISSING')
union all select 'roles of admin', coalesce((select string_agg(r.key, ', ') from public.user_roles ur join public.roles r on r.id = ur.role_id
  where ur.user_id = (select id from auth.users where lower(email) = 'admin@gmail.com')), 'NONE');
