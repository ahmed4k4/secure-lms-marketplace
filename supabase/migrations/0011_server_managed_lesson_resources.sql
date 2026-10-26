-- Prevent browser clients from forging private storage paths or mutating attachment metadata.
-- Reads remain subject to the existing entitlement/owner RLS policies.
begin;

revoke all on table public.lesson_resources from public, anon, authenticated;
grant select on table public.lesson_resources to authenticated;
grant all on table public.lesson_resources to service_role;

create or replace function public.guard_lesson_resource_server_mutations()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'lesson_resource_metadata_is_server_managed' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists lesson_resources_server_write_guard on public.lesson_resources;
create trigger lesson_resources_server_write_guard
before insert or update or delete on public.lesson_resources
for each row execute procedure public.guard_lesson_resource_server_mutations();

comment on table public.lesson_resources is 'Attachment metadata for private R2 objects. Browser roles have read access subject to RLS; writes are server-managed.';
commit;
