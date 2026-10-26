begin;

-- Switch all new video lesson uploads and playback to private Cloudflare R2.
-- Public cover images live in a separate bucket so the private media bucket is never exposed.
-- Safe to apply after 0008_stream_video_pricing_workflows.sql. Legacy Stream columns/rows are retained.

alter table public.r2_uploads drop constraint if exists r2_uploads_purpose_check;
alter table public.r2_uploads add constraint r2_uploads_purpose_check
  check (purpose in ('video','resource','cover'));

alter table public.r2_uploads drop constraint if exists r2_upload_target_check;
alter table public.r2_uploads add constraint r2_upload_target_check check (
  (purpose = 'video' and lesson_id is null and section_id is not null)
  or (purpose = 'resource' and lesson_id is not null and section_id is not null)
  or (purpose = 'cover' and lesson_id is null and section_id is null)
);

alter table public.r2_uploads drop constraint if exists r2_upload_resource_state_check;
alter table public.r2_uploads add constraint r2_upload_resource_state_check check (
  (purpose = 'resource' and status in ('pending','complete','expired'))
  or (purpose = 'video' and status in ('pending','uploaded','claimed','expired'))
  or (purpose = 'cover' and status in ('pending','complete','expired'))
);

create index if not exists r2_uploads_claimed_lesson_idx
  on public.r2_uploads(claimed_lesson_id) where claimed_lesson_id is not null;
create index if not exists r2_uploads_cover_cleanup_idx
  on public.r2_uploads(uploader_id, created_at desc) where purpose = 'cover';

comment on table public.r2_uploads is 'Server-owned R2 upload intents. Video/resource objects use a private bucket; public course covers use a separate public covers bucket.';
comment on column public.lessons.r2_object_key is 'Private R2 object key for uploaded lesson video; never directly exposed as a public URL.';

-- Application writes media fields only via the server-only service role. Keep browser-side writes blocked.
revoke insert, update, delete on table public.r2_uploads from public, anon, authenticated;
grant all on table public.r2_uploads to service_role;
revoke insert, update on table public.lessons from anon, authenticated;
grant insert(section_id,title_en,title_ar,kind,body_en,body_ar,is_preview,sort_order) on public.lessons to authenticated;
grant update(title_en,title_ar,body_en,body_ar,is_preview,sort_order) on public.lessons to authenticated;

commit;
