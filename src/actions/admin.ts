'use server';
import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/lib/auth';
import { getT } from '@/lib/i18n';
import { audit } from '@/lib/audit';
import {
  categorySchema, createInstructorSchema, grantSchema, parseForm, rejectSchema, roleChangeSchema, settingsSchema, type ActionState,
} from '@/lib/validation';
import { fail, ok } from './helpers';
import { publicEnv } from '@/lib/env';

async function roleId(admin: any, key: string) {
  const { data } = await admin.from('roles').select('id').eq('key', key).single();
  return data?.id as string;
}
async function targetRoles(admin: any, userId: string): Promise<string[]> {
  const { data } = await admin.from('user_roles').select('roles(key)').eq('user_id', userId);
  return (data ?? []).map((r: any) => (Array.isArray(r.roles) ? r.roles[0]?.key : r.roles?.key)).filter(Boolean);
}

export async function createInstructorAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const { admin, user } = await requirePermission('instructors.manage');
  const { t, locale } = await getT();
  const p = parseForm(createInstructorSchema, formData);
  if (!p.ok) return { error: t('err.invalid_input') };
  const { data, error } = await admin.auth.admin.inviteUserByEmail(p.data.email, {
    data: { full_name: p.data.fullName, locale },
    redirectTo: `${publicEnv.siteUrl}/auth/callback?next=/reset-password`,
  });
  if (error || !data.user) return { error: /registered|exists/i.test(error?.message ?? '') ? t('admin.email_taken') : t('err.email_delivery') };
  const id = data.user.id;
  // Auth trigger creates the least-privileged default role; replace it with exactly one instructor role.
  await admin.from('user_roles').delete().eq('user_id', id);
  const { error: roleError } = await admin.from('user_roles').insert({ user_id: id, role_id: await roleId(admin, 'instructor'), granted_by: user.id });
  if (roleError) { await admin.auth.admin.deleteUser(id); return { error: t('err.generic') }; }
  const { error: profileError } = await admin.from('instructor_profiles').insert({ user_id: id, status: 'active' });
  if (profileError) { await admin.auth.admin.deleteUser(id); return { error: t('err.generic') }; }
  await audit({ actorId: user.id, action: 'instructor.invited', entityType: 'user', entityId: id });
  revalidatePath('/admin/instructors');
  return { ok: true, message: t('admin.instructor_invited'), data: { email: p.data.email } };
}

export async function setInstructorStatusAction(userId: string, status: 'active' | 'suspended'): Promise<void> {
  const { admin, user } = await requirePermission('instructors.manage');
  await admin.from('instructor_profiles').update({ status }).eq('user_id', userId);
  await audit({ actorId: user.id, action: `instructor.${status === 'active' ? 'activated' : 'suspended'}`, entityType: 'user', entityId: userId });
  revalidatePath('/admin/instructors');
}

export async function setAccountStatusAction(userId: string, suspend: boolean, formData?: FormData): Promise<void> {
  const { admin, user, roles } = await requirePermission('users.manage');
  if (userId === user.id) return;
  const target = await targetRoles(admin, userId);
  if (target.includes('super_admin') && !roles.includes('super_admin')) return;
  if (target.includes('admin') && !roles.includes('super_admin')) return;
  const reason = suspend ? String(formData?.get('reason') ?? '').slice(0, 300) || null : null;
  await admin.from('profiles').update({ status: suspend ? 'suspended' : 'active', suspended_reason: reason }).eq('id', userId);
  // Ban blocks new logins and token refresh; the DB status check blocks everything immediately.
  await admin.auth.admin.updateUserById(userId, { ban_duration: suspend ? '876000h' : 'none' });
  await audit({ actorId: user.id, action: suspend ? 'user.suspended' : 'user.activated', entityType: 'user', entityId: userId, metadata: { reason } });
  revalidatePath('/admin/users');
}

