import { notFound } from 'next/navigation';
import { z } from 'zod';
import { requireUser } from '@/lib/auth';
import { getT } from '@/lib/i18n';
import { QuizTaker } from '@/components/quiz-taker';
import { Alert } from '@/components/ui/primitives';

export default async function QuizPage({ params }: { params: Promise<{ slug: string; quizId: string }> }) {
  const { slug, quizId } = await params;
  if (!z.string().uuid().safeParse(quizId).success) notFound();
  const { supabase, user } = await requireUser(`/learn/${slug}/quiz/${quizId}`);
  const { t } = await getT();
  const { data: quiz } = await supabase.from('quizzes').select('id, title, pass_percent').eq('id', quizId).maybeSingle();
  if (!quiz) notFound();
  // Answer keys live in question_keys, which students cannot select.
  const { data: questions } = await supabase.from('questions').select('id, prompt, options, position').eq('quiz_id', quizId).order('position');
  const { data: attempts } = await supabase.from('quiz_attempts').select('score_percent, passed').eq('quiz_id', quizId).eq('user_id', user.id).order('created_at', { ascending: false }).limit(1);
  return (
    <div className="space-y-4">
      <h1 className="text-3xl">{quiz.title}</h1>
      <p className="text-sm text-muted-foreground">{t('quiz.pass_mark', { n: quiz.pass_percent })}</p>
      {attempts?.[0] && <Alert>{t('quiz.last_attempt', { score: attempts[0].score_percent })}</Alert>}
      {questions?.length ? <QuizTaker quizId={quiz.id} questions={questions as any} /> : <Alert>{t('quiz.empty')}</Alert>}
      <p className="sr-only">{slug}</p>
    </div>
  );
}
