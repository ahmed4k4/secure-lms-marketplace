-- Private HLS video processing and playback-security telemetry.
alter table public.lesson_videos
  add column if not exists processing_status text not null default 'queued'
    check (processing_status in ('queued','processing','ready','failed')),
  add column if not exists stream_manifest_key text,
  add column if not exists processing_error text,
  add column if not exists last_processed_at timestamptz;


create table if not exists public.video_upload_sessions (
  id uuid primary key default gen_random_uuid(),
  lesson_id uuid not null references public.lesson_videos(lesson_id) on delete cascade,
  object_key text not null,
  r2_upload_id text not null,
  created_by uuid not null references public.profiles(id) on delete cascade,
  expected_size bigint not null check (expected_size > 0),
  content_type text not null,
  status text not null default 'uploading' check (status in ('uploading','completed','aborted')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours')
);
create index if not exists video_upload_sessions_owner_idx on public.video_upload_sessions(created_by, created_at desc);
alter table public.video_upload_sessions enable row level security;
revoke all on public.video_upload_sessions from anon, authenticated;

create table if not exists public.video_transcode_jobs (
  id uuid primary key default gen_random_uuid(),
  lesson_id uuid not null references public.lesson_videos(lesson_id) on delete cascade,
  source_key text not null,
  output_prefix text not null,
  status text not null default 'queued' check (status in ('queued','processing','completed','failed')),
  attempts int not null default 0 check (attempts >= 0),
  last_error text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);
create unique index if not exists video_transcode_one_open_job_per_lesson
  on public.video_transcode_jobs(lesson_id) where status in ('queued','processing');
create index if not exists video_transcode_queue_idx
  on public.video_transcode_jobs(status, created_at) where status = 'queued';

-- Existing ready MP4s are intentionally queued for conversion too; they are not exposed directly to learners.
insert into public.video_transcode_jobs(lesson_id, source_key, output_prefix)
select lv.lesson_id, lv.object_key, 'hls/' || lv.lesson_id::text || '/' || gen_random_uuid()::text
from public.lesson_videos lv
where lv.status = 'ready'
  and lv.stream_manifest_key is null
  and not exists (select 1 from public.video_transcode_jobs j where j.lesson_id = lv.lesson_id and j.status in ('queued','processing'));

create or replace function public.claim_video_transcode_job()
returns setof public.video_transcode_jobs
language sql security definer set search_path = public as $$
  with next_job as (
    select id from public.video_transcode_jobs
    where status = 'queued' and attempts < 3
    order by created_at
    for update skip locked
    limit 1
  )
  update public.video_transcode_jobs j
  set status = 'processing', attempts = attempts + 1, started_at = now(), last_error = null
  from next_job n where j.id = n.id
  returning j.*;
$$;
revoke all on function public.claim_video_transcode_job() from public, anon, authenticated;
grant execute on function public.claim_video_transcode_job() to service_role;

create table if not exists public.playback_security_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  lesson_id uuid not null references public.lessons(id) on delete cascade,
  session_id text not null,
  event_type text not null check (event_type in ('print_screen_key','print_dialog_shortcut','capture_shortcut','tab_hidden','fullscreen_exit','picture_in_picture_attempt','copy_attempt')),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists playback_security_user_created_idx on public.playback_security_events(user_id, created_at desc);
create index if not exists playback_security_lesson_created_idx on public.playback_security_events(lesson_id, created_at desc);
alter table public.playback_security_events enable row level security;
revoke all on public.playback_security_events from anon, authenticated;

-- R2 objects stay private. The application signs each segment only after checking the learner session.
