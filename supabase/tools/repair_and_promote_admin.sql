-- Idempotent repair + promotion. Run in the Supabase SQL editor AFTER migrations 0001-0005 are applied.
-- Change the e-mail below if needed. The auth user must already exist (Authentication > Users > Add user, tick "Auto Confirm User").

-- 1) every auth user gets a profile and the student role (fixes users created before the migrations)
insert into public.profiles (id, full_name)
select u.id, coalesce(left(u.raw_user_meta_data ->> 'full_name', 120), '') from auth.users u
on conflict (id) do nothing;

insert into public.user_roles (user_id, role_id)
select p.id, r.id from public.profiles p cross join public.roles r
where r.key = 'student' and not exists (select 1 from public.user_roles ur where ur.user_id = p.id and ur.role_id = r.id);

-- 2) promote to super admin
update public.profiles set full_name = 'Platform Super Administrator'
 where id = (select id from auth.users where lower(email) = 'admin@gmail.com') and full_name = '';

insert into public.user_roles (user_id, role_id)
select u.id, r.id from auth.users u join public.roles r on r.key = 'super_admin'
where lower(u.email) = 'admin@gmail.com'
on conflict do nothing;

-- 3) OPTIONAL: set the password directly (only if you cannot reset it in the dashboard). 12345678 is weak: local testing only.
-- update auth.users
--    set encrypted_password = extensions.crypt('12345678', extensions.gen_salt('bf')),
--        email_confirmed_at = coalesce(email_confirmed_at, now()), updated_at = now()
--  where lower(email) = 'admin@gmail.com';

-- 4) The application intentionally has no MFA feature. Keep exactly one role per user.
-- Apply migrations 0007+ to drop legacy MFA gates and enforce user_roles_one_role_per_user.

-- 5) refresh the API schema cache (fixes "could not find the function ... in the schema cache")
notify pgrst, 'reload schema';
