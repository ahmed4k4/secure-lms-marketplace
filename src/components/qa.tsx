'use client';
import { useState } from 'react';
import { CheckCircle2, MessageSquare, Trash2 } from 'lucide-react';
import { ActionForm, Field } from '@/components/action-form';
import { ConfirmSubmit } from '@/components/form-bits';
import { Badge, Input, Textarea } from '@/components/ui/primitives';
import { Button } from '@/components/ui/button';
import { deleteDiscussionAction, deleteReplyAction, postQuestionAction, replyAction, resolveDiscussionAction } from '@/actions/community';
import { useT } from '@/lib/i18n/provider';
import { formatDate } from '@/lib/utils';

export type Disc = { id: string; lesson_id: string | null; user_id: string; title: string; body: string; is_resolved: boolean; created_at: string };
export type Reply = { id: string; discussion_id: string; user_id: string; body: string; created_at: string };

export function QaThread({
  courseId, slug, path, lessonId, discussions, replies, names, staffIds, viewerId, canModerate, lessonTitles = {}, allowAsk = true, currentScope, onScopeChange,
}: {
  courseId: string; slug: string; path: string; lessonId?: string; discussions: Disc[]; replies: Reply[]; names: Record<string, string>;
  staffIds: string[]; viewerId: string; canModerate: boolean; lessonTitles?: Record<string, string>; allowAsk?: boolean; currentScope?: 'lesson' | 'all'; onScopeChange?: (scope: 'lesson' | 'all') => void;
}) {
  const { t, locale } = useT();
  const [scope, setScope] = useState<'lesson' | 'all'>(currentScope ?? (lessonId ? 'lesson' : 'all'));
  const [asking, setAsking] = useState(false);
  const shown = discussions.filter((d) => scope === 'all' || d.lesson_id === lessonId);
  const linkFor = (d: Disc | null) => (d?.lesson_id ? `/learn/${slug}/${d.lesson_id}` : lessonId ? `/learn/${slug}/${lessonId}` : `/learn/${slug}`);
  const who = (id: string) => names[id] ?? '—';

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        {lessonId && (
          <div role="group" className="inline-flex rounded-md border border-border p-0.5 text-sm">
            {(['lesson', 'all'] as const).map((s) => (
              <button key={s} type="button" onClick={() => { setScope(s); onScopeChange?.(s); }} aria-pressed={scope === s}
                className={`rounded-[10px] px-3 py-1 font-semibold ${scope === s ? 'bg-steel text-arc' : 'text-muted-foreground hover:text-foreground'}`}>
                {t(s === 'lesson' ? 'qa.this_lesson' : 'qa.all')}
              </button>
            ))}
          </div>
        )}
        {allowAsk && <Button type="button" variant={asking ? 'ghost' : 'outline'} size="sm" className="ms-auto" onClick={() => setAsking((v) => !v)}>{t('qa.ask')}</Button>}
      </div>

      {asking && allowAsk && (
        <div className="rounded-lg border border-border bg-deep p-4">
          <ActionForm action={postQuestionAction.bind(null, courseId, lessonId ?? null, path, linkFor(null))} submitLabel={t('qa.post')} resetOnSuccess>
            <Field label={t('qa.q_title')} htmlFor="q-title"><Input id="q-title" name="title" required minLength={3} maxLength={140} /></Field>
            <Field label={t('qa.q_body')} htmlFor="q-body"><Textarea id="q-body" name="body" required maxLength={4000} /></Field>
          </ActionForm>
        </div>
      )}

      {shown.length === 0 && <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">{t('qa.empty')}</p>}

      <ul className="space-y-4">
        {shown.map((d) => {
          const rs = replies.filter((r) => r.discussion_id === d.id).sort((a, b) => a.created_at.localeCompare(b.created_at));
          const mine = d.user_id === viewerId;
          return (
            <li key={d.id} className="rounded-lg border border-border bg-card p-4">
              <div className="flex flex-wrap items-center gap-2">
                <h4 className="text-base font-semibold">{d.title}</h4>
                {d.is_resolved && <Badge tone="success"><CheckCircle2 className="h-3 w-3" />{t('qa.resolved')}</Badge>}
                {d.lesson_id && lessonTitles[d.lesson_id] && <Badge>{lessonTitles[d.lesson_id]}</Badge>}
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">{who(d.user_id)}{staffIds.includes(d.user_id) && <> · <span className="text-arc">{t('qa.staff')}</span></>} · {formatDate(d.created_at, locale)}</p>
              <p className="mt-2 whitespace-pre-wrap text-[15px]">{d.body}</p>

              {rs.length > 0 && (
                <ul className="mt-4 space-y-3 border-s-2 border-border ps-4">
                  {rs.map((r) => (
                    <li key={r.id}>
                      <p className="text-xs text-muted-foreground"><span className="font-semibold text-silver">{who(r.user_id)}</span>{staffIds.includes(r.user_id) && <Badge tone="brand" className="ms-2">{t('qa.staff')}</Badge>} · {formatDate(r.created_at, locale)}</p>
                      <p className="whitespace-pre-wrap text-sm">{r.body}</p>
                      {(r.user_id === viewerId || canModerate) && (
                        <form action={deleteReplyAction.bind(null, r.id, path)}><ConfirmSubmit size="sm" variant="link" className="h-auto p-0 text-xs text-muted-foreground" message={t('qa.delete_confirm')}>{t('action.delete')}</ConfirmSubmit></form>
                      )}
                    </li>
                  ))}
                </ul>
              )}

              <div className="mt-4 flex flex-wrap items-start gap-3">
                <ActionForm action={replyAction.bind(null, d.id, path, linkFor(d))} submitLabel={t('qa.reply')} variant="outline" resetOnSuccess className="flex min-w-60 flex-1 gap-2">
                  <Input name="body" required maxLength={4000} placeholder={t('qa.reply_ph')} aria-label={t('qa.reply_ph')} />
                </ActionForm>
                {(mine || canModerate) && (
                  <div className="flex gap-1">
                    <form action={resolveDiscussionAction.bind(null, d.id, !d.is_resolved, path)}><Button variant="ghost" size="sm"><MessageSquare className="h-4 w-4" strokeWidth={1.75} />{d.is_resolved ? t('qa.reopen') : t('qa.mark_resolved')}</Button></form>
                    <form action={deleteDiscussionAction.bind(null, d.id, path)}><ConfirmSubmit variant="ghost" size="icon" message={t('qa.delete_confirm')} aria-label={t('action.delete')}><Trash2 className="h-4 w-4" strokeWidth={1.75} /></ConfirmSubmit></form>
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
