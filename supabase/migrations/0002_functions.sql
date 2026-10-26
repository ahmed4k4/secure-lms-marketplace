-- =====================================================================
-- 0002_functions.sql — authorization helpers, triggers, RPCs, views
-- Helpers are SECURITY DEFINER with a pinned search_path so RLS policies can call them
-- without recursion. They always derive identity from auth.uid(), never from arguments.
-- =====================================================================

-- ---------- Generic triggers ----------
create function public.set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

create trigger profiles_updated_at     before update on public.profiles            for each row execute function public.set_updated_at();
create trigger instructor_updated_at   before update on public.instructor_profiles for each row execute function public.set_updated_at();
create trigger courses_updated_at      before update on public.courses             for each row execute function public.set_updated_at();
create trigger submissions_updated_at  before update on public.submissions         for each row execute function public.set_updated_at();
create trigger reviews_updated_at      before update on public.reviews             for each row execute function public.set_updated_at();
create trigger progress_updated_at     before update on public.lesson_progress     for each row execute function public.set_updated_at();

-- ---------- Authorization helpers ----------
create function public.is_account_active() returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null
     and exists (select 1 from public.profiles p where p.id = auth.uid() and p.status = 'active')
$$;

create function public.has_role(p_key text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.user_roles ur join public.roles r on r.id = ur.role_id
    where ur.user_id = auth.uid() and r.key = p_key)
$$;

create function public.has_permission(p_perm text) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_account_active() and exists (
    select 1
    from public.user_roles ur join public.roles r on r.id = ur.role_id
    where ur.user_id = auth.uid()
      and (r.key = 'super_admin'
           or exists (select 1 from public.role_permissions rp where rp.role_id = r.id and rp.permission_key = p_perm))
  )
$$;

create function public.is_active_instructor() returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_account_active()
     and public.has_role('instructor')
     and exists (select 1 from public.instructor_profiles ip where ip.user_id = auth.uid() and ip.status = 'active')
$$;

create function public.course_is_public(p_course_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.courses c where c.id = p_course_id and c.status = 'published')
$$;

