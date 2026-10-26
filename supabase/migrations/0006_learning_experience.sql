-- =====================================================================
-- 0006_learning_experience.sql
-- Course landing-page fields, Q&A discussions, private lesson notes, course announcements,
-- and a richer public catalog view (student count, total duration).
-- =====================================================================

-- ---------- Landing page content ----------
alter table public.courses
  add column outcomes     text[] not null default '{}' check (cardinality(outcomes) <= 12     and char_length(array_to_string(outcomes, '')) <= 3000),
  add column requirements text[] not null default '{}' check (cardinality(requirements) <= 12 and char_length(array_to_string(requirements, '')) <= 3000),
  add column audience     text[] not null default '{}' check (cardinality(audience) <= 12     and char_length(array_to_string(audience, '')) <= 3000);
grant insert (outcomes, requirements, audience) on public.courses to authenticated;
grant update (outcomes, requirements, audience) on public.courses to authenticated;

-- ---------- Q&A ----------
create table public.discussions (
  id          uuid primary key default gen_random_uuid(),
  course_id   uuid not null references public.courses(id) on delete cascade,
  lesson_id   uuid references public.lessons(id) on delete set null,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  title       text not null check (char_length(title) between 3 and 140),
  body        text not null check (char_length(body) between 1 and 4000),
  is_resolved boolean not null default false,
  created_at  timestamptz not null default now()
);
create index discussions_course_idx on public.discussions(course_id, created_at desc);
create index discussions_lesson_idx on public.discussions(lesson_id);

create table public.discussion_replies (
  id            uuid primary key default gen_random_uuid(),
  discussion_id uuid not null references public.discussions(id) on delete cascade,
  course_id     uuid not null references public.courses(id) on delete cascade,  -- synced by trigger
  user_id       uuid not null references public.profiles(id) on delete cascade,
  body          text not null check (char_length(body) between 1 and 4000),
  created_at    timestamptz not null default now()
);
create index discussion_replies_idx on public.discussion_replies(discussion_id, created_at);

create function public.reply_sync_course() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  select d.course_id into new.course_id from public.discussions d where d.id = new.discussion_id;
  if new.course_id is null then raise exception 'discussion_not_found'; end if;
  return new;
end $$;
create trigger replies_sync_course before insert on public.discussion_replies
  for each row execute function public.reply_sync_course();

-- ---------- Private notes (bookmarks with a timestamp) ----------
create table public.lesson_notes (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references public.profiles(id) on delete cascade,
  lesson_id        uuid not null references public.lessons(id) on delete cascade,
  course_id        uuid not null references public.courses(id) on delete cascade,  -- synced by trigger
  position_seconds int not null default 0 check (position_seconds between 0 and 86400),
  body             text not null check (char_length(body) between 1 and 2000),
  created_at       timestamptz not null default now()
);
create index lesson_notes_idx on public.lesson_notes(user_id, lesson_id, position_seconds);
create trigger notes_sync_course before insert on public.lesson_notes
  for each row execute function public.child_sync_course();

-- ---------- Announcements ----------
create table public.announcements (
  id         uuid primary key default gen_random_uuid(),
  course_id  uuid not null references public.courses(id) on delete cascade,
  author_id  uuid not null references public.profiles(id) on delete cascade,
  title      text not null check (char_length(title) between 1 and 120),
  body       text not null check (char_length(body) between 1 and 4000),
  created_at timestamptz not null default now()
);
create index announcements_course_idx on public.announcements(course_id, created_at desc);

-- ---------- RLS ----------
alter table public.discussions        enable row level security;
alter table public.discussion_replies enable row level security;
alter table public.lesson_notes       enable row level security;
alter table public.announcements      enable row level security;

grant select, delete on public.discussions to authenticated;
grant insert (course_id, lesson_id, user_id, title, body) on public.discussions to authenticated;
grant update (is_resolved) on public.discussions to authenticated;
create policy disc_read on public.discussions for select to authenticated
  using (public.can_manage_course(course_id) or public.has_course_access(course_id));
