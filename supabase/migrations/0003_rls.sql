-- =====================================================================
-- 0003_rls.sql — grants and Row Level Security
-- Strategy: revoke everything from anon/authenticated, then grant the minimum
-- per table (column-level where needed) and let RLS decide which rows.
-- service_role (server-only key) bypasses RLS and is used sparingly.
-- =====================================================================

revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;
alter default privileges in schema public revoke all on tables    from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;

-- Helpers needed by policies (and the app) --------------------------------
grant execute on function
  public.is_account_active(), public.has_role(text), public.has_permission(text),
  public.is_active_instructor(), public.course_is_public(uuid), public.can_manage_course(uuid),
  public.has_course_access(uuid), public.lesson_course(uuid), public.quiz_course(uuid),
  public.assignment_course(uuid), public.can_access_lesson(uuid), public.can_manage_product(uuid)
  to anon, authenticated, service_role;

grant execute on function
  public.enroll_free_course(uuid), public.submit_quiz_attempt(uuid, jsonb), public.issue_certificate(uuid),
  public.grade_submission(uuid, int, text), public.course_student_progress(uuid), public.course_analytics(uuid)
  to authenticated, service_role;
grant execute on function public.verify_certificate(text) to anon, authenticated, service_role;
grant execute on function public.rate_limit_hit(text, int, int), public.expire_entitlements() to service_role;

-- Enable RLS everywhere ---------------------------------------------------
alter table public.roles               enable row level security;
alter table public.permissions         enable row level security;
alter table public.role_permissions    enable row level security;
alter table public.profiles            enable row level security;
alter table public.user_roles          enable row level security;
alter table public.instructor_profiles enable row level security;
alter table public.categories          enable row level security;
alter table public.courses             enable row level security;
alter table public.course_instructors  enable row level security;
alter table public.sections            enable row level security;
alter table public.lessons             enable row level security;
alter table public.lesson_contents     enable row level security;
alter table public.lesson_videos       enable row level security;
alter table public.lesson_resources    enable row level security;
alter table public.products            enable row level security;
alter table public.pricing_plans       enable row level security;
alter table public.plan_items          enable row level security;
alter table public.orders              enable row level security;
alter table public.order_items         enable row level security;
alter table public.subscriptions       enable row level security;
alter table public.entitlements        enable row level security;
alter table public.enrollments         enable row level security;
alter table public.lesson_progress     enable row level security;
alter table public.quizzes             enable row level security;
alter table public.questions           enable row level security;
alter table public.question_keys       enable row level security;
alter table public.quiz_attempts       enable row level security;
alter table public.assignments         enable row level security;
alter table public.submissions         enable row level security;
alter table public.reviews             enable row level security;
alter table public.certificates        enable row level security;
alter table public.notifications       enable row level security;
alter table public.payment_events      enable row level security;
alter table public.refunds             enable row level security;
alter table public.instructor_earnings enable row level security;
alter table public.audit_logs          enable row level security;
alter table public.platform_settings   enable row level security;
alter table public.playback_sessions   enable row level security;   -- no policies: service role only
alter table public.rate_limits         enable row level security;   -- no policies: service role only

-- roles / permissions ------------------------------------------------------
grant select on public.roles, public.permissions, public.role_permissions to authenticated;
create policy roles_read    on public.roles            for select to authenticated using (true);
create policy perms_read    on public.permissions      for select to authenticated using (true);
create policy roleperm_read on public.role_permissions for select to authenticated using (true);

-- profiles -----------------------------------------------------------------
grant select on public.profiles to authenticated;
grant update (full_name, avatar_url, locale) on public.profiles to authenticated;
create policy profiles_read   on public.profiles for select to authenticated
  using (id = auth.uid() or public.has_permission('users.manage'));
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- user_roles (writes: service role only, behind permission checks) ----------
grant select on public.user_roles to authenticated;
create policy user_roles_read on public.user_roles for select to authenticated
  using (user_id = auth.uid() or public.has_permission('users.manage'));

