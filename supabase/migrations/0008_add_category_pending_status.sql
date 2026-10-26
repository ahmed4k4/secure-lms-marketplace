-- Isolated migration because PostgreSQL requires a new enum value to commit before use.
alter type public.course_status add value if not exists 'category_pending';
