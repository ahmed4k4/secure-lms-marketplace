'use server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { redirect } from 'next/navigation';
import { requireInstructor, requirePermission } from '@/lib/auth';
import { getT } from '@/lib/i18n';
import {
  announcementSchema, assignmentSchema, courseSchema, gradeSchema, lessonCreateSchema, lessonUpdateSchema, parseForm,
  pricingSchema, questionSchema, quizSchema, sectionSchema, type ActionState,
} from '@/lib/validation';
import { slugify } from '@/lib/utils';
import { createAdminClient } from '@/lib/supabase/admin';
import { deleteLessonMedia } from '@/lib/media';
import { coverPublicUrl, deleteObject, headCoverObject } from '@/lib/r2';
import { audit } from '@/lib/audit';
import { fail, ok } from './helpers';

// NOTE: every course write uses the user-scoped client, so RLS remains the final ownership boundary.
// Category-request creation uses the service client only after requireInstructor() has verified identity,
// active account and the single instructor role; requested_by is always derived from that identity.

function categorySlug(name: string) {
  return name.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/g, '');
}

async function resolveCourseCategory(input: { categoryId?: string; newCategoryNameEn?: string; newCategoryNameAr?: string; existingCategoryRequestId?: string }, userId: string, supabase: any) {
  if (input.categoryId) {
    const { data, error } = await supabase.from('categories').select('id').eq('id', input.categoryId).maybeSingle();
    if (error || !data) return { error: 'invalid' as const };
    return { categoryId: data.id as string, categoryRequestId: null as string | null };
  }
  const en = input.newCategoryNameEn?.trim();
  const ar = input.newCategoryNameAr?.trim();
  if (Boolean(en) !== Boolean(ar)) return { error: 'invalid' as const };
  const admin = createAdminClient();
  if (en && ar) {
    const slug = categorySlug(en);
    if (!slug) return { error: 'invalid' as const };
    const { data: existingCategory, error: categoryError } = await admin.from('categories').select('id').eq('slug', slug).maybeSingle();
    if (categoryError) return { error: 'storage' as const };
    if (existingCategory) return { categoryId: existingCategory.id as string, categoryRequestId: null as string | null };
    const { data: pending, error: pendingError } = await admin.from('category_requests').select('id').eq('slug', slug).eq('status', 'pending').maybeSingle();
    if (pendingError) return { error: 'storage' as const };
    if (pending) return { categoryId: null as string | null, categoryRequestId: pending.id as string };
    const { data: request, error: requestError } = await admin.from('category_requests').insert({ slug, name_en: en, name_ar: ar, requested_by: userId, status: 'pending' }).select('id').single();
    if (requestError || !request) {
      // Another instructor may have submitted the same name milliseconds earlier.
      const { data: raced } = await admin.from('category_requests').select('id').eq('slug', slug).eq('status', 'pending').maybeSingle();
      if (raced) return { categoryId: null as string | null, categoryRequestId: raced.id as string };
      return { error: 'storage' as const };
    }
    return { categoryId: null as string | null, categoryRequestId: request.id as string };
  }
  if (input.existingCategoryRequestId) {
    const { data: request } = await admin.from('category_requests').select('id, requested_by, status').eq('id', input.existingCategoryRequestId).maybeSingle();
    const { data: linkedCourse } = await supabase.from('courses').select('id').eq('created_by', userId).eq('category_request_id', input.existingCategoryRequestId).limit(1).maybeSingle();
    if (request && request.status === 'pending' && (request.requested_by === userId || linkedCourse)) {
      return { categoryId: null as string | null, categoryRequestId: request.id as string };
    }
  }
  return { categoryId: null as string | null, categoryRequestId: null as string | null };
}

async function resolveCover(input: { coverObjectKey?: string; coverUploadRequested?: boolean }, userId: string) {
  if (input.coverUploadRequested && !input.coverObjectKey) return { error: 'invalid' as const };
  if (!input.coverObjectKey) return { coverUrl: null as string | null };
  const re = new RegExp(`^covers/${userId}/[0-9a-f-]{36}\\.(jpg|png|webp)$`, 'i');
  if (!re.test(input.coverObjectKey)) return { error: 'invalid' as const };
  try {
    const head = await headCoverObject(input.coverObjectKey);
    if (head.size <= 0 || head.size > 4 * 1024 * 1024 || !['image/jpeg', 'image/png', 'image/webp'].includes(head.contentType)) return { error: 'invalid' as const };
    return { coverUrl: coverPublicUrl(input.coverObjectKey) };
  } catch { return { error: 'storage' as const }; }
}