export async function changeRoleAction(formData: FormData): Promise<void> {
  const { supabase, admin, user } = await requirePermission('admins.manage');
  const p = parseForm(roleChangeSchema, formData);
  if (!p.ok || p.data.userId === user.id) return;
  const current = await targetRoles(admin, p.data.userId);
  if (current.includes('super_admin')) return; // super admins are managed out-of-band
  const { error: roleError } = await supabase.rpc('set_platform_role', { p_user_id: p.data.userId, p_role: p.data.role });
  if (roleError) return;
  await audit({ actorId: user.id, action: 'role.changed', entityType: 'user', entityId: p.data.userId, metadata: { from: current, to: p.data.role } });
  revalidatePath('/admin/users');
}

export async function reviewCourseAction(courseId: string, decision: 'approve' | 'reject' | 'suspend' | 'archive' | 'restore', _: ActionState, formData: FormData): Promise<ActionState> {
  // Permission is checked against the signed-in user's session before the privileged client is obtained.
  // Use the server client for the mutation so course review does not depend on broad client-side UPDATE grants.
  const { admin, user } = await requirePermission('courses.review');
  const { t } = await getT();
  let reason: string | null = null;
  if (decision === 'reject' || decision === 'suspend') {
    const p = parseForm(rejectSchema, formData);
    if (!p.ok) return { error: t('admin.reason_required') };
    reason = p.data.reason;
  }

  const { data: course, error: readError } = await admin.from('courses')
    .select('id,title,created_by,status,category_id,category_request_id')
    .eq('id', courseId).maybeSingle();
  if (readError || !course) {
    console.error('[admin.course-review] unable to load course', { courseId, code: readError?.code, message: readError?.message });
    return fail('err.forbidden');
  }
  if (decision === 'approve' || decision === 'restore') {
    if (!course.category_id || course.category_request_id || !['in_review','rejected','suspended','archived'].includes(course.status)) {
      return { error: course.category_request_id || !course.category_id ? (t('course.new_category_hint')) : t('err.invalid_input') };
    }
    const [{ count: lessonCount, error: lessonError }, { data: instructor, error: instructorError }] = await Promise.all([
      admin.from('lessons').select('id', { count: 'exact', head: true }).eq('course_id', courseId),
      admin.from('instructor_profiles').select('status').eq('user_id', course.created_by).maybeSingle(),
    ]);
    if (lessonError || instructorError) {
      console.error('[admin.course-review] prerequisite check failed', { courseId, lessonError: lessonError?.message, instructorError: instructorError?.message });
      return fail('err.generic');
    }
    if (!lessonCount) return { error: t('instr.need_lessons') };
    if (instructor?.status !== 'active') return { error: t('instr.reason') + ': instructor account is not active' };
  }
  const status = { approve: 'published', restore: 'published', reject: 'rejected', suspend: 'suspended', archive: 'archived' }[decision];
  const patch: Record<string, unknown> = { status, rejection_reason: reason };
  if (status === 'published') patch.published_at = new Date().toISOString();
  const { data, error } = await admin.from('courses').update(patch).eq('id', courseId)
    .select('id,title,created_by,status').maybeSingle();
  if (error || !data) {
    console.error('[admin.course-review] update failed', { courseId, decision, code: error?.code, message: error?.message });
    return fail('err.forbidden');
  }
  const type = { approve: 'course_approved', restore: 'course_approved', reject: 'course_rejected', suspend: 'course_suspended', archive: 'course_archived' }[decision];
  const { error: notificationError } = await admin.from('notifications').insert({ user_id: data.created_by, type, title: data.title, body: reason, link: `/instructor/courses/${courseId}` });
  if (notificationError) console.error('[admin.course-review] notification failed', { courseId, message: notificationError.message });
  await audit({ actorId: user.id, action: `course.${decision}`, entityType: 'course', entityId: courseId, metadata: { reason, previousStatus: course.status, nextStatus: status } });
  revalidatePath('/admin');
  revalidatePath('/admin/courses');
  revalidatePath('/courses');
  revalidatePath(`/courses/${courseId}`);
  revalidatePath(`/instructor/courses/${courseId}`);
  return ok('msg.saved');
}

