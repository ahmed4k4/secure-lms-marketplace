begin;

-- Migration 0014 changes the user_roles primary key to user_id so that an account
-- can have exactly one role. The original auth trigger targeted the old composite
-- (user_id, role) key; replace it before any new Auth account is created.
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles(id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', ''))
  on conflict (id) do nothing;

  insert into public.user_roles(user_id, role)
  values (new.id, 'student'::public.app_role)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

-- Reassert the trusted Auth trigger in case a prior manual edit removed it.
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_auth_user();

comment on function public.handle_new_auth_user() is
  'Creates a profile and one default student role after Supabase Auth user creation; role insert is compatible with the single-role user_id primary key.';

commit;
