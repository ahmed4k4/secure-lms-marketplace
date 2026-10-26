import Link from 'next/link';
import { requirePermission } from '@/lib/auth';
import { getT } from '@/lib/i18n';
import { getAdminDirectory } from '@/lib/admin-directory';
import { Badge, Card, CardBody } from '@/components/ui/primitives';

export const metadata = { title: 'Admin' };

export default async function AdminHome() {
  const { admin, supabase } = await requirePermission('users.manage');
  const { t, locale } = await getT();
  const count = async (table: string, column?: string, value?: string, nullColumn?: string, since?: { column: string; value: string }) => {
    let q = admin.from(table).select('*', { count: 'exact', head: true });
    if (column && value !== undefined) q = q.eq(column, value);
    if (nullColumn) q = q.is(nullColumn, null);
    if (since) q = q.gte(since.column, since.value);
    const result = await q;
    return { count: result.count ?? 0, error: result.error?.message ?? null };
  };
  const [directory, instructors, review, published, drafts, enrollments, sharing, quizzes, assignments, pendingSubmissions, pendingCategories, recentResult] = await Promise.all([
    getAdminDirectory(admin),
    count('instructor_profiles'), count('courses', 'status', 'in_review'), count('courses', 'status', 'published'), count('courses', 'status', 'draft'),
    count('enrollments'), count('audit_logs', 'action', 'security.suspicious_sharing', undefined, { column: 'created_at', value: new Date(Date.now() - 7 * 86_400_000).toISOString() }), count('quizzes'), count('assignments'), count('submissions', undefined, undefined, 'graded_at'),
    count('category_requests', 'status', 'pending'),
    admin.from('courses').select('id,title,status,updated_at,profiles:created_by(full_name)').order('updated_at', { ascending: false }).limit(8),
  ]);
  const { data: canCreateCourse } = await supabase.rpc('has_permission', { p_perm: 'courses.manage' });
  const dataErrors = [
    directory.error, instructors.error, review.error, published.error, drafts.error, enrollments.error, sharing.error, quizzes.error, assignments.error, pendingSubmissions.error, pendingCategories.error, recentResult.error?.message,
  ].filter(Boolean) as string[];
  const tiles: { label: string; value: number; href: string; note?: string }[] = [
    { label: t('admin.stat_users'), value: directory.users.length, href: '/admin/users' },
    { label: t('admin.stat_instructors'), value: directory.users.filter((u) => u.roles.includes('instructor')).length, href: '/admin/instructors', note: `${instructors.count} ${locale === 'ar' ? 'ملف مدرس' : 'instructor profiles'}` },
    { label: t('admin.stat_review'), value: review.count, href: '/admin/courses?status=in_review' },
    { label: t('admin.stat_published'), value: published.count, href: '/admin/courses?status=published' },
    { label: locale === 'ar' ? 'مسودات الكورسات' : 'Course drafts', value: drafts.count, href: '/admin/courses?status=draft' },
    { label: t('admin.stat_enrollments'), value: enrollments.count, href: '/admin/entitlements' },
    { label: locale === 'ar' ? 'الاختبارات' : 'Quizzes', value: quizzes.count, href: '/admin/courses?status=all' },
    { label: locale === 'ar' ? 'الواجبات' : 'Assignments', value: assignments.count, href: '/admin/courses?status=all' },
    { label: locale === 'ar' ? 'واجبات تحتاج تصحيحًا' : 'Submissions to grade', value: pendingSubmissions.count, href: '/admin/courses?status=all' },
    { label: locale === 'ar' ? 'طلبات تصنيف معلّقة' : 'Pending categories', value: pendingCategories.count, href: '/admin/categories' },
    { label: t('admin.stat_sharing'), value: sharing.count, href: '/admin/audit' },
  ];
  const quick = [
    ...(canCreateCourse ? [{ href: '/admin/courses/new', title: locale === 'ar' ? 'إضافة كورس لمدرس' : 'Create instructor course', description: locale === 'ar' ? 'إنشاء مسودة وتحديد المدرس المالك' : 'Create a draft and assign its instructor' }] : []),
    { href: '/admin/wallets', title: locale === 'ar' ? 'المحافظ والأرصدة' : 'Wallets & balances', description: locale === 'ar' ? 'شحن أرصدة الطلاب والمدرسين ومراجعة الأرصدة' : 'Credit learner and instructor wallets' },
    { href: '/admin/instructors', title: locale === 'ar' ? 'إضافة مدرس' : 'Invite instructor', description: locale === 'ar' ? 'إنشاء حساب مدرس وإرسال دعوة' : 'Create an instructor account and invite them' },
    { href: '/admin/courses?status=in_review', title: locale === 'ar' ? 'مراجعة الكورسات' : 'Review courses', description: locale === 'ar' ? 'اعتماد أو رفض الكورسات المرسلة' : 'Approve or reject submitted courses' },
    { href: '/admin/categories', title: locale === 'ar' ? 'التصنيفات' : 'Categories', description: locale === 'ar' ? 'إدارة التصنيفات وطلبات المدرسين' : 'Manage categories and instructor requests' },
    { href: '/admin/roles', title: locale === 'ar' ? 'الصلاحيات' : 'Permissions', description: locale === 'ar' ? 'تحديد ما يمكن للمسؤولين فعله' : 'Control administrator capabilities' },
    { href: '/admin/audit', title: locale === 'ar' ? 'سجل النشاط' : 'Audit log', description: locale === 'ar' ? 'مراجعة تغييرات الإدارة وأحداث الأمان' : 'Review administrative and security events' },
  ];
  return <div className="space-y-6">
    <div className="flex flex-wrap items-end justify-between gap-3"><div><h1 className="text-3xl">{t('admin.overview')}</h1><p className="mt-1 text-sm text-muted-foreground">{locale === 'ar' ? 'نظرة عامة على الحسابات والكورسات والتقييمات التعليمية وحالة المنصة.' : 'A live overview of accounts, courses, assessments, and platform operations.'}</p></div><Badge tone="brand">{locale === 'ar' ? 'لوحة الإدارة' : 'Administration'}</Badge></div>
    {dataErrors.length > 0 && <div role="alert" className="rounded-lg border border-red-500/40 bg-red-500/10 p-4 text-sm"><p className="font-semibold">{locale === 'ar' ? 'بعض بيانات لوحة الإدارة لم تُحمّل' : 'Some dashboard data failed to load'}</p><p className="mt-1">{locale === 'ar' ? 'لن يتم عرض أخطاء قاعدة البيانات كأرقام صفرية مضللة. راجع migrations وصلاحيات Service Role وسجل الخادم.' : 'Database errors are shown rather than silently presented as zero. Check migrations, service-role configuration, and server logs.'}</p><ul className="mt-2 list-disc ps-5">{dataErrors.slice(0, 5).map((e, i) => <li key={`${i}-${e}`} className="break-words">{e}</li>)}</ul></div>}
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">{tiles.map((tile) => <Link key={tile.label} href={tile.href} className="group"><Card><CardBody><p className="text-sm text-muted-foreground group-hover:text-foreground">{tile.label}</p><p className="mt-2 font-display text-3xl tabular-nums">{tile.value}</p>{tile.note && <p className="mt-1 text-xs text-muted-foreground">{tile.note}</p>}</CardBody></Card></Link>)}</div>
    <section className="space-y-3"><h2 className="text-xl font-semibold">{locale === 'ar' ? 'إجراءات سريعة' : 'Quick actions'}</h2><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{quick.map((item) => <Link key={item.href} href={item.href} className="rounded-xl border border-border bg-card p-4 transition hover:border-arc"><p className="font-semibold">{item.title}</p><p className="mt-1 text-sm text-muted-foreground">{item.description}</p></Link>)}</div></section>
    <section className="space-y-3"><div className="flex items-center justify-between gap-3"><h2 className="text-xl font-semibold">{locale === 'ar' ? 'أحدث الكورسات' : 'Recently updated courses'}</h2><Link href="/admin/courses?status=all" className="text-sm text-primary underline">{locale === 'ar' ? 'عرض الكل' : 'View all'}</Link></div>
      {recentResult.error ? <p className="rounded-lg border border-border p-4 text-sm">{recentResult.error.message}</p> : recentResult.data?.length ? <div className="overflow-x-auto rounded-xl border border-border bg-card"><table className="w-full text-sm"><thead className="bg-muted"><tr><th className="p-3 text-start">{locale === 'ar' ? 'الكورس' : 'Course'}</th><th className="p-3 text-start">{locale === 'ar' ? 'المدرس / المالك' : 'Instructor / owner'}</th><th className="p-3 text-start">{t('instr.col_status')}</th><th className="p-3 text-start">{locale === 'ar' ? 'آخر تحديث' : 'Updated'}</th></tr></thead><tbody>{recentResult.data.map((course: any) => <tr key={course.id} className="border-t border-border"><td className="p-3"><Link className="text-primary underline" href={`/instructor/courses/${course.id}`}>{course.title}</Link></td><td className="p-3">{(Array.isArray(course.profiles) ? course.profiles[0] : course.profiles)?.full_name || '—'}</td><td className="p-3"><Badge>{t(`status.${course.status}` as never)}</Badge></td><td className="p-3 whitespace-nowrap">{new Intl.DateTimeFormat(locale === 'ar' ? 'ar-EG' : 'en', { dateStyle: 'medium' }).format(new Date(course.updated_at))}</td></tr>)}</tbody></table></div> : <p className="rounded-lg border border-border p-4 text-sm text-muted-foreground">{t('admin.none')}</p>}
    </section>
  </div>;
}