export async function grantAccessAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const { admin, user } = await requirePermission('entitlements.grant');
  const { t } = await getT();
  const p = parseForm(grantSchema, formData);
  if (!p.ok) return { error: t('err.invalid_input') };
  const { data: uid } = await admin.rpc('find_user_id_by_email', { p_email: p.data.email });
  if (!uid) return { error: t('admin.user_not_found') };
  const { data: course } = await admin.from('courses').select('id, title, status').eq('id', p.data.courseId).maybeSingle();
  if (!course || !['published', 'archived'].includes(course.status)) return { error: t('admin.course_not_published') };
  const expires = p.data.days ? new Date(Date.now() + p.data.days * 86_400_000).toISOString() : null;
  const { data: ent, error } = await admin.from('entitlements')
    .insert({ user_id: uid, course_id: course.id, source: 'admin_grant', granted_by: user.id, expires_at: expires, note: p.data.note ?? null })
    .select('id').single();
  if (error || !ent) return { error: t('err.generic') };
  await admin.from('enrollments').upsert({ user_id: uid, course_id: course.id }, { onConflict: 'user_id,course_id', ignoreDuplicates: true });
  await admin.from('notifications').insert({ user_id: uid, type: 'access_granted', title: course.title, link: '/dashboard' });
  await audit({ actorId: user.id, action: 'entitlement.granted', entityType: 'entitlement', entityId: ent.id, metadata: { userId: uid, courseId: course.id, expires } });
  revalidatePath('/admin/entitlements');
  return ok('msg.saved');
}

export async function revokeEntitlementAction(entitlementId: string): Promise<void> {
  const { admin, user } = await requirePermission('entitlements.manage');
  const { data } = await admin.from('entitlements')
    .update({ status: 'revoked', revoked_at: new Date().toISOString(), revoked_reason: 'admin', revoked_by: user.id })
    .eq('id', entitlementId).eq('status', 'active').select('user_id, course_id').maybeSingle();
  if (data) {
    // Also end any live playback sessions so the next playback-token request is re-checked immediately.
    await admin.from('playback_sessions').delete().eq('user_id', data.user_id);
    await audit({ actorId: user.id, action: 'entitlement.revoked', entityType: 'entitlement', entityId: entitlementId, metadata: { userId: data.user_id, courseId: data.course_id } });
  }
  revalidatePath('/admin/entitlements');
}

export async function saveCategoryAction(id: string | null, _: ActionState, formData: FormData): Promise<ActionState> {
  const { supabase, user } = await requirePermission('categories.manage');
  const p = parseForm(categorySchema, formData);
  if (!p.ok) return fail('err.invalid_input');
  const row = { slug: p.data.slug, name_en: p.data.nameEn, name_ar: p.data.nameAr };
  const { error } = id ? await supabase.from('categories').update(row).eq('id', id) : await supabase.from('categories').insert(row);
  if (error) return fail('err.generic');
  await audit({ actorId: user.id, action: id ? 'category.updated' : 'category.created', entityType: 'category', entityId: id ?? p.data.slug });
  revalidatePath('/admin/categories');
  return ok('msg.saved');
}

