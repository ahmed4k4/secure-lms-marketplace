import { notFound } from 'next/navigation';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { getT } from '@/lib/i18n';
import { CourseCard, type CatalogCourse } from '@/components/course-card';
import { Bus, MonoLabel } from '@/components/ui/brand';
import { EmptyState } from '@/components/ui/primitives';
import { formatCount, initials } from '@/lib/utils';

export default async function InstructorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const { t, locale } = await getT();
  const supabase = await createClient();
  const { data: instructor } = await supabase.from('public_instructors').select('*').eq('id', id).maybeSingle();
  if (!instructor) notFound();
  const { data: courses } = await supabase.from('course_catalog').select('*').eq('owner_id', id).order('published_at', { ascending: false });
  const students = (courses ?? []).reduce((n, c) => n + Number(c.student_count ?? 0), 0);

  return (
    <div className="space-y-10">
      <header className="chrome-edge relative overflow-hidden rounded-lg !bg-deep p-6 md:p-10">
        <Bus className="absolute inset-y-0 end-0 hidden h-full w-1/2 opacity-40 md:block" accent={false} />
        <div className="relative flex flex-wrap items-start gap-5">
          <span aria-hidden className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full border-2 border-arc bg-card font-display text-2xl font-semibold text-arc">{initials(instructor.full_name)}</span>
          <div className="min-w-0 flex-1">
            <MonoLabel>{'// INSTRUCTOR'}</MonoLabel>
            <h1 className="mt-1 text-3xl md:text-4xl">{instructor.full_name}</h1>
            {instructor.headline && <p className="mt-1 text-silver">{instructor.headline}</p>}
            <p className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted-foreground">
              <span><span dir="ltr" className="num text-foreground">{courses?.length ?? 0}</span> {t('nav.courses')}</span>
              <span><span dir="ltr" className="num text-foreground">{formatCount(students, locale)}</span> {t('course.students')}</span>
              {instructor.website && <a href={instructor.website} rel="noopener noreferrer nofollow" target="_blank" className="text-arc hover:underline" dir="ltr">{instructor.website.replace(/^https?:\/\//, '')}</a>}
            </p>
          </div>
        </div>
      </header>
      {instructor.bio && <p className="max-w-3xl whitespace-pre-wrap leading-8 text-silver">{instructor.bio}</p>}
      <section>
        <h2 className="mb-4 text-2xl">{t('nav.courses')}</h2>
        {courses?.length ? <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">{(courses as CatalogCourse[]).map((c) => <CourseCard key={c.id} course={c} locale={locale} t={t} />)}</div> : <EmptyState title={t('catalog.empty')} />}
      </section>
    </div>
  );
}
