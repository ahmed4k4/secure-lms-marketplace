'use client';
import { useEffect, useState } from 'react';
import { QaThread, type Disc, type Reply } from '@/components/qa';
import { useT } from '@/lib/i18n/provider';
import { Button } from '@/components/ui/button';

type Scope = 'lesson' | 'all';
type QaData = {
  discussions: Disc[]; replies: Reply[]; names: Record<string, string>; staffIds: string[];
  viewerId: string; canModerate: boolean; lessonTitles: Record<string, string>;
};

/** Fetch the potentially large community panel only after the learner opens Q&A. */
export function LessonQa({ courseId, lessonId, slug, path }: { courseId: string; lessonId: string; slug: string; path: string }) {
  const { t } = useT();
  const [scope, setScope] = useState<Scope>('lesson');
  const [data, setData] = useState<QaData | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setFailed(false);
    fetch(`/api/lessons/${lessonId}/qa?scope=${scope}`, { credentials: 'same-origin', cache: 'no-store', signal: controller.signal })
      .then(async (response) => {
        const body = await response.json().catch(() => null);
        if (!response.ok || !body || !Array.isArray(body.discussions) || !Array.isArray(body.replies)) throw new Error('qa_load_failed');
        return body as QaData;
      })
      .then(setData)
      .catch((error: unknown) => { if (!(error instanceof DOMException && error.name === 'AbortError')) setFailed(true); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [lessonId, scope, retry]);

  if (loading) return <div role="status" aria-busy="true" className="space-y-3 py-3"><span className="sr-only">{t('player.loading')}</span>{[0,1,2].map((x) => <div key={x} className="animate-pulse rounded-lg border border-border bg-card p-4"><div className="h-4 w-1/3 rounded bg-steel"/><div className="mt-3 h-3 w-4/5 rounded bg-steel/70"/></div>)}</div>;
  if (failed || !data) return <div className="rounded-lg border border-border bg-card p-5 text-center"><p className="text-sm text-muted-foreground">{t('err.generic')}</p><Button type="button" variant="outline" className="mt-3" onClick={() => setRetry((v) => v + 1)}>{t('action.retry')}</Button></div>;

  return <QaThread courseId={courseId} slug={slug} path={path} lessonId={lessonId} discussions={data.discussions} replies={data.replies}
    names={data.names} staffIds={data.staffIds} viewerId={data.viewerId} canModerate={data.canModerate} lessonTitles={data.lessonTitles} currentScope={scope} onScopeChange={setScope} />;
}
