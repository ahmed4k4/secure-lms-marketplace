'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Download, Trash2 } from 'lucide-react';
import { VideoPlayer, type PlayerHandle } from '@/components/video-player';
import { LessonQa } from '@/components/lesson-qa';
import { ActionForm } from '@/components/action-form';
import { Badge, Card, CardBody, Textarea } from '@/components/ui/primitives';
import { Button, buttonVariants } from '@/components/ui/button';
import { addNoteAction, deleteNoteAction } from '@/actions/community';
import { toggleCompleteAction } from '@/actions/learning';
import { useT } from '@/lib/i18n/provider';
import { cn, formatBytes, formatDate, formatDuration } from '@/lib/utils';

type Note = { id: string; position_seconds: number; body: string };
type Ann = { id: string; title: string; body: string; created_at: string };
type TabId = 'overview' | 'qa' | 'notes' | 'announcements';

export function LessonPanel(p: {
  courseId: string; slug: string; lesson: { id: string; title: string; description: string | null; type: 'video' | 'text' }; body: string | null; startAt: number; completed: boolean;
  prevHref?: string; nextHref?: string; resources: { id: string; title: string; size_bytes: number }[]; notes: Note[]; viewerId: string; announcements: Ann[];
}) {
  const { t, locale } = useT();
  const router = useRouter();
  const player = useRef<PlayerHandle>(null);
  const [tab, setTab] = useState<TabId>('overview');
  const [qaOpened, setQaOpened] = useState(false);
  const selectTab = (id: TabId) => { setTab(id); if (id === 'qa') setQaOpened(true); };
  const [autoNext, setAutoNext] = useState(true);
  const [pos, setPos] = useState(0);
  const path = `/learn/${p.slug}/${p.lesson.id}`;

  useEffect(() => { try { setAutoNext(localStorage.getItem('archai:autonext') !== '0'); } catch { /* storage unavailable */ } }, []);
  const toggleAuto = (v: boolean) => { setAutoNext(v); try { localStorage.setItem('archai:autonext', v ? '1' : '0'); } catch { /* ignore */ } };

  const tabs: { id: TabId; label: string; count?: number }[] = [
    { id: 'overview', label: t('tabs.overview') },
    { id: 'qa', label: t('tabs.qa') },
    { id: 'notes', label: t('tabs.notes'), count: p.notes.length },
    { id: 'announcements', label: t('tabs.announcements'), count: p.announcements.length },
  ];
  const onTabKey = (e: React.KeyboardEvent, i: number) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const dir = (e.key === 'ArrowRight' ? 1 : -1) * (document.dir === 'rtl' ? -1 : 1);
    const next = tabs[(i + dir + tabs.length) % tabs.length]!;
    setTab(next.id);
    document.getElementById(`tab-${next.id}`)?.focus();
  };

  return (
    <div className="space-y-5">
      {p.lesson.type === 'video' && (
        <VideoPlayer ref={player} key={p.lesson.id} lessonId={p.lesson.id} startAt={p.startAt} onEnded={() => { if (autoNext && p.nextHref) router.push(p.nextHref); }} />
      )}

      <div className="flex flex-wrap items-start justify-between gap-3">
        <h1 className="text-2xl md:text-3xl">{p.lesson.title}</h1>
        <form action={toggleCompleteAction.bind(null, p.lesson.id, p.slug, !p.completed)}>
          <Button variant={p.completed ? 'outline' : 'default'}>{p.completed ? t('learn.mark_incomplete') : t('learn.mark_complete')}</Button>
        </form>
      </div>

      <div role="tablist" aria-label={t('tabs.label')} className="flex gap-1 overflow-x-auto border-b border-border">
        {tabs.map((x, i) => (
          <button key={x.id} id={`tab-${x.id}`} role="tab" aria-selected={tab === x.id} aria-controls={`panel-${x.id}`} tabIndex={tab === x.id ? 0 : -1}
            onClick={() => selectTab(x.id)} onKeyDown={(e) => onTabKey(e, i)}
            className={cn('-mb-px whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-semibold transition-colors', tab === x.id ? 'border-arc text-arc' : 'border-transparent text-muted-foreground hover:text-foreground')}>
            {x.label}{!!x.count && <span dir="ltr" className="num ms-1.5 rounded-full bg-steel px-1.5 py-0.5 text-[11px] text-silver">{x.count}</span>}
          </button>
        ))}
      </div>

      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="min-h-40">
        {tab === 'overview' && (
          <div className="space-y-6">
            {p.lesson.type === 'text' && <Card><CardBody><p className="max-w-prose whitespace-pre-wrap leading-8">{p.body || t('learn.no_content')}</p></CardBody></Card>}
            {p.lesson.description && <p className="max-w-prose whitespace-pre-wrap text-silver/90">{p.lesson.description}</p>}
            {!!p.resources.length && (
              <section aria-labelledby="res"><h2 id="res" className="mb-2 text-lg">{t('learn.resources')}</h2>
                <ul className="divide-y divide-border rounded-lg border border-border bg-card">
                  {p.resources.map((r) => (
                    <li key={r.id}><a href={`/api/resources/${r.id}/download`} className="flex items-center gap-3 px-4 py-3 text-sm hover:bg-steel/60"><Download className="h-4 w-4 text-arc" strokeWidth={1.75} aria-hidden /><span className="font-semibold">{r.title}</span><span dir="ltr" className="num ms-auto text-xs text-muted-foreground">{formatBytes(Number(r.size_bytes))}</span></a></li>
                  ))}
                </ul>
              </section>
            )}
            <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
              {p.lesson.type === 'video' && p.nextHref && (
                <label className="flex cursor-pointer items-center gap-2 text-sm text-silver"><input type="checkbox" checked={autoNext} onChange={(e) => toggleAuto(e.target.checked)} className="h-4 w-4 accent-[rgb(var(--arc))]" />{t('learn.autoplay')}</label>
              )}
              <div className="ms-auto flex gap-2">
                {p.prevHref && <Link href={p.prevHref} className={cn(buttonVariants({ variant: 'outline' }))}>{t('action.previous')}</Link>}
                {p.nextHref && <Link href={p.nextHref} className={cn(buttonVariants({ variant: p.completed ? 'default' : 'outline' }))}>{t('action.next')}</Link>}
              </div>
            </div>
            {p.lesson.type === 'video' && (
              <details className="text-sm text-muted-foreground"><summary className="cursor-pointer font-semibold text-silver">{t('learn.shortcuts')}</summary>
                <p dir="ltr" className="mt-2 font-mono text-xs leading-7">Space / K · play-pause &nbsp; ← → · ±5s &nbsp; J / L · ±10s &nbsp; M · mute &nbsp; F · fullscreen &nbsp; Shift+&lt; / &gt; · speed</p></details>
            )}
          </div>
        )}

        {qaOpened && (
          <div hidden={tab !== 'qa'}>
            <LessonQa courseId={p.courseId} lessonId={p.lesson.id} slug={p.slug} path={path} />
          </div>
        )}

        {tab === 'notes' && (
          <div className="space-y-5">
            <p className="text-sm text-muted-foreground">{t('notes.private')}</p>
            <ActionForm action={addNoteAction.bind(null, p.lesson.id, path)} submitLabel={t('notes.add', { time: formatDuration(pos) || '0:00' })} resetOnSuccess hideSubmit={false}>
              <input type="hidden" name="positionSeconds" value={pos} />
              <Textarea name="body" required maxLength={2000} placeholder={t('notes.ph')} aria-label={t('notes.ph')} onFocus={() => setPos(player.current?.getTime() ?? 0)} />
            </ActionForm>
            {p.notes.length === 0 ? <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">{t('notes.empty')}</p> : (
              <ul className="space-y-2">
                {p.notes.map((n) => (
                  <li key={n.id} className="flex items-start gap-3 rounded-lg border border-border bg-card p-3">
                    <button type="button" dir="ltr" onClick={() => player.current?.seek(n.position_seconds)} disabled={p.lesson.type !== 'video'}
                      className="num rounded-md bg-deep px-2 py-1 text-sm text-arc hover:bg-steel disabled:opacity-60">{formatDuration(n.position_seconds) || '0:00'}</button>
                    <p className="min-w-0 flex-1 whitespace-pre-wrap text-sm">{n.body}</p>
                    <form action={deleteNoteAction.bind(null, n.id, path)}><Button variant="ghost" size="icon" aria-label={t('action.delete')}><Trash2 className="h-4 w-4" strokeWidth={1.75} /></Button></form>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {tab === 'announcements' && (
          p.announcements.length === 0 ? <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">{t('ann.empty')}</p> : (
            <ul className="space-y-3">
              {p.announcements.map((a) => (
                <li key={a.id} className="rounded-lg border border-border bg-card p-4">
                  <div className="flex items-center gap-2"><h3 className="text-base">{a.title}</h3><Badge tone="brand">{t('qa.staff')}</Badge></div>
                  <p className="text-xs text-muted-foreground">{formatDate(a.created_at, locale)}</p>
                  <p className="mt-2 whitespace-pre-wrap text-sm">{a.body}</p>
                </li>
              ))}
            </ul>
          )
        )}
      </div>
    </div>
  );
}