export async function createCourseAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const { supabase, user } = await requireInstructor();
  const { t } = await getT();
  const p = parseForm(courseSchema, formData);
  if (!p.ok) return { error: t('err.invalid_input') };
  const category = await resolveCourseCategory(p.data, user.id, supabase);
  if ('error' in category) return { error: category.error === 'invalid' ? t('err.invalid_input') : t('err.generic') };
  const cover = await resolveCover(p.data, user.id);
  if ('error' in cover) return { error: cover.error === 'invalid' ? t('course.cover_upload_failed') : t('course.cover_upload_failed') };
  const { data, error } = await supabase
    .from('courses')
    .insert({
      slug: slugify(p.data.title), title: p.data.title, subtitle: p.data.subtitle ?? null, description: p.data.description,
      category_id: category.categoryId, category_request_id: category.categoryRequestId,
      cover_url: cover.coverUrl, language: p.data.language, level: p.data.level, created_by: user.id,
      outcomes: p.data.outcomes, requirements: p.data.requirements, audience: p.data.audience,
    })
    .select('id')
    .single();
  if (error || !data) return { error: t('err.forbidden') };
  redirect(`/instructor/courses/${data.id}`);
}

export async function createCourseForInstructorAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const { supabase, admin, user } = await requirePermission('courses.manage');
  const { t } = await getT();
  const p = parseForm(courseSchema, formData);
  if (!p.ok) return { error: t('err.invalid_input') };
  const ownerId = String(formData.get('ownerInstructorId') ?? '').trim();
  if (!z.string().uuid().safeParse(ownerId).success) return { error: t('err.invalid_input') };
  const [{ data: profile }, { data: instructor }, { data: roles }] = await Promise.all([
    admin.from('profiles').select('id,status').eq('id', ownerId).maybeSingle(),
    admin.from('instructor_profiles').select('user_id,status').eq('user_id', ownerId).maybeSingle(),
    admin.from('user_roles').select('roles(key)').eq('user_id', ownerId),
  ]);
  const ownerRoles = (roles ?? []).map((r: any) => Array.isArray(r.roles) ? r.roles[0]?.key : r.roles?.key).filter(Boolean);
  if (!profile || profile.status !== 'active' || !instructor || instructor.status !== 'active' || !ownerRoles.includes('instructor')) {
    return { error: t('err.forbidden') };
  }
  const category = await resolveCourseCategory(p.data, user.id, supabase);
  if ('error' in category) return { error: category.error === 'invalid' ? t('err.invalid_input') : t('err.generic') };
  const cover = await resolveCover(p.data, user.id);
  if ('error' in cover) return { error: t('course.cover_upload_failed') };
  const baseSlug = slugify(p.data.title).slice(0, 110) || 'course';
  let slug = baseSlug;
  for (let i = 2; i < 20; i++) {
    const { data: existing } = await admin.from('courses').select('id').eq('slug', slug).maybeSingle();
    if (!existing) break;
    slug = `${baseSlug}-${i}`;
  }
  const { data: created, error } = await admin.from('courses').insert({
    slug, title: p.data.title, subtitle: p.data.subtitle ?? null, description: p.data.description,
    category_id: category.categoryId, category_request_id: category.categoryRequestId,
    cover_url: cover.coverUrl, language: p.data.language, level: p.data.level, created_by: ownerId,
    outcomes: p.data.outcomes, requirements: p.data.requirements, audience: p.data.audience,
  }).select('id').single();
  if (error || !created) return { error: t('err.generic') };
  await audit({ actorId: user.id, action: 'course.created_for_instructor', entityType: 'course', entityId: created.id, metadata: { instructorId: ownerId } });
  revalidatePath('/admin');
  revalidatePath('/admin/courses');
  revalidatePath('/admin/instructors');
  redirect(`/instructor/courses/${created.id}`);
}

