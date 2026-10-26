-- Cloudflare R2 private media migration.
-- Safe to rerun. Apply after 0001_initial_schema.sql; it never drops existing user data.

alter table public.lessons add column if not exists r2_object_key text;
alter table public.lessons add column if not exists r2_size_bytes bigint;

create unique index if not exists lessons_r2_object_key_unique
  on public.lessons(r2_object_key) where r2_object_key is not null;

create table if not exists public.r2_uploads (
  id uuid primary key default gen_random_uuid(),
  uploader_id uuid not null references public.profiles(id) on delete cascade,
  purpose text not null check (purpose in ('video','resource')),
  lesson_id uuid references public.lessons(id) on delete cascade,
  section_id uuid references public.sections(id) on delete cascade,
  object_key text not null unique,
  title text not null,
  original_filename text not null,
  content_type text not null,
  expected_size_bytes bigint not null check (expected_size_bytes > 0),
  status text not null default 'pending' check (status in ('pending','uploaded','claimed','complete','expired')),
  expires_at timestamptz not null,
  claimed_lesson_id uuid unique references public.lessons(id) on delete set null,
  resource_id uuid references public.lesson_resources(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint r2_upload_target_check check (
    (purpose = 'video' and lesson_id is null and section_id is not null)
    or (purpose = 'resource' and lesson_id is not null and section_id is not null)
  ),
  constraint r2_upload_resource_state_check check (
    (purpose = 'resource' and status in ('pending','complete','expired'))
    or (purpose = 'video' and status in ('pending','uploaded','claimed','expired'))
  )
);

create index if not exists r2_uploads_owner_expiry_idx on public.r2_uploads(uploader_id, status, expires_at);
create index if not exists r2_uploads_lesson_idx on public.r2_uploads(lesson_id) where lesson_id is not null;
-- R2 object keys use the lms/ prefix. Do not impose uniqueness on legacy storage rows from older integrations.
drop index if exists public.lesson_resources_storage_path_unique;
create unique index if not exists lesson_resources_storage_path_unique
  on public.lesson_resources(storage_path) where storage_path like 'lms/%';

alter table public.r2_uploads enable row level security;
-- Upload intents contain private object keys and are accessed only through trusted server routes.
revoke all on table public.r2_uploads from anon, authenticated;
grant all on table public.r2_uploads to service_role;

-- Replace the legacy Stream-only guard while preserving the critical lesson-publication rule.
-- Non-admin browser sessions may create a draft lesson but cannot supply a media key, stream UID,
-- or processing state. Trusted server-role writes attach the verified R2 key after upload completion.
create or replace function public.guard_lesson_stream_state()
returns trigger language plpgsql security definer set search_path=public
as $$
begin
  if coalesce(auth.role(),'') = 'service_role' or public.is_admin() then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.stream_uid is not null or new.r2_object_key is not null or new.r2_size_bytes is not null then
      raise exception 'lesson_media_fields_are_server_managed' using errcode='42501';
    end if;
    new.processing_status := 'pending';
    new.is_published := false;
  else
    new.stream_uid := old.stream_uid;
    new.r2_object_key := old.r2_object_key;
    new.r2_size_bytes := old.r2_size_bytes;
    new.processing_status := old.processing_status;
    new.is_published := old.is_published;
  end if;
  return new;
end $$;

create or replace function public.guard_lesson_media_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    if tg_op = 'INSERT' then
      if new.stream_uid is not null
        or new.r2_object_key is not null
        or new.r2_size_bytes is not null
        or new.processing_status <> 'pending' then
        raise exception 'lesson_media_fields_are_server_managed' using errcode = '42501';
      end if;
    else
      if new.stream_uid is distinct from old.stream_uid
        or new.r2_object_key is distinct from old.r2_object_key
        or new.r2_size_bytes is distinct from old.r2_size_bytes
        or new.processing_status is distinct from old.processing_status then
        raise exception 'lesson_media_fields_are_server_managed' using errcode = '42501';
      end if;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists lessons_guard_media_fields on public.lessons;
create trigger lessons_guard_media_fields
before insert or update on public.lessons
for each row execute procedure public.guard_lesson_media_fields();

-- Remove the old Stream upload permissions; legacy rows/tables are retained rather than deleted.
revoke insert, update on public.stream_uploads from anon, authenticated;
revoke insert, update on public.lessons from anon, authenticated;
grant insert(section_id,title_en,title_ar,kind,body_en,body_ar,is_preview,sort_order) on public.lessons to authenticated;
grant update(title_en,title_ar,body_en,body_ar,is_preview,sort_order) on public.lessons to authenticated;

comment on table public.r2_uploads is 'Private server-owned R2 upload intents; never expose object keys as public URLs.';
comment on column public.lessons.r2_object_key is 'Private R2 object key; browser clients may not write this field directly.';
