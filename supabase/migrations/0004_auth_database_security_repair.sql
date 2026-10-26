-- Repair grants/provisioning, remove ambiguous default arguments, and harden the quiz catalog.
-- Safe for existing projects: no tables or user data are dropped.
begin;

-- Replacing this signature without DEFAULT removes the old default argument from legacy installs.
create or replace function public.is_admin(_user_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select (_user_id = auth.uid() or exists (
    select 1 from public.profiles me join public.user_roles mr on mr.user_id = me.id
    where me.id = auth.uid() and me.status = 'active' and mr.role in ('super_admin', 'admin')
  ))
  and exists (select 1 from public.profiles pr where pr.id = _user_id and pr.status = 'active')
  and exists (select 1 from public.user_roles ur where ur.user_id = _user_id and ur.role in ('super_admin', 'admin'));
$$;
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public
as $$ select public.is_admin(auth.uid()) $$;

-- Explicit helper EXECUTE grants: public course RLS needs is_admin() and signed-in
-- RLS policies call the other predicates directly. No RLS policies are disabled.
grant execute on function public.is_admin() to anon, authenticated, service_role;
grant execute on function public.is_active_user(uuid) to authenticated, service_role;
grant execute on function public.has_role(uuid, public.app_role) to authenticated, service_role;
grant execute on function public.owns_course(uuid) to authenticated, service_role;
grant execute on function public.has_active_entitlement(uuid, uuid) to authenticated, service_role;

-- The bootstrap script uses the service-role client server-side. Explicit table grants fix
-- installations whose default privileges did not grant it access to these custom tables.
grant usage on schema public to service_role;
grant select, insert, update, delete on table public.profiles to service_role;
grant select, insert, update, delete on table public.user_roles to service_role;
grant select, insert, update, delete on table public.audit_logs to service_role;
do $$
declare audit_seq text := pg_get_serial_sequence('public.audit_logs', 'id');
begin
  if audit_seq is not null then
    execute format('grant usage, select on sequence %s to service_role', audit_seq);
  end if;
end $$;

-- Restrict the student-facing question view to safe columns and caller RLS.
drop policy if exists "questions student enrolled read" on public.questions;
create policy "questions student enrolled read" on public.questions for select to authenticated using (
  exists (
    select 1 from public.quizzes z join public.courses c on c.id = z.course_id
    where z.id = questions.quiz_id and z.is_published and c.status = 'published'
      and public.is_active_user(auth.uid())
      and (public.has_active_entitlement(auth.uid(), z.course_id)
        or exists (select 1 from public.enrollments e where e.user_id = auth.uid() and e.course_id = z.course_id))
  )
);
revoke select on table public.questions from public, anon, authenticated;
grant select (id, quiz_id, prompt_en, prompt_ar, question_type, options, points, sort_order)
  on table public.questions to authenticated;
create or replace view public.quiz_question_catalog with (security_barrier = true, security_invoker = true) as
select q.id, q.quiz_id, q.prompt_en, q.prompt_ar, q.question_type, q.options, q.points, q.sort_order
from public.questions q
join public.quizzes z on z.id = q.quiz_id
join public.courses c on c.id = z.course_id
where public.owns_course(z.course_id) or (
  z.is_published and c.status = 'published' and public.is_active_user(auth.uid()) and (
    public.has_active_entitlement(auth.uid(), z.course_id)
    or exists (select 1 from public.enrollments e where e.user_id = auth.uid() and e.course_id = z.course_id)
  )
);
revoke all on public.quiz_question_catalog from public, anon;
grant select on public.quiz_question_catalog to authenticated;

commit;