create policy disc_insert on public.discussions for insert to authenticated
  with check (user_id = auth.uid()
              and (public.can_manage_course(course_id) or public.has_course_access(course_id))
              and (lesson_id is null or public.lesson_course(lesson_id) = course_id));
create policy disc_update on public.discussions for update to authenticated
  using (user_id = auth.uid() or public.can_manage_course(course_id))
  with check (user_id = auth.uid() or public.can_manage_course(course_id));
create policy disc_delete on public.discussions for delete to authenticated
  using (user_id = auth.uid() or public.can_manage_course(course_id));

grant select, delete on public.discussion_replies to authenticated;
grant insert (discussion_id, user_id, body) on public.discussion_replies to authenticated;
create policy reply_read on public.discussion_replies for select to authenticated
  using (public.can_manage_course(course_id) or public.has_course_access(course_id));
create policy reply_insert on public.discussion_replies for insert to authenticated
  with check (user_id = auth.uid() and (public.can_manage_course(course_id) or public.has_course_access(course_id)));
create policy reply_delete on public.discussion_replies for delete to authenticated
  using (user_id = auth.uid() or public.can_manage_course(course_id));

grant select, delete on public.lesson_notes to authenticated;
grant insert (lesson_id, user_id, position_seconds, body) on public.lesson_notes to authenticated;
create policy notes_read on public.lesson_notes for select to authenticated using (user_id = auth.uid());
create policy notes_insert on public.lesson_notes for insert to authenticated
  with check (user_id = auth.uid() and public.can_access_lesson(lesson_id));
create policy notes_delete on public.lesson_notes for delete to authenticated using (user_id = auth.uid());

grant select, delete on public.announcements to authenticated;
grant insert (course_id, author_id, title, body) on public.announcements to authenticated;
create policy ann_read on public.announcements for select to authenticated
  using (public.can_manage_course(course_id) or public.has_course_access(course_id));
create policy ann_insert on public.announcements for insert to authenticated
  with check (author_id = auth.uid() and public.can_manage_course(course_id));
create policy ann_delete on public.announcements for delete to authenticated
  using (public.can_manage_course(course_id));

-- ---------- Public catalog (published courses only; aggregates are safe to expose) ----------
drop view public.course_catalog;
create view public.course_catalog as
  select c.id, c.slug, c.title, c.subtitle, c.language, c.level, c.access_type, c.status, c.published_at, c.updated_at,
         c.category_id, cat.slug as category_slug, cat.name_en as category_name_en, cat.name_ar as category_name_ar,
         c.created_by as owner_id, pi.full_name as owner_name,
         pp.amount_cents as price_cents, pp.currency,
         coalesce(r.avg_rating, 0) as rating_avg, coalesce(r.cnt, 0) as rating_count,
         coalesce(l.cnt, 0) as lesson_count, coalesce(l.total_seconds, 0) as total_duration_seconds,
         coalesce(e.cnt, 0) as student_count
  from public.courses c
  left join public.categories cat on cat.id = c.category_id
  left join public.public_instructors pi on pi.id = c.created_by
  left join lateral (
    select pl.amount_cents, pl.currency
    from public.products pr join public.pricing_plans pl on pl.product_id = pr.id
    where pr.course_id = c.id and pr.type = 'course' and pl.active and pl.kind = 'one_time'
    order by pl.created_at desc limit 1) pp on true
  left join lateral (
    select round(avg(rating)::numeric, 2) as avg_rating, count(*) as cnt
    from public.reviews where course_id = c.id and not is_hidden) r on true
  left join lateral (
    select count(*) as cnt, coalesce(sum(duration_seconds), 0)::int as total_seconds
    from public.lessons where course_id = c.id) l on true
  left join lateral (select count(*) as cnt from public.enrollments where course_id = c.id) e on true
  where c.status = 'published';
grant select on public.course_catalog to anon, authenticated;