export async function updateCourseAction(courseId: string, _: ActionState, formData: FormData): Promise<ActionState> {
  const { supabase, user } = await requireInstructor();
  const { t } = await getT();
  const p = parseForm(courseSchema, formData);
  if (!p.ok) return { error: t('err.invalid_input') };
  const category = await resolveCourseCategory(p.data, user.id, supabase);
  if ('error' in category) return { error: category.error === 'invalid' ? t('err.invalid_input') : t('err.generic') };
  const cover = await resolveCover(p.data, user.id);
  if ('error' in cover) return { error: t('course.cover_upload_failed') };
  const patch: Record<string, unknown> = {
    title: p.data.title, subtitle: p.data.subtitle ?? null, description: p.data.description,
    category_id: category.categoryId, category_request_id: category.categoryRequestId,
    language: p.data.language, level: p.data.level, outcomes: p.data.outcomes, requirements: p.data.requirements, audience: p.data.audience,
  };
  if (p.data.coverObjectKey) patch.cover_url = cover.coverUrl;
  const { data, error } = await supabase.from('courses').update(patch).eq('id', courseId).select('id');
  if (error || !data?.length) return { error: t('err.forbidden') };
  revalidatePath(`/instructor/courses/${courseId}`);
  return ok('msg.saved');
}

/**
 * Pricing never edits history: a new plan row is created and the previous one deactivated.
 * Existing entitlements are untouched, so changing the model cannot silently revoke purchased access.
 */
export async function updatePricingAction(courseId: string, _: ActionState, formData: FormData): Promise<ActionState> {
  const { supabase, user } = await requireInstructor();
  const { t } = await getT();
  const p = parseForm(pricingSchema, formData);
  if (!p.ok) return { error: t('err.invalid_input') };
  const model = p.data.planModel ?? (p.data.accessType === 'free' ? 'free' : 'one_time');
  const amountCents = model === 'free' ? 0 : Math.round((p.data.amount ?? 0) * 100);
  const { error } = await supabase.rpc('configure_course_pricing', {
    p_course_id: courseId,
    p_model: model,
    p_amount_cents: amountCents,
    p_currency: p.data.currency,
    p_access_days: model === 'one_time' ? p.data.accessDays ?? null : null,
  });
  if (error) return { error: error.code === '42501' ? t('err.forbidden') : t('err.generic') };
  await audit({ actorId: user.id, action: 'course.pricing_updated', entityType: 'course', entityId: courseId, metadata: { model, currency: p.data.currency } });
  revalidatePath(`/instructor/courses/${courseId}`);
  return ok('msg.saved');
}

export async function submitForReviewAction(courseId: string): Promise<void> {
  const { supabase } = await requireInstructor();
  const { count: lessons } = await supabase.from('lessons').select('id', { count: 'exact', head: true }).eq('course_id', courseId);
  if (!lessons) redirect(`/instructor/courses/${courseId}?error=empty`);
  const { data: course } = await supabase.from('courses').select('id, category_id, category_request_id, status').eq('id', courseId).maybeSingle();
  if (!course) redirect('/instructor');
  if (!course.category_id && !course.category_request_id) redirect(`/instructor/courses/${courseId}?error=category`);
  let nextStatus: 'category_pending' | 'in_review' = 'in_review';
  if (course.category_request_id) {
    const { data: request } = await supabase.from('category_requests').select('status, category_id').eq('id', course.category_request_id).maybeSingle();
    if (request?.status === 'pending') nextStatus = 'category_pending';
    else if (request?.status === 'approved' && request.category_id) {
      await supabase.from('courses').update({ category_id: request.category_id, category_request_id: null }).eq('id', courseId);
    } else redirect(`/instructor/courses/${courseId}?error=category`);
  }
  const { error } = await supabase.from('courses').update({ status: nextStatus }).eq('id', courseId);
  if (error) redirect(`/instructor/courses/${courseId}?error=category`);
  revalidatePath(`/instructor/courses/${courseId}`);
}

export async function withdrawReviewAction(courseId: string): Promise<void> {
  const { supabase } = await requireInstructor();
  await supabase.from('courses').update({ status: 'draft' }).eq('id', courseId);
  revalidatePath(`/instructor/courses/${courseId}`);
}

export async function deleteCourseAction(courseId: string): Promise<void> {
  const { supabase } = await requireInstructor();
  // Delete stored objects first (RLS only lets owners delete drafts).
  const { data: course } = await supabase.from('courses').select('id, status').eq('id', courseId).maybeSingle();
  if (!course || course.status !== 'draft') redirect('/instructor');
  const { data: lessons } = await supabase.from('lessons').select('id').eq('course_id', courseId);
  for (const l of lessons ?? []) await deleteLessonMedia(l.id);
  await supabase.from('courses').delete().eq('id', courseId);
  redirect('/instructor');
}

