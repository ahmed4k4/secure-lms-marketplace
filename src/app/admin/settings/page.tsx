import { requirePermission } from '@/lib/auth';
import { getT } from '@/lib/i18n';
import { getSettings } from '@/lib/settings';
import { saveSettingsAction } from '@/actions/admin';
import { ActionForm, Field } from '@/components/action-form';
import { Alert, Card, CardBody, Input } from '@/components/ui/primitives';

export default async function AdminSettings() {
  await requirePermission('settings.manage');
  const { t } = await getT();
  const s = await getSettings();
  const num = (key: keyof typeof s, label: Parameters<typeof t>[0], step = '1') => (
    <Field label={t(label)} htmlFor={key}><Input id={key} name={key} type="number" step={step} defaultValue={String(s[key])} required /></Field>
  );
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <h1 className="text-3xl">{t('admin.settings')}</h1>
      <Alert tone="info">{t('admin.settings_note')}</Alert>
      <Card><CardBody>
        <ActionForm action={saveSettingsAction} submitLabel={t('action.save')}>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="sharing_block" defaultChecked={s.sharing_block} />{t('set.sharing_block')}</label>
          <div className="grid gap-4 sm:grid-cols-2">
            {num('max_concurrent_streams', 'set.streams')}{num('sharing_ip_threshold', 'set.ip_threshold')}{num('signed_url_ttl_seconds', 'set.ttl')}
            {num('max_video_mb', 'set.max_video_mb')}{num('max_video_minutes', 'set.max_video_min')}{num('max_resource_mb', 'set.max_resource_mb')}
            {num('instructor_storage_quota_mb', 'set.quota')}{num('commission_percent', 'set.commission', '0.01')}
          </div>
        </ActionForm>
      </CardBody></Card>
    </div>
  );
}
