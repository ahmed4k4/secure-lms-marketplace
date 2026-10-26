import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { requireUser } from '@/lib/auth';
import { getT } from '@/lib/i18n';
import { LessonPanel } from '@/components/lesson-panel';
import { Alert } from '@/components/ui/primitives';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export default async function LessonPage({ params }: { params: Promise<{ slug: string; lessonId: string }> }) {
  const { slug, lessonId } = await params;
  if (!z.string().uuid().safeParse(lessonId).success) notFound();
  const { supabase, user } = await requireUser(`/learn/${slug}/${lessonId}`);
  const { t } = await getT();

  const { data: course } = await supabase.from('courses').select('id, slug, title').eq('slug', slug).maybeSingle();
  if (!course) notFound();
  const { data: lesson } = await supabase.from('lessons').select('id, title, description, type, is_free_preview, course_id, availability_starts_at, availability_ends_at').eq('id', lessonId).eq('course_id', course.id).maybeSingle();
  if (!lesson) notFound();
  const now = Date.now();
  if (lesson.availability_starts_at && now < Date.parse(lesson.availability_starts_at)) {
    return <div className="space-y-4"><h1 className="text-2xl">{lesson.title}</h1><Alert tone="warn">هذا الدرس لم يصبح متاحًا بعد. يرجى العودة في الموعد المحدد.</Alert><Link href={`/courses/${slug}`} className={cn(buttonVariants())}>{t('learn.view_course')}</Link></div>;
  }
  if (lesson.availability_ends_at && now >= Date.parse(lesson.availability_ends_at)) {
    return <div className="space-y-4"><h1 className="text-2xl">{lesson.title}</h1><Alert tone="warn">انتهت فترة إتاحة هذا الدرس.</Alert><Link href={`/courses/${slug}`} className={cn(buttonVariants())}>{t('learn.view_course')}</Link></div>;
  }

  // The same Postgres function that guards playback decides here too.
  const { data: allowed } = await supabase.rpc('can_access_lesson', { p_lesson_id: lesson.id });
  if (!allowed) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl">{lesson.title}</h1>
        <Alert tone="warn">{t('learn.locked')}</Alert>
        <Link href={`/courses/${slug}`} className={cn(buttonVariants())}>{t('learn.view_course')}</Link>
      </div>
    );
  }

  const [{ data: progress }, { data: content }, { data: resources }, { data: sections }, { data: notes }, { data: announcements }] = await Promise.all([
    supabase.from('lesson_progress').select('position_seconds, completed').eq('user_id', user.id).eq('lesson_id', lesson.id).maybeSingle(),
    lesson.type === 'text' ? supabase.from('lesson_contents').select('body').eq('lesson_id', lesson.id).maybeSingle() : Promise.resolve({ data: null }),
    supabase.from('lesson_resources').select('id, title, size_bytes').eq('lesson_id', lesson.id).order('created_at').limit(100),
    supabase.from('sections').select('position, lessons(id, title, position)').eq('course_id', course.id).order('position'),
    supabase.from('lesson_notes').select('id, position_seconds, body').eq('user_id', user.id).eq('lesson_id', lesson.id).order('position_seconds').limit(100),
    supabase.from('announcements').select('id, title, body, created_at').eq('course_id', course.id).order('created_at', { ascending: false }).limit(20),
  ]);

  const ordered = (sections ?? []).flatMap((s) => [...(s.lessons as any[])].sort((a, b) => a.position - b.position));
  const idx = ordered.findIndex((l) => l.id === lesson.id);

  return (
    <LessonPanel
      courseId={course.id} slug={slug} lesson={{ id: lesson.id, title: lesson.title, description: lesson.description, type: lesson.type }}
      body={content?.body ?? null} startAt={progress?.position_seconds ?? 0} completed={!!progress?.completed}
      prevHref={ordered[idx - 1] ? `/learn/${slug}/${ordered[idx - 1].id}` : undefined} nextHref={ordered[idx + 1] ? `/learn/${slug}/${ordered[idx + 1].id}` : undefined}
      resources={(resources ?? []) as any} notes={notes ?? []} viewerId={user.id} announcements={announcements ?? []}
    />
  );
}