// ----- curriculum -----
async function nextPosition(supabase: any, table: string, col: string, value: string) {
  const { data } = await supabase.from(table).select('position').eq(col, value).order('position', { ascending: false }).limit(1);
  return (data?.[0]?.position ?? -1) + 1;
}

export async function addSectionAction(courseId: string, _: ActionState, formData: FormData): Promise<ActionState> {
  const { supabase } = await requireInstructor();
  const p = parseForm(sectionSchema, formData);
  if (!p.ok) return fail('err.invalid_input');
  const { error } = await supabase.from('sections').insert({ course_id: courseId, title: p.data.title, position: await nextPosition(supabase, 'sections', 'course_id', courseId) });
  if (error) return fail('err.forbidden');
  revalidatePath(`/instructor/courses/${courseId}`);
  return { ok: true };
}

export async function renameSectionAction(courseId: string, sectionId: string, formData: FormData): Promise<void> {
  const { supabase } = await requireInstructor();
  const p = parseForm(sectionSchema, formData);
  if (p.ok) await supabase.from('sections').update({ title: p.data.title }).eq('id', sectionId).eq('course_id', courseId);
  revalidatePath(`/instructor/courses/${courseId}`);
}

export async function deleteSectionAction(courseId: string, sectionId: string): Promise<void> {
  const { supabase } = await requireInstructor();
  const { data: lessons } = await supabase.from('lessons').select('id').eq('section_id', sectionId).eq('course_id', courseId);
  for (const l of lessons ?? []) await deleteLessonMedia(l.id);
  await supabase.from('sections').delete().eq('id', sectionId).eq('course_id', courseId);
  revalidatePath(`/instructor/courses/${courseId}`);
}

export async function addLessonAction(courseId: string, sectionId: string, _: ActionState, formData: FormData): Promise<ActionState> {
  const { supabase } = await requireInstructor();
  const p = parseForm(lessonCreateSchema, formData);
  if (!p.ok) return fail('err.invalid_input');
  const { error } = await supabase.from('lessons').insert({ section_id: sectionId, title: p.data.title, type: p.data.type, position: await nextPosition(supabase, 'lessons', 'section_id', sectionId) });
  if (error) return fail('err.forbidden');
  revalidatePath(`/instructor/courses/${courseId}`);
  return { ok: true };
}

