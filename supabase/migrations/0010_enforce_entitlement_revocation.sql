-- Require an active entitlement rather than a possibly stale enrollment row for protected learning data.
-- Enrollment rows are retained for reporting/history, but do not independently grant access after an entitlement is revoked or expires.
begin;

-- Lesson body/metadata remains visible to an owner/admin, or to learners for published previews / active course entitlements.
drop policy if exists "lessons read published or owner" on public.lessons;
create policy "lessons read published or owner" on public.lessons for select using (
  exists (
    select 1 from public.sections s join public.courses c on c.id = s.course_id
    where s.id = section_id and (
      (c.status = 'published' and is_published and (
        is_preview or (public.is_active_user(auth.uid()) and public.has_active_entitlement(auth.uid(), c.id))
      ))
      or c.owner_id = auth.uid()
      or public.is_admin()
    )
  )
);

-- Protected attachments use the same entitlement check as playback URL issuance.
drop policy if exists "resources enrolled or owner read" on public.lesson_resources;
create policy "resources enrolled or owner read" on public.lesson_resources for select to authenticated using (
  exists (
    select 1 from public.lessons l join public.sections s on s.id = l.section_id
    where l.id = lesson_id and (
      public.owns_course(s.course_id)
      or (public.is_active_user(auth.uid()) and public.has_active_entitlement(auth.uid(), s.course_id))
    )
  )
);

-- A learner whose access has ended cannot continue changing progress on paid content.
drop policy if exists "progress self manage" on public.lesson_progress;
create policy "progress self manage" on public.lesson_progress for all to authenticated
  using (user_id = auth.uid() and public.is_active_user(auth.uid()) and exists (
    select 1 from public.lessons l join public.sections s on s.id = l.section_id join public.courses c on c.id = s.course_id
    where l.id = lesson_id and c.status = 'published' and l.is_published
      and (l.is_preview or public.has_active_entitlement(auth.uid(), c.id))
  ))
  with check (user_id = auth.uid() and public.is_active_user(auth.uid()) and exists (
    select 1 from public.lessons l join public.sections s on s.id = l.section_id join public.courses c on c.id = s.course_id
    where l.id = lesson_id and c.status = 'published' and l.is_published
      and (l.is_preview or public.has_active_entitlement(auth.uid(), c.id))
  ));

-- Quiz metadata and question prompts cannot be accessed on the strength of a stale enrollment row.
drop policy if exists "quizzes published or owner read" on public.quizzes;
create policy "quizzes published or owner read" on public.quizzes for select to authenticated using (
  public.owns_course(course_id)
  or (is_published and public.is_active_user(auth.uid()) and exists (
    select 1 from public.courses c where c.id = course_id and c.status = 'published'
      and public.has_active_entitlement(auth.uid(), c.id)
  ))
);

drop policy if exists "quiz attempts enrolled insert" on public.quiz_attempts;
drop policy if exists "quiz attempts self insert" on public.quiz_attempts;
create policy "quiz attempts enrolled insert" on public.quiz_attempts for insert to authenticated with check (
  user_id = auth.uid() and public.is_active_user(auth.uid()) and exists (
    select 1 from public.quizzes q where q.id = quiz_id and q.is_published and (
      public.owns_course(q.course_id) or public.has_active_entitlement(auth.uid(), q.course_id)
    )
  )
);

drop policy if exists "questions student enrolled read" on public.questions;
create policy "questions student enrolled read" on public.questions for select to authenticated using (
  exists (
    select 1 from public.quizzes z join public.courses c on c.id = z.course_id
    where z.id = questions.quiz_id and z.is_published and c.status = 'published'
      and public.is_active_user(auth.uid()) and public.has_active_entitlement(auth.uid(), z.course_id)
  )
);
create or replace view public.quiz_question_catalog
with (security_barrier = true, security_invoker = true) as
select q.id, q.quiz_id, q.prompt_en, q.prompt_ar, q.question_type, q.options, q.points, q.sort_order
from public.questions q
join public.quizzes z on z.id = q.quiz_id
join public.courses c on c.id = z.course_id
where public.owns_course(z.course_id) or (
  z.is_published and c.status = 'published' and public.is_active_user(auth.uid())
  and public.has_active_entitlement(auth.uid(), z.course_id)
);

-- Assignments are protected learning content; expired/revoked entitlements do not continue to grant reads.
drop policy if exists "assignments enrolled or owner read" on public.assignments;
create policy "assignments enrolled or owner read" on public.assignments for select to authenticated using (
  public.owns_course(course_id)
  or (public.is_active_user(auth.uid()) and public.has_active_entitlement(auth.uid(), course_id))
);

drop policy if exists "submissions enrolled insert" on public.submissions;
drop policy if exists "submissions student insert" on public.submissions;
create policy "submissions enrolled insert" on public.submissions for insert to authenticated with check (
  student_id = auth.uid() and public.is_active_user(auth.uid()) and exists (
    select 1 from public.assignments a where a.id = assignment_id
      and (public.owns_course(a.course_id) or public.has_active_entitlement(auth.uid(), a.course_id))
  )
);

drop policy if exists "submissions student update or instructor" on public.submissions;
create policy "submissions student update or instructor" on public.submissions for update to authenticated
  using (student_id = auth.uid() or exists (
    select 1 from public.assignments a where a.id = assignment_id and public.owns_course(a.course_id)
  ))
  with check (
    (student_id = auth.uid() and public.is_active_user(auth.uid()) and exists (
      select 1 from public.assignments a where a.id = assignment_id
        and (public.owns_course(a.course_id) or public.has_active_entitlement(auth.uid(), a.course_id))
    ))
    or exists (select 1 from public.assignments a where a.id = assignment_id and public.owns_course(a.course_id))
  );

-- Reviews are writable by learners with current access, not merely a historical enrollment row.
drop policy if exists "reviews enrolled write" on public.reviews;
create policy "reviews enrolled write" on public.reviews for insert to authenticated with check (
  user_id = auth.uid() and public.is_active_user(auth.uid())
  and public.has_active_entitlement(auth.uid(), course_id)
);

comment on function public.has_active_entitlement(uuid, uuid) is 'Returns true only for a non-revoked entitlement whose start/expiry window is currently active.';
commit;
