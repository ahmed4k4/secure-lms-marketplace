import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { getT } from '@/lib/i18n';
import { issueCertificateAction } from '@/actions/learning';
import { Alert, Card, CardBody } from '@/components/ui/primitives';
import { Button, buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export default async function LearnOverview({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ error?: string }> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const { supabase, user } = await requireUser(`/learn/${slug}`);
  const { t } = await getT();
  const { data: course } = await supabase.from('courses').select('id, slug, title, description').eq('slug', slug).maybeSingle();
  if (!course) notFound();
  const [a, m] = await Promise.all([supabase.rpc('has_course_access', { p_course_id: course.id }), supabase.rpc('can_manage_course', { p_course_id: course.id })]);
  if (a.data !== true && m.data !== true) redirect(`/courses/${slug}`);

  const [{ data: sections }, { data: progress }, { data: cert }] = await Promise.all([
    supabase.from('sections').select('position, lessons(id, position)').eq('course_id', course.id).order('position'),
    supabase.from('lesson_progress').select('lesson_id, completed').eq('user_id', user.id).eq('course_id', course.id),
    supabase.from('certificates').select('code').eq('user_id', user.id).eq('course_id', course.id).maybeSingle(),
  ]);
  const ordered = (sections ?? []).flatMap((s) => [...(s.lessons as any[])].sort((x, y) => x.position - y.position));
  const done = new Set((progress ?? []).filter((p) => p.completed).map((p) => p.lesson_id));
  const next = ordered.find((l) => !done.has(l.id)) ?? ordered[0];
  const complete = ordered.length > 0 && ordered.every((l) => done.has(l.id));

  return (
    <div className="space-y-5">
      <h1 className="text-3xl">{course.title}</h1>
      {sp.error === 'incomplete' && <Alert tone="warn">{t('learn.incomplete')}</Alert>}
      {next ? <Link href={`/learn/${slug}/${next.id}`} className={cn(buttonVariants({ size: 'lg' }))}>{done.size ? t('course.continue') : t('learn.start')}</Link> : <Alert>{t('course.no_curriculum')}</Alert>}
      {complete && m.data !== true && (
        <Card><CardBody className="flex flex-wrap items-center gap-3">
          <p className="font-medium">{t('learn.completed')}</p>
          {cert ? <Link href={`/certificates/${cert.code}`} className={cn(buttonVariants({ variant: 'accent' }))}>{t('dash.certificate')}</Link>
            : <form action={issueCertificateAction.bind(null, course.id, slug)}><Button variant="accent">{t('learn.get_certificate')}</Button></form>}
        </CardBody></Card>
      )}
    </div>
  );
}