export async function moveAction(courseId: string, kind: 'section' | 'lesson', id: string, dir: 'up' | 'down'): Promise<void> {
  const { supabase } = await requireInstructor();
  const table = kind === 'section' ? 'sections' : 'lessons';
  const { data: me } = await supabase.from(table).select('*').eq('id', id).maybeSingle();
  if (!me) return;
  const parentCol = kind === 'section' ? 'course_id' : 'section_id';
  const { data: siblings } = await supabase.from(table).select('id, position').eq(parentCol, me[parentCol]).order('position').order('created_at');
  const list = siblings ?? [];
  const i = list.findIndex((s: any) => s.id === id);
  const j = dir === 'up' ? i - 1 : i + 1;
  if (i < 0 || j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
  for (let idx = 0; idx < list.length; idx++) await supabase.from(table).update({ position: idx }).eq('id', list[idx].id);
  revalidatePath(`/instructor/courses/${courseId}`);
}

export async function updateLessonAction(courseId: string, lessonId: string, _: ActionState, formData: FormData): Promise<ActionState> {
  const { supabase } = await requireInstructor();
  const p = parseForm(lessonUpdateSchema, formData);
  if (!p.ok) return fail('err.invalid_input');
  const { data, error } = await supabase
    .from('lessons')
    .update({ title: p.data.title, description: p.data.description ?? null, is_free_preview: p.data.isFreePreview, availability_starts_at: p.data.availabilityStartsAt || null, availability_ends_at: p.data.availabilityEndsAt || null, max_watch_minutes: p.data.maxWatchMinutes ?? null, watermark_enabled: p.data.watermarkEnabled ?? true, seek_allowed: p.data.seekAllowed ?? true })
    .eq('id', lessonId)
    .select('id, type')
    .maybeSingle();
  if (error || !data) return fail('err.forbidden');
  if (data.type === 'text') {
    const { error: e2 } = await supabase.from('lesson_contents').upsert({ lesson_id: lessonId, body: p.data.body ?? '' }, { onConflict: 'lesson_id' });
    if (e2) return fail('err.generic');
  }
  revalidatePath(`/instructor/courses/${courseId}`);
  return ok('msg.saved');
}

export async function deleteLessonAction(courseId: string, lessonId: string): Promise<void> {
  const { supabase } = await requireInstructor();
  const { data } = await supabase.from('lessons').select('id').eq('id', lessonId).eq('course_id', courseId).maybeSingle();
  if (!data) return;
  await deleteLessonMedia(lessonId);
  await supabase.from('lessons').delete().eq('id', lessonId);
  redirect(`/instructor/courses/${courseId}`);
}

export async function deleteResourceAction(courseId: string, lessonId: string, resourceId: string): Promise<void> {
  const { supabase } = await requireInstructor();
  const { data: ok } = await supabase.rpc('can_manage_course', { p_course_id: courseId });
  if (!ok) return;
  const admin = createAdminClient();
  const { data: r } = await admin.from('lesson_resources').select('object_key').eq('id', resourceId).eq('course_id', courseId).maybeSingle();
  if (r) {
    await deleteObject(r.object_key).catch(() => undefined);
    await admin.from('lesson_resources').delete().eq('id', resourceId);
  }
  revalidatePath(`/instructor/courses/${courseId}/lessons/${lessonId}`);
}

// ----- assessments -----
export async function createQuizAction(courseId: string, _: ActionState, formData: FormData): Promise<ActionState> {
  const { supabase } = await requireInstructor();
  const p = parseForm(quizSchema, formData);
  if (!p.ok) return fail('err.invalid_input');
  const { error } = await supabase.from('quizzes').insert({ course_id: courseId, title: p.data.title, pass_percent: p.data.passPercent, duration_minutes: p.data.durationMinutes ?? null, question_time_seconds: p.data.questionTimeSeconds ?? null, attempts_limit: p.data.attemptsLimit ?? null, shuffle_questions: p.data.shuffleQuestions ?? false, shuffle_options: p.data.shuffleOptions ?? false, available_from: p.data.availableFrom || null, available_until: p.data.availableUntil || null });
  if (error) return fail('err.forbidden');
  revalidatePath(`/instructor/courses/${courseId}/assessments`);
  return { ok: true };
}

export async function addQuestionAction(courseId: string, quizId: string, _: ActionState, formData: FormData): Promise<ActionState> {
  const { supabase } = await requireInstructor();
  const p = parseForm(questionSchema, formData);
  if (!p.ok) return fail('err.invalid_input');
  const opts = [p.data.option1, p.data.option2, p.data.option3, p.data.option4].filter(Boolean) as string[];
  const options = [p.data.option1, p.data.option2, p.data.option3, p.data.option4]
    .map((text, i) => (text ? { id: `o${i + 1}`, text } : null))
    .filter(Boolean);
  if (opts.length < 2) return fail('err.invalid_input');
  const { count } = await supabase.from('questions').select('id', { count: 'exact', head: true }).eq('quiz_id', quizId);
  const { data: q, error } = await supabase.from('questions').insert({ quiz_id: quizId, prompt: p.data.prompt, options, position: count ?? 0 }).select('id').single();
  if (error || !q) return fail('err.forbidden');
  const { error: kErr } = await supabase.from('question_keys').insert({ question_id: q.id, correct_option_id: `o${p.data.correct}`, explanation: p.data.explanation ?? null });
  if (kErr) {
    await supabase.from('questions').delete().eq('id', q.id);
    return fail('err.generic');
  }
  revalidatePath(`/instructor/courses/${courseId}/assessments`);
  return { ok: true };
}

export async function toggleQuizPublishAction(courseId: string, quizId: string, publish: boolean): Promise<void> {
  const { supabase } = await requireInstructor();
  await supabase.from('quizzes').update({ is_published: publish }).eq('id', quizId).eq('course_id', courseId);
  revalidatePath(`/instructor/courses/${courseId}/assessments`);
}

export async function deleteQuizAction(courseId: string, quizId: string): Promise<void> {
  const { supabase } = await requireInstructor();
  await supabase.from('quizzes').delete().eq('id', quizId).eq('course_id', courseId);
  revalidatePath(`/instructor/courses/${courseId}/assessments`);
}

export async function deleteQuestionAction(courseId: string, questionId: string): Promise<void> {
  const { supabase } = await requireInstructor();
  await supabase.from('questions').delete().eq('id', questionId);
  revalidatePath(`/instructor/courses/${courseId}/assessments`);
}

export async function createAssignmentAction(courseId: string, _: ActionState, formData: FormData): Promise<ActionState> {
  const { supabase } = await requireInstructor();
  const p = parseForm(assignmentSchema, formData);
  if (!p.ok) return fail('err.invalid_input');
  const { error } = await supabase.from('assignments').insert({ course_id: courseId, title: p.data.title, instructions: p.data.instructions, max_score: p.data.maxScore, due_at: p.data.dueAt || null, duration_minutes: p.data.durationMinutes ?? null, available_from: p.data.availableFrom || null, available_until: p.data.availableUntil || null, allow_late_submission: p.data.allowLateSubmission ?? true });
  if (error) return fail('err.forbidden');
  revalidatePath(`/instructor/courses/${courseId}/assessments`);
  return { ok: true };
}

export async function toggleAssignmentPublishAction(courseId: string, id: string, publish: boolean): Promise<void> {
  const { supabase } = await requireInstructor();
  await supabase.from('assignments').update({ is_published: publish }).eq('id', id).eq('course_id', courseId);
  revalidatePath(`/instructor/courses/${courseId}/assessments`);
}

export async function deleteAssignmentAction(courseId: string, id: string): Promise<void> {
  const { supabase } = await requireInstructor();
  await supabase.from('assignments').delete().eq('id', id).eq('course_id', courseId);
  revalidatePath(`/instructor/courses/${courseId}/assessments`);
}

export async function gradeSubmissionAction(courseId: string, submissionId: string, _: ActionState, formData: FormData): Promise<ActionState> {
  const { supabase, user } = await requireInstructor();
  const p = parseForm(gradeSchema, formData);
  if (!p.ok) return fail('err.invalid_input');
  const { error } = await supabase.rpc('grade_submission', { p_submission_id: submissionId, p_score: p.data.score, p_feedback: p.data.feedback ?? '' });
  if (error) return fail('err.forbidden');
  const admin = createAdminClient();
  const { data: s } = await admin.from('submissions').select('user_id, assignments(title)').eq('id', submissionId).maybeSingle();
  if (s) {
    const title = Array.isArray((s as any).assignments) ? (s as any).assignments[0]?.title : (s as any).assignments?.title;
    await admin.from('notifications').insert({ user_id: s.user_id, type: 'graded', title: title ?? 'Assignment', body: String(p.data.score), link: `/dashboard` });
  }
  await audit({ actorId: user.id, action: 'assignment.graded', entityType: 'submission', entityId: submissionId });
  revalidatePath(`/instructor/courses/${courseId}/assessments`);
  return ok('msg.saved');
}

/** An announcement is stored for the course (shown in the player) and pushed as a notification to enrolled students. */
export async function announceAction(courseId: string, _: ActionState, formData: FormData): Promise<ActionState> {
  const { supabase, user } = await requireInstructor();
  const p = parseForm(announcementSchema, formData);
  if (!p.ok) return fail('err.invalid_input');
  const { error } = await supabase.from('announcements').insert({ course_id: courseId, author_id: user.id, title: p.data.title, body: p.data.body });
  if (error) return fail('err.forbidden'); // RLS: only course managers
  const admin = createAdminClient();
  const { data: students } = await admin.from('enrollments').select('user_id').eq('course_id', courseId).limit(5000);
  const { data: course } = await admin.from('courses').select('slug').eq('id', courseId).single();
  const rows = (students ?? []).map((s) => ({ user_id: s.user_id, type: 'announcement', title: p.data.title, body: p.data.body.slice(0, 300), link: `/learn/${course?.slug}` }));
  if (rows.length) await admin.from('notifications').insert(rows);
  await audit({ actorId: user.id, action: 'course.announcement', entityType: 'course', entityId: courseId, metadata: { recipients: rows.length } });
  revalidatePath(`/instructor/courses/${courseId}/students`);
  return ok('msg.sent');
}

export async function deleteAnnouncementAction(courseId: string, id: string): Promise<void> {
  const { supabase } = await requireInstructor();
  await supabase.from('announcements').delete().eq('id', id).eq('course_id', courseId);
  revalidatePath(`/instructor/courses/${courseId}/students`);
}
