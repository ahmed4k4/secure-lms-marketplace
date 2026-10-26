import Link from 'next/link';
import { requirePermission } from '@/lib/auth';
import { getT } from '@/lib/i18n';
import { setInstructorStatusAction } from '@/actions/admin';
import { getAdminDirectory } from '@/lib/admin-directory';
import { CreateInstructorForm } from '@/components/create-instructor-form';
import { Badge, Card, CardBody, CardHeader } from '@/components/ui/primitives';
import { Button, buttonVariants } from '@/components/ui/button';
import { cn, formatDate } from '@/lib/utils';

export default async function AdminInstructors() {
  const { admin } = await requirePermission('instructors.manage');
  const { t, locale } = await getT();
  const directory = await getAdminDirectory(admin);
  const instructorUsers = directory.users.filter((u) => u.roles.includes('instructor'));
  const ids = instructorUsers.map((u) => u.id);
  const { data: courses, error: coursesError } = ids.length
    ? await admin.from('course_instructors').select('instructor_id,course_id').in('instructor_id', ids)
    : { data: [], error: null };
  const countByInstructor = new Map<string, number>();
  for (const row of courses ?? []) countByInstructor.set(row.instructor_id, (countByInstructor.get(row.instructor_id) ?? 0) + 1);
  const error = directory.error || coursesError?.message;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3"><div><h1 className="text-3xl">{t('admin.instructors')}</h1><p className="mt-1 text-sm text-muted-foreground">{locale === 'ar' ? 'إدارة حسابات المدرسين وحالة الموافقة والكورسات المرتبطة بكل مدرس.' : 'Manage instructor accounts, approval status, and owned courses.'}</p></div><div className="rounded-lg border border-border bg-card px-4 py-2"><p className="text-sm text-muted-foreground">{locale === 'ar' ? 'إجمالي المدرسين' : 'Total instructors'}</p><p className="text-2xl font-semibold">{instructorUsers.length}</p></div></div>
      {error && <div role="alert" className="rounded-lg border border-red-500/40 bg-red-500/10 p-4 text-sm">{locale === 'ar' ? `تعذر تحميل كل بيانات المدرسين: ${error}` : `Some instructor data could not be loaded: ${error}`}</div>}
      <Card><CardHeader><h2 className="text-lg">{t('admin.create_instructor')}</h2></CardHeader><CardBody><CreateInstructorForm /></CardBody></Card>
      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full text-sm"><thead className="bg-muted"><tr><th className="p-3 text-start">{t('auth.full_name')}</th><th className="p-3 text-start">{t('auth.email')}</th><th className="p-3 text-start">{locale === 'ar' ? 'الكورسات' : 'Courses'}</th><th className="p-3 text-start">{t('instr.col_status')}</th><th className="p-3 text-start">{locale === 'ar' ? 'تاريخ الانضمام' : 'Joined'}</th><th className="p-3 text-start">{t('admin.actions')}</th></tr></thead>
          <tbody>{instructorUsers.map((u) => {
            const status = u.instructor_status ?? 'pending';
            return <tr key={u.id} className="border-t border-border align-top"><td className="p-3"><div className="font-medium">{u.full_name || (locale === 'ar' ? 'بدون اسم' : 'Unnamed account')}</div><div className="max-w-48 truncate font-mono text-[10px] text-muted-foreground">{u.id}</div></td><td className="p-3" dir="ltr">{u.email || '—'}</td><td className="p-3"><Link className="font-semibold text-primary underline" href={`/admin/courses?instructor=${encodeURIComponent(u.id)}`}>{countByInstructor.get(u.id) ?? 0}</Link></td><td className="p-3"><Badge tone={status === 'active' ? 'success' : status === 'pending' ? 'warn' : 'danger'}>{status}</Badge></td><td className="p-3 whitespace-nowrap">{formatDate(u.created_at, locale)}</td><td className="p-3"><div className="flex flex-wrap gap-2">{status !== 'active' && <form action={setInstructorStatusAction.bind(null, u.id, 'active')}><Button size="sm" variant="outline">{t('admin.activate')}</Button></form>}{status === 'active' && <form action={setInstructorStatusAction.bind(null, u.id, 'suspended')}><Button size="sm" variant="destructive">{t('admin.suspend')}</Button></form>}<Link className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }))} href={`/admin/users?q=${encodeURIComponent(u.email)}`}>{locale === 'ar' ? 'عرض الحساب' : 'View account'}</Link></div></td></tr>;
          })}</tbody></table>
        {instructorUsers.length === 0 && !error && <div className="p-8 text-center text-sm text-muted-foreground">{locale === 'ar' ? 'لا يوجد مدرسون حتى الآن. استخدم نموذج الدعوة بالأعلى لإنشاء أول حساب مدرس.' : 'No instructors yet. Use the invitation form above to create the first instructor account.'}</div>}
      </div>
    </div>
  );
}
