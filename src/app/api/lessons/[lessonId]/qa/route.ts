import { z } from 'zod';
import { ApiError, handle, json, requireApiUser } from '@/lib/api';
import { createAdminClient } from '@/lib/supabase/admin';

type Ctx = { params: Promise<{ lessonId: string }> };

/** Q&A is loaded on demand and only for users who can access the course. */
export const GET = handle<Ctx>(async (req, { params }) => {
  const { lessonId } = await params;
  if (!z.string().uuid().safeParse(lessonId).success) throw new ApiError(404, 'NOT_FOUND', 'Lesson not found.');
  const { supabase, user } = await requireApiUser();
  const { data: lesson, error: lessonError } = await supabase.from('lessons').select('id, course_id').eq('id', lessonId).maybeSingle();
  if (lessonError) throw new ApiError(503, 'QA_UNAVAILABLE', 'Unable to load lesson questions.');
  if (!lesson) throw new ApiError(404, 'NOT_FOUND', 'Lesson not found.');

  const [{ data: canAccess }, { data: canManage }] = await Promise.all([
    supabase.rpc('has_course_access', { p_course_id: lesson.course_id }),
    supabase.rpc('can_manage_course', { p_course_id: lesson.course_id }),
  ]);
  if (canAccess !== true && canManage !== true) throw new ApiError(403, 'NO_ACCESS', 'Course access is required to view its questions.');

  const scope = req.nextUrl.searchParams.get('scope') === 'all' ? 'all' : 'lesson';
  let discussionQuery = supabase.from('discussions')
    .select('id, lesson_id, user_id, title, body, is_resolved, created_at')
    .eq('course_id', lesson.course_id)
    .order('created_at', { ascending: false })
    .limit(30);
  if (scope === 'lesson') discussionQuery = discussionQuery.eq('lesson_id', lessonId);
  const { data: discussions, error: discussionError } = await discussionQuery;
  if (discussionError) throw new ApiError(503, 'QA_UNAVAILABLE', 'Unable to load lesson questions.');
  const threadIds = (discussions ?? []).map((item) => item.id);
  const lessonIds = [...new Set((discussions ?? []).map((item) => item.lesson_id).filter((id): id is string => Boolean(id)))];
  const [{ data: replies, error: repliesError }, { data: staff, error: staffError }, { data: lessons, error: lessonsError }] = await Promise.all([
    threadIds.length
      ? supabase.from('discussion_replies').select('id, discussion_id, user_id, body, created_at').in('discussion_id', threadIds).order('created_at', { ascending: false }).limit(150)
      : Promise.resolve({ data: [], error: null }),
    supabase.from('course_instructors').select('instructor_id').eq('course_id', lesson.course_id),
    lessonIds.length ? supabase.from('lessons').select('id, title').in('id', lessonIds) : Promise.resolve({ data: [], error: null }),
  ]);
  if (repliesError || staffError || lessonsError) throw new ApiError(503, 'QA_UNAVAILABLE', 'Unable to load lesson questions.');

  const staffIds = (staff ?? []).map((item) => item.instructor_id as string);
  const authorIds = [...new Set([...(discussions ?? []).map((item) => item.user_id), ...(replies ?? []).map((item) => item.user_id)])];
  const admin = createAdminClient();
  const { data: profiles, error: profilesError } = authorIds.length
    ? await admin.from('profiles').select('id, full_name').in('id', authorIds)
    : { data: [], error: null };
  if (profilesError) throw new ApiError(503, 'QA_UNAVAILABLE', 'Unable to load discussion authors.');
  const names: Record<string, string> = {};
  for (const profile of profiles ?? []) names[profile.id] = staffIds.includes(profile.id) ? profile.full_name : profile.full_name.split(' ')[0] || '—';
  const lessonTitles = Object.fromEntries((lessons ?? []).map((item) => [item.id, item.title]));

  return json({ discussions: discussions ?? [], replies: replies ?? [], names, staffIds, lessonTitles, viewerId: user.id, canModerate: canManage === true });
});
