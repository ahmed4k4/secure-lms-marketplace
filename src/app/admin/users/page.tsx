import Link from 'next/link';
import { requirePermission } from '@/lib/auth';
import { getT } from '@/lib/i18n';
import { changeRoleAction, setAccountStatusAction } from '@/actions/admin';
import { getAdminDirectory } from '@/lib/admin-directory';
import { Badge, Input, Select } from '@/components/ui/primitives';
import { Button } from '@/components/ui/button';

const PAGE = 25;

export default async function AdminUsers({ searchParams }: { searchParams: Promise<{ q?: string; page?: string; role?: string; status?: string }> }) {
  const { admin, roles: actorRoles, user: actor } = await requirePermission('users.manage');
  const { t, locale } = await getT();
  const sp = await searchParams;
  const page = Math.max(1, Number.parseInt(sp.page ?? '1', 10) || 1);
  const q = (sp.q ?? '').trim().slice(0, 100);
  const roleFilter = ['student', 'instructor', 'admin', 'super_admin'].includes(sp.role ?? '') ? sp.role : '';
  const statusFilter = ['active', 'suspended'].includes(sp.status ?? '') ? sp.status : '';
  const directory = await getAdminDirectory(admin);
  const filtered = directory.users.filter((u) => {
    const matchesQuery = !q || `${u.full_name} ${u.email} ${u.id}`.toLowerCase().includes(q.toLowerCase());
    const matchesRole = !roleFilter || u.roles.includes(roleFilter);
    const matchesStatus = !statusFilter || u.status === statusFilter;
    return matchesQuery && matchesRole && matchesStatus;
  }).sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at));
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE));
  const safePage = Math.min(page, pages);
  const users = filtered.slice((safePage - 1) * PAGE, safePage * PAGE);
  const canManageRoles = actorRoles.includes('super_admin');

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h1 className="text-3xl">{t('admin.users')}</h1><p className="mt-1 text-sm text-muted-foreground">{locale === 'ar' ? 'دليل الحسابات من Supabase Auth، مع إصلاح ملفات الحسابات القديمة الناقصة بأقل صلاحيات.' : 'Account directory sourced from Supabase Auth, including safe repair of older accounts missing profile rows.'}</p></div>
        <div className="rounded-lg border border-border bg-card px-4 py-2"><span className="text-sm text-muted-foreground">{locale === 'ar' ? 'إجمالي النتائج' : 'Matching accounts'}</span><p className="text-2xl font-semibold tabular-nums">{filtered.length}</p></div>
      </div>
      {directory.error && <div role="alert" className="rounded-lg border border-red-500/40 bg-red-500/10 p-4 text-sm">{locale === 'ar' ? `تعذر تحميل دليل المستخدمين: ${directory.error}. راجع صلاحيات Service Role وسجل الخادم.` : `Could not load the account directory: ${directory.error}. Check the server service-role configuration and logs.`}</div>}
      <form className="grid gap-2 rounded-xl border border-border bg-card p-3 sm:grid-cols-[minmax(200px,1fr)_180px_160px_auto]" role="search">
        <Input name="q" defaultValue={q} placeholder={locale === 'ar' ? 'ابحث بالاسم أو البريد أو المعرّف' : 'Search name, email, or ID'} aria-label={t('admin.search_users')} />
        <Select name="role" defaultValue={roleFilter} aria-label={t('admin.roles')}><option value="">{locale === 'ar' ? 'كل الأدوار' : 'All roles'}</option><option value="student">student</option><option value="instructor">instructor</option><option value="admin">admin</option><option value="super_admin">super_admin</option></Select>
        <Select name="status" defaultValue={statusFilter} aria-label={t('instr.col_status')}><option value="">{locale === 'ar' ? 'كل الحالات' : 'All statuses'}</option><option value="active">{t('astatus.active')}</option><option value="suspended">{t('astatus.suspended')}</option></Select>
        <Button variant="outline">{t('catalog.apply')}</Button>
      </form>
      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full text-sm"><thead className="bg-muted"><tr><th className="p-3 text-start">{t('auth.full_name')}</th><th className="p-3 text-start">{t('auth.email')}</th><th className="p-3 text-start">{t('admin.roles')}</th><th className="p-3 text-start">{t('instr.col_status')}</th><th className="p-3 text-start">{locale === 'ar' ? 'تاريخ الإنشاء' : 'Created'}</th><th className="p-3 text-start">{t('admin.actions')}</th></tr></thead>
          <tbody>{users.map((u) => {
            const protectedUser = u.roles.includes('super_admin');
            const currentRole = u.roles[0] ?? 'student';
            return <tr key={u.id} className="border-t border-border align-top">
              <td className="p-3"><div className="font-medium">{u.full_name || (locale === 'ar' ? 'بدون اسم' : 'Unnamed account')}</div><div className="mt-1 max-w-48 truncate font-mono text-[10px] text-muted-foreground" title={u.id}>{u.id}</div></td>
              <td className="p-3" dir="ltr">{u.email || '—'}</td>
              <td className="p-3"><div className="flex flex-wrap gap-1">{u.roles.map((k) => <Badge key={k} tone={k === 'student' ? 'neutral' : 'brand'}>{k}</Badge>)}</div>{u.instructor_status && <p className="mt-1 text-xs text-muted-foreground">{locale === 'ar' ? 'حالة المدرس:' : 'Instructor:'} {u.instructor_status}</p>}</td>
              <td className="p-3"><Badge tone={u.status === 'active' ? 'success' : 'danger'}>{t(`astatus.${u.status}` as never)}</Badge></td>
              <td className="p-3 whitespace-nowrap">{new Intl.DateTimeFormat(locale === 'ar' ? 'ar-EG' : 'en', { dateStyle: 'medium' }).format(new Date(u.created_at))}</td>
              <td className="space-y-2 p-3">
                {!protectedUser && u.id !== actor.id && (u.status === 'active'
                  ? <form action={setAccountStatusAction.bind(null, u.id, true)} className="flex gap-1"><Input name="reason" placeholder={t('admin.reason')} aria-label={t('admin.reason')} className="h-8 w-32" maxLength={300} /><Button size="sm" variant="destructive">{t('admin.suspend')}</Button></form>
                  : <form action={setAccountStatusAction.bind(null, u.id, false)}><Button size="sm" variant="outline">{t('admin.activate')}</Button></form>)}
                {canManageRoles && !protectedUser && <form action={changeRoleAction} className="flex gap-1"><input type="hidden" name="userId" value={u.id} /><Select name="role" defaultValue={currentRole} className="h-8 w-32" aria-label={t('admin.roles')}><option value="student">student</option><option value="instructor">instructor</option><option value="admin">admin</option></Select><Button size="sm" variant="outline">{t('action.save')}</Button></form>}
              </td>
            </tr>;
          })}</tbody></table>
        {users.length === 0 && <div className="p-8 text-center text-sm text-muted-foreground">{directory.error ? (locale === 'ar' ? 'لا يمكن عرض البيانات حتى يتم حل الخطأ أعلاه.' : 'The data cannot be displayed until the error above is resolved.') : t('admin.none')}</div>}
      </div>
      {pages > 1 && <div className="flex items-center gap-4 text-sm">{safePage > 1 && <Link className="text-primary underline" href={`/admin/users?q=${encodeURIComponent(q)}&role=${roleFilter}&status=${statusFilter}&page=${safePage - 1}`}>{t('action.previous')}</Link>}<span>{safePage}/{pages}</span>{safePage < pages && <Link className="text-primary underline" href={`/admin/users?q=${encodeURIComponent(q)}&role=${roleFilter}&status=${statusFilter}&page=${safePage + 1}`}>{t('action.next')}</Link>}</div>}
    </div>
  );
}