-- instructor_profiles --------------------------------------------------------
grant select on public.instructor_profiles to anon, authenticated;
grant update (headline, bio, website) on public.instructor_profiles to authenticated;
create policy ip_read on public.instructor_profiles for select to anon, authenticated
  using (status = 'active' or user_id = auth.uid() or public.has_permission('instructors.manage'));
create policy ip_update on public.instructor_profiles for update to authenticated
  using (user_id = auth.uid() and public.is_active_instructor())
  with check (user_id = auth.uid());

-- categories -------------------------------------------------------------------
grant select on public.categories to anon, authenticated;
grant insert, update, delete on public.categories to authenticated;
create policy cat_read  on public.categories for select to anon, authenticated using (true);
create policy cat_write on public.categories for all to authenticated
  using (public.has_permission('categories.manage')) with check (public.has_permission('categories.manage'));

-- courses ------------------------------------------------------------------------
grant select on public.courses to anon, authenticated;
grant insert (slug, title, subtitle, description, category_id, language, level, access_type, created_by) on public.courses to authenticated;
grant update (title, subtitle, description, category_id, language, level, access_type, status, rejection_reason, published_at) on public.courses to authenticated;
grant delete on public.courses to authenticated;
create policy courses_read on public.courses for select to anon, authenticated
  using (status = 'published' or public.can_manage_course(id) or public.has_permission('courses.review') or public.has_course_access(id));
create policy courses_insert on public.courses for insert to authenticated
  with check (created_by = auth.uid() and public.is_active_instructor());
create policy courses_update on public.courses for update to authenticated
  using (public.can_manage_course(id) or public.has_permission('courses.review'))
  with check (public.can_manage_course(id) or public.has_permission('courses.review'));
create policy courses_delete on public.courses for delete to authenticated
  using ((public.can_manage_course(id) and status = 'draft') or public.has_permission('courses.manage'));

-- course_instructors -----------------------------------------------------------------
grant select on public.course_instructors to anon, authenticated;
create policy ci_read on public.course_instructors for select to anon, authenticated
  using (instructor_id = auth.uid() or public.course_is_public(course_id) or public.can_manage_course(course_id));

-- sections / lessons ---------------------------------------------------------------------
grant select on public.sections, public.lessons to anon, authenticated;
grant insert, update, delete on public.sections to authenticated;
grant insert (section_id, title, description, type, position, is_free_preview, duration_seconds) on public.lessons to authenticated;
grant update (title, description, type, position, is_free_preview, duration_seconds, section_id) on public.lessons to authenticated;
grant delete on public.lessons to authenticated;
create policy sections_read  on public.sections for select to anon, authenticated
  using (public.course_is_public(course_id) or public.can_manage_course(course_id) or public.has_course_access(course_id));
create policy sections_write on public.sections for all to authenticated
  using (public.can_manage_course(course_id)) with check (public.can_manage_course(course_id));
create policy lessons_read   on public.lessons for select to anon, authenticated
  using (public.course_is_public(course_id) or public.can_manage_course(course_id) or public.has_course_access(course_id));
create policy lessons_write  on public.lessons for all to authenticated
  using (public.can_manage_course(course_id)) with check (public.can_manage_course(course_id));

-- lesson_contents --------------------------------------------------------------------------
grant select, insert, update, delete on public.lesson_contents to authenticated;
create policy lc_read  on public.lesson_contents for select to authenticated using (public.can_access_lesson(lesson_id));
create policy lc_write on public.lesson_contents for all to authenticated
  using (public.can_manage_course(public.lesson_course(lesson_id)))
  with check (public.can_manage_course(public.lesson_course(lesson_id)));

-- lesson_videos: managers read; ALL writes via service role (upload sessions) -------------------
grant select on public.lesson_videos to authenticated;
create policy lv_read on public.lesson_videos for select to authenticated
  using (public.can_manage_course(public.lesson_course(lesson_id)));

