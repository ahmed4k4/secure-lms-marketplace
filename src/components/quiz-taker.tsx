'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Alert, Card, CardBody } from '@/components/ui/primitives';
import { useT } from '@/lib/i18n/provider';

type Q = { id: string; prompt: string; options: { id: string; text: string }[] };
type Result = { score_percent: number; passed: boolean; results: { question_id: string; correct: boolean; explanation: string | null }[] };

export function QuizTaker({ quizId, questions }: { quizId: string; questions: Q[] }) {
  const { t } = useT();
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const complete = questions.every((q) => answers[q.id]);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/quizzes/${quizId}/attempt`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ answers }) });
      const body = await res.json();
      if (!res.ok) setError(res.status === 429 ? t('err.rate_limited') : t('err.generic'));
      else setResult(body);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {result && (
        <Alert tone={result.passed ? 'success' : 'warn'}>
          <p className="font-medium">{result.passed ? t('quiz.passed') : t('quiz.failed')}</p>
          <p>{t('quiz.score', { score: result.score_percent })}</p>
        </Alert>
      )}
      {error && <Alert tone="error">{error}</Alert>}
      {questions.map((q, i) => {
        const r = result?.results.find((x) => x.question_id === q.id);
        return (
          <Card key={q.id}>
            <CardBody>
              <fieldset disabled={!!result}>
                <legend className="mb-3 font-medium">{i + 1}. {q.prompt}</legend>
                <div className="space-y-2">
                  {q.options.map((o) => (
                    <label key={o.id} className="flex cursor-pointer items-center gap-2 rounded-md border border-border px-3 py-2 text-sm hover:bg-muted has-[:checked]:border-primary has-[:checked]:bg-primary/5">
                      <input type="radio" name={q.id} value={o.id} checked={answers[q.id] === o.id} onChange={() => setAnswers((a) => ({ ...a, [q.id]: o.id }))} />
                      {o.text}
                    </label>
                  ))}
                </div>
              </fieldset>
              {r && (
                <p className={`mt-3 text-sm ${r.correct ? 'text-success' : 'text-destructive'}`}>
                  {r.correct ? t('quiz.correct') : t('quiz.incorrect')} {r.explanation}
                </p>
              )}
            </CardBody>
          </Card>
        );
      })}
      {!result ? <Button onClick={submit} disabled={!complete || busy}>{busy ? '…' : t('quiz.submit')}</Button> : <Button variant="outline" onClick={() => { setResult(null); setAnswers({}); }}>{t('quiz.retry')}</Button>}
    </div>
  );
}