create function public.can_manage_course(p_course_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_account_active() and (
    (public.is_active_instructor() and exists (
       select 1 from public.course_instructors ci where ci.course_id = p_course_id and ci.instructor_id = auth.uid()))
    or public.has_permission('courses.manage'))
$$;

-- Effective entitlement check. Archived courses keep serving existing students;
-- draft / in_review / rejected / suspended courses serve nobody (except managers).
create function public.has_course_access(p_course_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_account_active() and exists (
    select 1
    from public.courses c join public.entitlements e on e.course_id = c.id
    where c.id = p_course_id
      and c.status in ('published','archived')
      and e.user_id = auth.uid()
      and e.status = 'active' and e.revoked_at is null
      and e.starts_at <= now()
      and (e.expires_at is null or e.expires_at > now()))
$$;

create function public.lesson_course(p_lesson_id uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select course_id from public.lessons where id = p_lesson_id
$$;
create function public.quiz_course(p_quiz_id uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select course_id from public.quizzes where id = p_quiz_id
$$;
create function public.assignment_course(p_assignment_id uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select course_id from public.assignments where id = p_assignment_id
$$;

-- The single source of truth for "may this user consume this lesson".
create function public.can_access_lesson(p_lesson_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_account_active() and exists (
    select 1 from public.lessons l join public.courses c on c.id = l.course_id
    where l.id = p_lesson_id
      and (public.can_manage_course(c.id)
           or (c.status in ('published','archived')
               and (l.is_free_preview and c.status = 'published' or public.has_course_access(c.id)))))
$$;

create function public.can_manage_product(p_product_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.products p
    where p.id = p_product_id
      and ((p.course_id is not null and public.can_manage_course(p.course_id)) or public.has_permission('pricing.manage')))
$$;

-- ---------- Row-level triggers ----------
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, locale)
  values (new.id,
          coalesce(left(new.raw_user_meta_data ->> 'full_name', 120), ''),
          case when new.raw_user_meta_data ->> 'locale' = 'ar' then 'ar' else 'en' end);
  insert into public.user_roles (user_id, role_id) select new.id, r.id from public.roles r where r.key = 'student';
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

create function public.course_add_owner() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.course_instructors (course_id, instructor_id, role) values (new.id, new.created_by, 'owner');
  return new;
end $$;
create trigger courses_add_owner after insert on public.courses
  for each row execute function public.course_add_owner();

create function public.lesson_sync_course() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  select s.course_id into new.course_id from public.sections s where s.id = new.section_id;
  if new.course_id is null then raise exception 'section_not_found'; end if;
  return new;
end $$;
create trigger lessons_sync_course before insert or update of section_id on public.lessons
  for each row execute function public.lesson_sync_course();

create function public.child_sync_course() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  select l.course_id into new.course_id from public.lessons l where l.id = new.lesson_id;
  if new.course_id is null then raise exception 'lesson_not_found'; end if;
  return new;
end $$;
create trigger progress_sync_course  before insert on public.lesson_progress  for each row execute function public.child_sync_course();
create trigger resources_sync_course before insert on public.lesson_resources for each row execute function public.child_sync_course();

-- Authors may only move a course between draft/rejected -> in_review and in_review -> draft.
-- Publishing, rejecting, suspending and archiving are reviewer actions.
create function public.enforce_course_status() returns trigger
language plpgsql set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;                -- trusted server context
  if public.has_permission('courses.review') then
    if new.status = 'published' and old.status <> 'published' then
      new.published_at := coalesce(old.published_at, now());
    end if;
    return new;
  end if;
  new.created_by       := old.created_by;
  new.rejection_reason := old.rejection_reason;
  new.published_at     := old.published_at;
  if new.status <> old.status then
    if not ((old.status in ('draft','rejected') and new.status = 'in_review')
         or (old.status = 'in_review' and new.status = 'draft')) then
      raise exception 'invalid_status_transition' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
create trigger courses_enforce_status before update on public.courses
  for each row execute function public.enforce_course_status();

create function public.audit_logs_immutable() returns trigger
language plpgsql as $$
begin raise exception 'audit_logs rows are immutable' using errcode = '42501'; end $$;
create trigger audit_logs_no_update before update on public.audit_logs
  for each row execute function public.audit_logs_immutable();

-- ---------- RPCs ----------
create function public.enroll_free_course(p_course_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if not public.is_account_active() then raise exception 'account_suspended' using errcode = '42501'; end if;
  if not exists (select 1 from public.courses where id = p_course_id and status = 'published' and access_type = 'free') then
    raise exception 'course_not_free_or_unavailable' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.entitlements where user_id = v_uid and course_id = p_course_id
             and source = 'free' and status = 'revoked' and revoked_reason in ('admin','policy')) then
    raise exception 'access_revoked' using errcode = '42501';
  end if;
  insert into public.enrollments (user_id, course_id) values (v_uid, p_course_id) on conflict do nothing;
  insert into public.entitlements (user_id, course_id, source, status)
  select v_uid, p_course_id, 'free', 'active'
  where not exists (select 1 from public.entitlements e where e.user_id = v_uid and e.course_id = p_course_id
                    and e.source = 'free' and e.status = 'active');
end $$;

create function public.submit_quiz_attempt(p_quiz_id uuid, p_answers jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid(); v_quiz public.quizzes%rowtype;
  v_total int; v_correct int; v_score int; v_passed boolean; v_results jsonb;
begin
  if v_uid is null or not public.is_account_active() then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into v_quiz from public.quizzes where id = p_quiz_id and is_published;
  if not found then raise exception 'quiz_not_found' using errcode = 'P0002'; end if;
  if not public.has_course_access(v_quiz.course_id) then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_answers is null or jsonb_typeof(p_answers) <> 'object' then raise exception 'invalid_answers' using errcode = '22023'; end if;

  select count(*),
         count(*) filter (where coalesce(p_answers ->> q.id::text = k.correct_option_id, false)),
         jsonb_agg(jsonb_build_object('question_id', q.id,
                                      'correct', coalesce(p_answers ->> q.id::text = k.correct_option_id, false),
                                      'explanation', k.explanation) order by q.position)
    into v_total, v_correct, v_results
  from public.questions q join public.question_keys k on k.question_id = q.id
  where q.quiz_id = p_quiz_id;
  if v_total = 0 then raise exception 'quiz_empty' using errcode = 'P0001'; end if;

  v_score := round(100.0 * v_correct / v_total);
  v_passed := v_score >= v_quiz.pass_percent;
  insert into public.quiz_attempts (quiz_id, user_id, course_id, answers, score_percent, passed)
  values (p_quiz_id, v_uid, v_quiz.course_id, p_answers, v_score, v_passed);
  return jsonb_build_object('score_percent', v_score, 'passed', v_passed, 'results', v_results);
end $$;

create function public.issue_certificate(p_course_id uuid) returns text
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_total int; v_done int; v_code text; h text;
begin
  if v_uid is null or not public.is_account_active() then raise exception 'forbidden' using errcode = '42501'; end if;
  if not public.has_course_access(p_course_id) then raise exception 'forbidden' using errcode = '42501'; end if;
  select code into v_code from public.certificates where user_id = v_uid and course_id = p_course_id;
  if found then return v_code; end if;
  select count(*) into v_total from public.lessons where course_id = p_course_id;
  select count(*) into v_done from public.lesson_progress lp join public.lessons l on l.id = lp.lesson_id
   where lp.user_id = v_uid and l.course_id = p_course_id and lp.completed;
  if v_total = 0 or v_done < v_total then raise exception 'course_not_completed' using errcode = 'P0001'; end if;
  h := upper(replace(gen_random_uuid()::text, '-', ''));
  v_code := substr(h,1,4) || '-' || substr(h,5,4) || '-' || substr(h,9,4) || '-' || substr(h,13,4);
  insert into public.certificates (user_id, course_id, code) values (v_uid, p_course_id, v_code);
  update public.enrollments set completed_at = now() where user_id = v_uid and course_id = p_course_id and completed_at is null;
  return v_code;
end $$;

create function public.verify_certificate(p_code text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('holder_name', p.full_name, 'course_title', c.title, 'issued_at', ce.issued_at, 'code', ce.code)
  from public.certificates ce
  join public.profiles p on p.id = ce.user_id
  join public.courses  c on c.id = ce.course_id
  where ce.code = upper(trim(p_code))
$$;

create function public.grade_submission(p_submission_id uuid, p_score int, p_feedback text) returns void
language plpgsql security definer set search_path = public as $$
declare v_course uuid; v_max int;
begin
  select a.course_id, a.max_score into v_course, v_max
    from public.submissions s join public.assignments a on a.id = s.assignment_id where s.id = p_submission_id;
  if v_course is null or not public.can_manage_course(v_course) then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_score < 0 or p_score > v_max then raise exception 'score_out_of_range' using errcode = '22003'; end if;
  update public.submissions
     set score = p_score, feedback = left(p_feedback, 5000), graded_by = auth.uid(), graded_at = now()
   where id = p_submission_id;
end $$;

create function public.course_student_progress(p_course_id uuid)
returns table (user_id uuid, full_name text, enrolled_at timestamptz, completed_lessons int, total_lessons int, last_activity timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.can_manage_course(p_course_id) then raise exception 'forbidden' using errcode = '42501'; end if;
  return query
    select e.user_id, p.full_name, e.enrolled_at,
           (select count(*)::int from public.lesson_progress lp where lp.user_id = e.user_id and lp.course_id = p_course_id and lp.completed),
           (select count(*)::int from public.lessons l where l.course_id = p_course_id),
           (select max(lp.updated_at) from public.lesson_progress lp where lp.user_id = e.user_id and lp.course_id = p_course_id)
    from public.enrollments e join public.profiles p on p.id = e.user_id
    where e.course_id = p_course_id
    order by e.enrolled_at desc;
end $$;

create function public.course_analytics(p_course_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.can_manage_course(p_course_id) then raise exception 'forbidden' using errcode = '42501'; end if;
  return jsonb_build_object(
    'enrollments', (select count(*) from public.enrollments where course_id = p_course_id),
    'active_7d',   (select count(distinct user_id) from public.lesson_progress where course_id = p_course_id and updated_at > now() - interval '7 days'),
    'completions', (select count(*) from public.enrollments where course_id = p_course_id and completed_at is not null),
    'avg_rating',  (select round(avg(rating)::numeric, 2) from public.reviews where course_id = p_course_id and not is_hidden),
    'review_count',(select count(*) from public.reviews where course_id = p_course_id and not is_hidden),
    'avg_quiz_score', (select round(avg(score_percent)::numeric, 1) from public.quiz_attempts where course_id = p_course_id));
end $$;

-- Fixed-window rate limiter. Service role only.
create function public.rate_limit_hit(p_key text, p_window_seconds int, p_max int) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_count int;
begin
  insert into public.rate_limits as rl (key, window_start, count) values (p_key, now(), 1)
  on conflict (key) do update set
    window_start = case when rl.window_start < now() - make_interval(secs => p_window_seconds) then now() else rl.window_start end,
    count        = case when rl.window_start < now() - make_interval(secs => p_window_seconds) then 1 else rl.count + 1 end
  returning rl.count into v_count;
  return v_count <= p_max;
end $$;

-- Marks lapsed entitlements as expired (the effective check already honours expires_at;
-- this keeps the status column truthful for reporting). Service role only.
create function public.expire_entitlements() returns int
language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  update public.entitlements set status = 'expired'
   where status = 'active' and expires_at is not null and expires_at <= now();
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- ---------- Public views ----------
-- Owned by the migration role on purpose (they bypass RLS to expose a *whitelisted* column set).
create view public.public_instructors as
  select p.id, p.full_name, p.avatar_url, ip.headline, ip.bio, ip.website
  from public.profiles p join public.instructor_profiles ip on ip.user_id = p.id
  where ip.status = 'active' and p.status = 'active';

create view public.public_reviews as
  select r.id, r.course_id, r.rating, r.comment, r.created_at,
         split_part(p.full_name, ' ', 1) as reviewer_name,
         (r.user_id = auth.uid()) as is_mine
  from public.reviews r join public.profiles p on p.id = r.user_id
  where not r.is_hidden and public.course_is_public(r.course_id);

-- Respects the caller's RLS on the underlying tables.
create view public.course_catalog with (security_invoker = true) as
  select c.id, c.slug, c.title, c.subtitle, c.language, c.level, c.access_type, c.status, c.published_at,
         c.category_id, cat.slug as category_slug, cat.name_en as category_name_en, cat.name_ar as category_name_ar,
         c.created_by as owner_id, pi.full_name as owner_name,
         pp.amount_cents as price_cents, pp.currency,
         coalesce(r.avg_rating, 0) as rating_avg, coalesce(r.cnt, 0) as rating_count,
         coalesce(l.cnt, 0) as lesson_count
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
  left join lateral (select count(*) as cnt from public.lessons where course_id = c.id) l on true;