-- lesson_resources: object_key is NOT selectable by clients ----------------------------------------
grant select (id, lesson_id, course_id, title, content_type, size_bytes, status, created_at) on public.lesson_resources to authenticated;
create policy lr_read on public.lesson_resources for select to authenticated
  using (status = 'ready' and public.can_access_lesson(lesson_id) or public.can_manage_course(course_id));

-- products / plans -----------------------------------------------------------------------------------
grant select on public.products, public.pricing_plans, public.plan_items to anon, authenticated;
grant insert, update, delete on public.products to authenticated;
grant insert on public.pricing_plans to authenticated;
grant update (active) on public.pricing_plans to authenticated;
grant insert, delete on public.plan_items to authenticated;
create policy products_read  on public.products for select to anon, authenticated
  using (active or public.can_manage_product(id));
create policy products_write on public.products for all to authenticated
  using ((course_id is not null and public.can_manage_course(course_id)) or public.has_permission('pricing.manage'))
  with check ((course_id is not null and public.can_manage_course(course_id)) or public.has_permission('pricing.manage'));
create policy plans_read  on public.pricing_plans for select to anon, authenticated
  using (active or public.can_manage_product(product_id));
create policy plans_write on public.pricing_plans for all to authenticated
  using (public.can_manage_product(product_id)) with check (public.can_manage_product(product_id));
create policy items_read  on public.plan_items for select to anon, authenticated using (true);
create policy items_write on public.plan_items for all to authenticated
  using (public.has_permission('pricing.manage')) with check (public.has_permission('pricing.manage'));

-- orders & friends: read-only for clients (webhooks write with the service role) --------------------
grant select on public.orders, public.order_items, public.subscriptions, public.refunds, public.instructor_earnings to authenticated;
create policy orders_read on public.orders for select to authenticated
  using (user_id = auth.uid() or public.has_permission('payments.read'));
create policy order_items_read on public.order_items for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_id and (o.user_id = auth.uid() or public.has_permission('payments.read'))));
create policy subs_read on public.subscriptions for select to authenticated
  using (user_id = auth.uid() or public.has_permission('payments.read'));
create policy refunds_read on public.refunds for select to authenticated using (public.has_permission('payments.read'));
create policy earnings_read on public.instructor_earnings for select to authenticated
  using (instructor_id = auth.uid() or public.has_permission('payments.read'));
-- payment_events: no client access at all (RLS on, no policy, no grant)

-- entitlements / enrollments --------------------------------------------------------------------------
grant select on public.entitlements, public.enrollments to authenticated;
create policy ent_read on public.entitlements for select to authenticated
  using (user_id = auth.uid() or public.can_manage_course(course_id) or public.has_permission('entitlements.manage'));
create policy enr_read on public.enrollments for select to authenticated
  using (user_id = auth.uid() or public.can_manage_course(course_id) or public.has_permission('users.manage'));

-- lesson_progress: a write is only possible if the user can access the lesson -------------------------
grant select on public.lesson_progress to authenticated;
grant insert (user_id, lesson_id, position_seconds, completed, completed_at) on public.lesson_progress to authenticated;
grant update (position_seconds, completed, completed_at) on public.lesson_progress to authenticated;
create policy lp_read   on public.lesson_progress for select to authenticated
  using (user_id = auth.uid() or public.can_manage_course(course_id));
create policy lp_insert on public.lesson_progress for insert to authenticated
  with check (user_id = auth.uid() and public.can_access_lesson(lesson_id));
create policy lp_update on public.lesson_progress for update to authenticated
  using (user_id = auth.uid() and public.can_access_lesson(lesson_id))
  with check (user_id = auth.uid() and public.can_access_lesson(lesson_id));

-- quizzes / questions / keys / attempts ------------------------------------------------------------------
grant select, insert, update, delete on public.quizzes, public.questions to authenticated;
grant select, insert, update, delete on public.question_keys to authenticated;
grant select on public.quiz_attempts to authenticated;
create policy quizzes_read on public.quizzes for select to authenticated
  using ((is_published and public.has_course_access(course_id)) or public.can_manage_course(course_id));
