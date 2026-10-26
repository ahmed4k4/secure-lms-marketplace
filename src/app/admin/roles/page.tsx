import { requirePermission } from '@/lib/auth';
import { getT } from '@/lib/i18n';
import { savePermissionsAction } from '@/actions/admin';
import { ActionForm } from '@/components/action-form';
import { Alert, Badge, Card, CardBody } from '@/components/ui/primitives';

export default async function AdminRoles() {
  const { admin } = await requirePermission('admins.manage');
  const { t } = await getT();
  const [{ data: perms }, { data: role }] = await Promise.all([
    admin.from('permissions').select('key, description').order('key'),
    admin.from('roles').select('id').eq('key', 'admin').single(),
  ]);
  const { data: granted } = await admin.from('role_permissions').select('permission_key').eq('role_id', role?.id ?? '');
  const on = new Set((granted ?? []).map((g) => g.permission_key));
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="text-3xl">{t('admin.roles_title')}</h1>
      <Alert tone="info">{t('admin.roles_note')}</Alert>
      <Card><CardBody>
        <ActionForm action={savePermissionsAction} submitLabel={t('action.save')}>
          <ul className="divide-y divide-border">
            {(perms ?? []).map((p) => (
              <li key={p.key} className="py-3">
                {p.key === 'admins.manage' ? (
                  <div className="flex items-start gap-3 opacity-70"><input type="checkbox" disabled className="mt-1 h-4 w-4" /><div><p dir="ltr" className="font-mono text-sm">{p.key}</p><p className="text-sm text-muted-foreground">{p.description}</p></div><Badge className="ms-auto">super admin</Badge></div>
                ) : (
                  <label className="flex cursor-pointer items-start gap-3"><input type="checkbox" name="perm" value={p.key} defaultChecked={on.has(p.key)} className="mt-1 h-4 w-4 accent-[rgb(var(--arc))]" /><div><p dir="ltr" className="font-mono text-sm">{p.key}</p><p className="text-sm text-muted-foreground">{p.description}</p></div></label>
                )}
              </li>
            ))}
          </ul>
        </ActionForm>
      </CardBody></Card>
    </div>
  );
}
