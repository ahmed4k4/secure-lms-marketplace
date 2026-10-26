-- 0014_performance_indexes.sql
-- Target high-frequency patterns observed in the header, catalog filters and instructor Q&A.
-- All indexes are additive and safe to run once on an existing installation.

-- The global header only needs to know whether one unread notification exists.
create index if not exists notifications_unread_user_created_idx
  on public.notifications(user_id, created_at desc) where read_at is null;

-- Help the common catalog filters while preserving the existing status/published index.
create index if not exists courses_published_language_level_idx
  on public.courses(language, level, published_at desc) where status = 'published';
create index if not exists courses_published_access_language_idx
  on public.courses(access_type, language, published_at desc) where status = 'published';

-- Q&A sorts by resolution status and most-recent activity in instructor dashboards.
create index if not exists discussions_course_resolved_created_idx
  on public.discussions(course_id, is_resolved, created_at desc);

comment on index public.notifications_unread_user_created_idx is
  'Speeds the one-row unread notification probe in the global site header.';
comment on index public.courses_published_language_level_idx is
  'Supports public catalog language/level filters and newest-first ordering.';
comment on index public.courses_published_access_language_idx is
  'Supports public catalog access type/language filters and newest-first ordering.';
comment on index public.discussions_course_resolved_created_idx is
  'Supports instructor Q&A ordered by resolution state and creation time.';
