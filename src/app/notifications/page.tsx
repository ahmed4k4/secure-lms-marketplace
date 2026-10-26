import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { getT } from '@/lib/i18n';
import { markNotificationsReadAction } from '@/actions/account';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/primitives';
import { formatDate } from '@/lib/utils';

export const metadata = { title: 'Notifications' };
const KNOWN = ['course_approved', 'course_rejected', 'course_suspended', 'course_archived', 'graded', 'access_granted', 'access_revoked', 'new_question', 'new_reply'];

export default async function NotificationsPage() {
  const { supabase } = await requireUser('/notifications');
  const { t, locale } = await getT();
  const { data } = await supabase.from('notifications').select('id, type, title, body, link, read_at, created_at').order('created_at', { ascending: false }).limit(50);
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl">{t('nav.notifications')}</h1>
        {data?.some((n) => !n.read_at) && <form action={markNotificationsReadAction}><Button variant="outline" size="sm">{t('notif.mark_all')}</Button></form>}
      </div>
      {data?.length ? (
        <ul className="space-y-2">
          {data.map((n) => {
            const heading = KNOWN.includes(n.type) ? `${t(`notif.${n.type}` as never)}: ${n.title}` : n.title;
            const inner = (
              <div className={`rounded-lg border border-border p-4 ${n.read_at ? 'bg-card' : 'bg-accent/10'}`}>
                <p className="font-medium">{heading}</p>
                {n.body && n.type !== 'graded' && <p className="mt-1 whitespace-pre-wrap text-sm">{n.body}</p>}
                {n.type === 'graded' && <p className="mt-1 text-sm">{t('notif.score', { score: n.body ?? '' })}</p>}
                <p className="mt-1 text-xs text-muted-foreground">{formatDate(n.created_at, locale)}</p>
              </div>
            );
            return <li key={n.id}>{n.link?.startsWith('/') ? <Link href={n.link}>{inner}</Link> : inner}</li>;
          })}
        </ul>
      ) : <EmptyState title={t('notif.empty')} />}
    </div>
  );
}
