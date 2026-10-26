import Link from 'next/link';
import { requirePermission } from '@/lib/auth';
import { getT } from '@/lib/i18n';
import { reviewCourseAction } from '@/actions/admin';
import { ActionForm } from '@/components/action-form';
import { Badge, EmptyState, Input, Select } from '@/components/ui/primitives';
import { Button, buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const STATUSES = ['all', 'category_pending', 'in_review', 'published', 'draft', 'rejected', 'suspended', 'archived'] as const;

export default async function AdminCourses({ searchParams }: { searchParams: Promise<{ status?: string; q?: string; instructor?: string }> }) {
  const { admin, supabase } = await requirePermission('courses.review');
  const { t, locale } = await getT();
  const sp = await searchParams;
  const status = (STATUSES as readonly string[]).includes(sp.status ?? '') ? sp.status! : 'in_review';
  const q = (sp.q ?? '').trim().slice(0, 100);
  const instructorId = sp.instructor && /^[0-9a-f-]{36}$/i.test(sp.instructor) ? sp.instructor : '';
  let query = admin.from('courses').select('id, slug, title, status, rejection_reason, updated_at, created_by, profiles:created_by(full_name)').order('updated_at', { ascending: false }).limit(200);
  if (status !== 'all') query = query.eq('status', status);
  if (q) query = query.ilike('title', `%${q.replace(/[%,()*\\:\"']/g, ' ')}%`);
  if (instructorId) query = query.eq('created_by', instructorId);
  const { data: courses, error } = await query;
  const { data: canCreate } = await supabase.rpc('has_permission', { p_perm: 'courses.manage' });
  const reasonInput = <Input name="reason" placeholder={t('admin.reason')} aria-label={t('admin.reason')} required minLength={3} maxLength={1000} className="h-8 w-56" />;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3"><div><h1 className="text-3xl">{t('admin.courses')}</h1><p className="mt-1 text-sm text-muted-foreground">{locale === 'ar' ? 'إدارة جميع الكورسات ومراجعتها وإنشاء مسودات للمدرسين.' : 'Manage the course catalog, review submissions, and create instructor-owned drafts.'}</p></div>{canCreate && <Link className={cn(buttonVariants())} href="/admin/courses/new">{locale === 'ar' ? '+ إضافة كورس' : '+ Create course'}</Link>}</div>
      <form className="grid gap-2 rounded-xl border border-border bg-card p-3 sm:grid-cols-[minmax(180px,1fr)_190px_auto]"><Input name="q" defaultValue={q} placeholder={locale === 'ar' ? 'ابحث باسم الكورس' : 'Search course title'} aria-label={locale === 'ar' ? 'ابحث باسم الكورس' : 'Search course title'} /><Select name="status" defaultValue={status} className="max-w-56" aria-label={t('instr.col_status')}>{STATUSES.map((s) => <option key={s} value={s}>{s === 'all' ? (locale === 'ar' ? 'كل الحالات' : 'All statuses') : t(`status.${s}` as never)}</option>)}</Select>{instructorId && <input type="hidden" name="instructor" value={instructorId} />}<Button variant="outline">{t('catalog.apply')}</Button></form>
      {error && <div role="alert" className="rounded-lg border border-red-500/40 bg-red-500/10 p-4 text-sm">{locale === 'ar' ? `فشل تحميل الكورسات: ${error.message}` : `Could not load courses: ${error.message}`}</div>}
      {courses?.length ? <ul className="space-y-3">{courses.map((c: any) => (
        <li key={c.id} className="rounded-xl border border-border bg-card p-4">
          <div className="flex flex-wrap items-center gap-2"><Link href={`/instructor/courses/${c.id}`} className="font-medium text-primary hover:underline">{c.title}</Link>{canCreate && <Link href={`/instructor/courses/${c.id}/assessments`} className="text-xs text-primary underline">{locale === 'ar' ? 'الاختبارات والواجبات' : 'Assessments'}</Link>}<Badge>{t(`status.${c.status}` as never)}</Badge><span className="text-sm text-muted-foreground">{(Array.isArray(c.profiles) ? c.profiles[0] : c.profiles)?.full_name || c.created_by}</span><span className="ms-auto text-xs text-muted-foreground">{new Intl.DateTimeFormat(locale === 'ar' ? 'ar-EG' : 'en', { dateStyle: 'medium' }).format(new Date(c.updated_at))}</span></div>
          {c.rejection_reason && <p className="mt-1 text-sm text-muted-foreground">{c.rejection_reason}</p>}
          <div className="mt-3 flex flex-wrap items-start gap-3">
            {c.status === 'in_review' && <><ActionForm action={reviewCourseAction.bind(null, c.id, 'approve')} submitLabel={t('admin.approve')}><span className="sr-only">{c.title}</span></ActionForm><ActionForm action={reviewCourseAction.bind(null, c.id, 'reject')} submitLabel={t('admin.reject')} variant="destructive" className="flex flex-wrap gap-2">{reasonInput}</ActionForm></>}
            {c.status === 'category_pending' && <span className="text-sm text-muted-foreground">{locale === 'ar' ? 'بانتظار اعتماد التصنيف من صفحة التصنيفات.' : 'Waiting for category approval in Categories.'}</span>}
            {c.status === 'published' && <><ActionForm action={reviewCourseAction.bind(null, c.id, 'suspend')} submitLabel={t('admin.suspend')} variant="destructive" className="flex flex-wrap gap-2">{reasonInput}</ActionForm><ActionForm action={reviewCourseAction.bind(null, c.id, 'archive')} submitLabel={t('admin.archive')} variant="outline"><span className="sr-only">{c.title}</span></ActionForm></>}
            {['suspended', 'archived', 'rejected'].includes(c.status) && <ActionForm action={reviewCourseAction.bind(null, c.id, 'restore')} submitLabel={t('admin.restore')} variant="outline"><span className="sr-only">{c.title}</span></ActionForm>}
          </div>
        </li>))}</ul> : !error ? <EmptyState title={t('admin.none')} /> : null}
    </div>
  );
}
