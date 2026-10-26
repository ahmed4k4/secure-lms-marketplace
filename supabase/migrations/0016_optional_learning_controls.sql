-- Optional instructor-controlled access windows and assessment timers.
-- These controls are disabled by default to preserve existing course behavior.
alter table public.lessons
  add column if not exists availability_starts_at timestamptz,
  add column if not exists availability_ends_at timestamptz,
  add column if not exists max_watch_minutes integer check (max_watch_minutes is null or max_watch_minutes between 1 and 1440),
  add column if not exists watermark_enabled boolean not null default true,
  add column if not exists seek_allowed boolean not null default true;

alter table public.quizzes
  add column if not exists duration_minutes integer check (duration_minutes is null or duration_minutes between 1 and 600),
  add column if not exists question_time_seconds integer check (question_time_seconds is null or question_time_seconds between 5 and 3600),
  add column if not exists shuffle_questions boolean not null default false,
  add column if not exists shuffle_options boolean not null default false,
  add column if not exists attempts_limit integer check (attempts_limit is null or attempts_limit between 1 and 100),
  add column if not exists available_from timestamptz,
  add column if not exists available_until timestamptz;

alter table public.assignments
  add column if not exists duration_minutes integer check (duration_minutes is null or duration_minutes between 1 and 10080),
  add column if not exists available_from timestamptz,
  add column if not exists available_until timestamptz,
  add column if not exists allow_late_submission boolean not null default true,
  add column if not exists allowed_file_types text[] not null default array[]::text[];

create index if not exists lessons_availability_idx on public.lessons (availability_starts_at, availability_ends_at);
create index if not exists quizzes_availability_idx on public.quizzes (available_from, available_until);
create index if not exists assignments_availability_idx on public.assignments (available_from, available_until, due_at);
