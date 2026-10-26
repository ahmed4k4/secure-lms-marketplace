// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QuizTaker } from '@/components/quiz-taker';
import { I18nProvider } from '@/lib/i18n/provider';
import { en } from '@/lib/i18n/en';
import { ar } from '@/lib/i18n/ar';

const qs = [
  { id: '3f2a1c9e-8b7d-4e6f-9a10-1234567890a1', prompt: 'Two plus two?', options: [{ id: 'o1', text: '3' }, { id: 'o2', text: '4' }] },
  { id: '3f2a1c9e-8b7d-4e6f-9a10-1234567890a2', prompt: 'Sky colour?', options: [{ id: 'o1', text: 'blue' }, { id: 'o2', text: 'green' }] },
];
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('QuizTaker', () => {
  it('keeps submit disabled until every question is answered, posts answers, and shows server-side grading', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ score_percent: 50, passed: false, results: [{ question_id: qs[0].id, correct: true, explanation: 'four' }, { question_id: qs[1].id, correct: false, explanation: null }] }) });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<I18nProvider locale="en" dict={en}><QuizTaker quizId="q1" questions={qs} /></I18nProvider>);
    const submit = screen.getByRole('button', { name: 'Submit answers' });
    expect(submit).toBeDisabled();
    await user.click(screen.getByLabelText('4'));
    expect(submit).toBeDisabled();
    await user.click(screen.getByLabelText('green'));
    await user.click(submit);
    expect(fetchMock).toHaveBeenCalledWith('/api/quizzes/q1/attempt', expect.objectContaining({ method: 'POST' }));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ answers: { [qs[0].id]: 'o2', [qs[1].id]: 'o2' } });
    expect(await screen.findByText('Score: 50%')).toBeInTheDocument();
    expect(screen.getByText(/four/)).toBeInTheDocument();
  });

  it('renders Arabic copy', () => {
    render(<I18nProvider locale="ar" dict={ar}><QuizTaker quizId="q1" questions={qs} /></I18nProvider>);
    expect(screen.getByRole('button', { name: 'إرسال الإجابات' })).toBeInTheDocument();
  });
});
