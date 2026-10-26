import { notFound } from 'next/navigation';
import { z } from 'zod';
import { requireUser } from '@/lib/auth';
import { getT } from '@/lib/i18n';
import { submitAssignmentAction } from '@/actions/learning';
import { ActionForm, Field } from '@/components/action-form';
import { Alert, Card, CardBody, Textarea } from '@/components/ui/primitives';
import { formatDate } from '@/lib/utils';

export default async function AssignmentPage({ params }: { params: Promise<{ slug: string; assignmentId: string }> }) {
  const { slug, assignmentId } = await params;
  if (!z.string().uuid().safeParse(assignmentId).success) notFound();
  const { supabase, user } = await requireUser(`/learn/${slug}/assignment/${assignmentId}`);
  const { t, locale } = await getT();
  const { data: a } = await supabase.from('assignments').select('id, title, instructions, due_at, max_score').eq('id', assignmentId).maybeSingle();
  if (!a) notFound();
  const { data: sub } = await supabase.from('submissions').select('content, score, feedback, submitted_at').eq('assignment_id', a.id).eq('user_id', user.id).maybeSingle();
  const graded = sub?.score != null;
  return (
    <div className="space-y-4">
      <h1 className="text-3xl">{a.title}</h1>
      {a.due_at && <p className="text-sm text-muted-foreground">{t('assignment.due', { date: formatDate(a.due_at, locale) })}</p>}
      <Card><CardBody><p className="max-w-prose whitespace-pre-wrap">{a.instructions}</p></CardBody></Card>
      {graded && <Alert tone="success"><p className="font-medium">{t('assignment.score', { score: sub!.score!, max: a.max_score })}</p>{sub!.feedback && <p className="mt-1 whitespace-pre-wrap">{sub!.feedback}</p>}</Alert>}
      {!graded && (
        <ActionForm action={submitAssignmentAction.bind(null, a.id, slug)} submitLabel={sub ? t('assignment.resubmit') : t('assignment.submit')}>
          <Field label={t('assignment.your_answer')} htmlFor="content"><Textarea id="content" name="content" required maxLength={20000} defaultValue={sub?.content ?? ''} className="min-h-48" /></Field>
        </ActionForm>
      )}
    </div>
  );
}