create policy quizzes_write on public.quizzes for all to authenticated
  using (public.can_manage_course(course_id)) with check (public.can_manage_course(course_id));
create policy questions_read on public.questions for select to authenticated
  using (public.can_manage_course(public.quiz_course(quiz_id))
         or (public.has_course_access(public.quiz_course(quiz_id))
             and exists (select 1 from public.quizzes q where q.id = quiz_id and q.is_published)));
create policy questions_write on public.questions for all to authenticated
  using (public.can_manage_course(public.quiz_course(quiz_id))) with check (public.can_manage_course(public.quiz_course(quiz_id)));
create policy qkeys_all on public.question_keys for all to authenticated
  using (exists (select 1 from public.questions q where q.id = question_id and public.can_manage_course(public.quiz_course(q.quiz_id))))
  with check (exists (select 1 from public.questions q where q.id = question_id and public.can_manage_course(public.quiz_course(q.quiz_id))));
create policy attempts_read on public.quiz_attempts for select to authenticated
  using (user_id = auth.uid() or public.can_manage_course(course_id));

-- assignments / submissions ----------------------------------------------------------------------------------
grant select, insert, update, delete on public.assignments to authenticated;
grant select on public.submissions to authenticated;
grant insert (assignment_id, user_id, content) on public.submissions to authenticated;
grant update (content) on public.submissions to authenticated;
create policy assignments_read on public.assignments for select to authenticated
  using ((is_published and public.has_course_access(course_id)) or public.can_manage_course(course_id));
create policy assignments_write on public.assignments for all to authenticated
  using (public.can_manage_course(course_id)) with check (public.can_manage_course(course_id));
create policy subs_read_policy on public.submissions for select to authenticated
  using (user_id = auth.uid() or public.can_manage_course(public.assignment_course(assignment_id)));
create policy subs_insert on public.submissions for insert to authenticated
  with check (user_id = auth.uid()
              and public.has_course_access(public.assignment_course(assignment_id))
              and exists (select 1 from public.assignments a where a.id = assignment_id and a.is_published));
create policy subs_update on public.submissions for update to authenticated
  using (user_id = auth.uid() and score is null and public.has_course_access(public.assignment_course(assignment_id)))
  with check (user_id = auth.uid());

-- reviews ---------------------------------------------------------------------------------------------------------
grant select on public.reviews to authenticated;
grant select on public.public_reviews to anon, authenticated;
grant insert (course_id, user_id, rating, comment) on public.reviews to authenticated;
grant update (rating, comment) on public.reviews to authenticated;
create policy reviews_read on public.reviews for select to authenticated
  using (user_id = auth.uid() or public.has_permission('moderation.manage'));
create policy reviews_insert on public.reviews for insert to authenticated
  with check (user_id = auth.uid() and public.has_course_access(course_id));
create policy reviews_update on public.reviews for update to authenticated
  using (user_id = auth.uid() and not is_hidden) with check (user_id = auth.uid());

-- certificates ---------------------------------------------------------------------------------------------------------
grant select on public.certificates to authenticated;
create policy certs_read on public.certificates for select to authenticated
  using (user_id = auth.uid() or public.has_permission('users.manage'));

-- notifications ----------------------------------------------------------------------------------------------------------
grant select, delete on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;
create policy notif_read   on public.notifications for select to authenticated using (user_id = auth.uid());
create policy notif_update on public.notifications for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy notif_delete on public.notifications for delete to authenticated using (user_id = auth.uid());

-- audit_logs / settings / views ----------------------------------------------------------------------------------------------
grant select on public.audit_logs to authenticated;
create policy audit_read on public.audit_logs for select to authenticated using (public.has_permission('audit.read'));
grant select, update on public.platform_settings to authenticated;
create policy settings_read   on public.platform_settings for select to authenticated using (public.has_permission('settings.manage'));
create policy settings_update on public.platform_settings for update to authenticated
  using (public.has_permission('settings.manage')) with check (public.has_permission('settings.manage'));

grant select on public.public_instructors to anon, authenticated;
grant select on public.course_catalog     to anon, authenticated;
