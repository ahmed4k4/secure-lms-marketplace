import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { requireInstructor } from '@/lib/auth';
import { getT } from '@/lib/i18n';
import { createAdminClient } from '@/lib/supabase/admin';
import { QaThread } from '@/components/qa';

export default async function InstructorQuestions({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const { supabase, user } = await requireInstructor();
  const { t } = await getT();
  const { data: ok } = await supabase.rpc('can_manage_course', { p_course_id: id });
  if (!ok) notFound();
  const { data: course } = await supabase.from('courses').select('id, slug, title').eq('id', id).maybeSingle();
  if (!course) notFound();
  const [{ data: discussions }, { data: sections }] = await Promise.all([
    supabase.from('discussions').select('id, lesson_id, user_id, title, body, is_resolved, created_at').eq('course_id', id).order('is_resolved').order('created_at', { ascending: false }).limit(50),
    supabase.from('sections').select('lessons(id, title)').eq('course_id', id),
  ]);
  const ids = (discussions ?? []).map((d) => d.id);
  const { data: replies } = ids.length ? await supabase.from('discussion_replies').select('id, discussion_id, user_id, body, created_at').in('discussion_id', ids).order('created_at').limit(200) : { data: [] };
  const people = [...new Set([...(discussions ?? []).map((d) => d.user_id), ...(replies ?? []).map((r) => r.user_id)])];
  const admin = createAdminClient();
  const [{ data: profs }, { data: staff }] = await Promise.all([
    people.length ? admin.from('profiles').select('id, full_name').in('id', people) : Promise.resolve({ data: [] as { id: string; full_name: string }[] }),
    admin.from('course_instructors').select('instructor_id').eq('course_id', id),
  ]);
  const names = Object.fromEntries((profs ?? []).map((p) => [p.id, p.full_name]));
  const lessonTitles = Object.fromEntries((sections ?? []).flatMap((s: any) => s.lessons).map((l: any) => [l.id, l.title]));
  const open = (discussions ?? []).filter((d) => !d.is_resolved).length;

  return (
    <div className="space-y-5">
      <Link href={`/instructor/courses/${id}`} className="text-sm text-arc hover:underline">← {course.title}</Link>
      <div className="flex flex-wrap items-baseline gap-3"><h1 className="text-3xl">{t('instr.questions')}</h1><span className="text-sm text-muted-foreground"><span dir="ltr" className="num text-arc">{open}</span> {t('instr.open_questions')}</span></div>
      <QaThread courseId={id} slug={course.slug} path={`/instructor/courses/${id}/questions`} discussions={discussions ?? []} replies={replies ?? []} names={names}
        staffIds={(staff ?? []).map((s) => s.instructor_id as string)} viewerId={user.id} canModerate lessonTitles={lessonTitles} allowAsk={false} />
    </div>
  );
}
