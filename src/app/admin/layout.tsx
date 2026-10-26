import Link from 'next/link';
import { requireAnyAdmin } from '@/lib/auth';
import { getT } from '@/lib/i18n';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAnyAdmin();
  const { t } = await getT();
  const items = [
    ['/admin', 'admin.overview'], ['/admin/instructors', 'admin.instructors'], ['/admin/users', 'admin.users'], ['/admin/courses', 'admin.courses'],
    ['/admin/entitlements', 'admin.entitlements'], ['/admin/categories', 'admin.categories'], ['/admin/reviews', 'admin.reviews'],
    ['/admin/roles', 'admin.roles'], ['/admin/settings', 'admin.settings'], ['/admin/audit', 'admin.audit'],
  ] as const;
  return (
    <div className="space-y-6">
      <nav aria-label={t('nav.admin')} className="flex flex-wrap gap-1 rounded-lg border border-border bg-card p-1">
        {items.map(([href, key]) => <Link key={href} href={href} className="rounded-md px-3 py-1.5 text-sm font-semibold text-silver hover:bg-steel hover:text-foreground">{t(key)}</Link>)}
      </nav>
      {children}
    </div>
  );
}