export async function reviewCategoryRequestAction(id: string, decision: 'approve' | 'reject', _: ActionState, formData: FormData): Promise<ActionState> {
  const { supabase, admin, user } = await requirePermission('categories.manage');
  const { t } = await getT();
  let reason: string | null = null;
  if (decision === 'reject') reason = String(formData.get('reason') ?? '').trim().slice(0, 500) || null;
  const { data: request } = await admin.from('category_requests').select('id, slug, name_en, name_ar, requested_by').eq('id', id).maybeSingle();
  if (!request) return fail('err.not_found');
  const { data: affected } = await admin.from('courses').select('id, title, created_by').eq('category_request_id', id);
  const { data, error } = await supabase.rpc('review_category_request', { p_request_id: id, p_decision: decision, p_reason: reason });
  if (error || !data) return fail('err.forbidden');
  const title = decision === 'approve' ? t('admin.category_approved') : t('admin.category_rejected');
  const owners = new Map<string, { title: string; link: string }>();
  for (const course of affected ?? []) owners.set(course.created_by, { title: course.title, link: `/instructor/courses/${course.id}` });
  if (owners.size) await admin.from('notifications').insert([...owners.entries()].map(([user_id, item]) => ({ user_id, type: decision === 'approve' ? 'category_approved' : 'category_rejected', title: `${title}: ${decision === 'approve' ? request.name_en : request.name_en}`, body: reason, link: item.link })));
  await audit({ actorId: user.id, action: `category_request.${decision}`, entityType: 'category_request', entityId: id, metadata: { slug: request.slug, updated_courses: (data as any).updated_courses ?? 0, reason } });
  revalidatePath('/admin/categories');
  revalidatePath('/admin/courses');
  revalidatePath('/instructor');
  for (const course of affected ?? []) revalidatePath(`/instructor/courses/${course.id}`);
  return ok('msg.saved');
}

export async function deleteCategoryAction(id: string): Promise<void> {
  const { supabase, user } = await requirePermission('categories.manage');
  await supabase.from('categories').delete().eq('id', id);
  await audit({ actorId: user.id, action: 'category.deleted', entityType: 'category', entityId: id });
  revalidatePath('/admin/categories');
}

export async function hideReviewAction(reviewId: string, hide: boolean): Promise<void> {
  const { admin, user } = await requirePermission('moderation.manage');
  await admin.from('reviews').update({ is_hidden: hide }).eq('id', reviewId);
  await audit({ actorId: user.id, action: hide ? 'review.hidden' : 'review.restored', entityType: 'review', entityId: reviewId });
  revalidatePath('/admin/reviews');
}

export async function saveSettingsAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const { admin, user } = await requirePermission('admins.manage');
  const p = parseForm(settingsSchema, formData);
  if (!p.ok) return fail('err.invalid_input');
  const rows = Object.entries(p.data).map(([key, value]) => ({ key, value, updated_by: user.id, updated_at: new Date().toISOString() }));
  const { error } = await admin.from('platform_settings').upsert(rows, { onConflict: 'key' });
  if (error) return fail('err.generic');
  await audit({ actorId: user.id, action: 'settings.updated', metadata: p.data });
  revalidatePath('/admin/settings');
  return ok('msg.saved');
}

/** Edits what the generic `admin` role may do. Only super admins hold admins.manage; that permission can never be delegated. */
export async function savePermissionsAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const { admin, user } = await requirePermission('admins.manage');
  const { data: role } = await admin.from('roles').select('id').eq('key', 'admin').single();
  const { data: all } = await admin.from('permissions').select('key');
  if (!role || !all) return fail('err.generic');
  const wanted = new Set(formData.getAll('perm').map(String).filter((k) => k !== 'admins.manage' && all.some((p) => p.key === k)));
  const { data: current } = await admin.from('role_permissions').select('permission_key').eq('role_id', role.id);
  const have = new Set((current ?? []).map((c) => c.permission_key));
  const add = [...wanted].filter((k) => !have.has(k));
  const drop = [...have].filter((k) => !wanted.has(k));
  if (add.length) await admin.from('role_permissions').insert(add.map((k) => ({ role_id: role.id, permission_key: k })));
  if (drop.length) await admin.from('role_permissions').delete().eq('role_id', role.id).in('permission_key', drop);
  await audit({ actorId: user.id, action: 'role.permissions_changed', entityType: 'role', entityId: role.id, metadata: { added: add, removed: drop } });
  revalidatePath('/admin/roles');
  return ok('msg.saved');
}
