import { describe, it, expect } from 'vitest';
import { assignmentSchema, confirmUploadSchema, courseSchema, playbackSchema, pricingSchema, progressSchema, questionSchema, quizAttemptSchema, registerSchema, uploadRequestSchema } from '@/lib/validation';
import { safeNext, slugify } from '@/lib/utils';

const uuid = '3f2a1c9e-8b7d-4e6f-9a10-1234567890ab';

describe('validation', () => {
  it('free, one-time, monthly and yearly pricing are validated safely', () => {
    expect(pricingSchema.safeParse({ accessType: 'paid', currency: 'USD' }).success).toBe(false);
    expect(pricingSchema.safeParse({ accessType: 'paid', amount: '19.5', currency: 'USD' }).success).toBe(true);
    expect(pricingSchema.safeParse({ accessType: 'free', currency: 'USD' }).success).toBe(true);
    expect(pricingSchema.safeParse({ accessType: 'paid', amount: '-5', currency: 'USD' }).success).toBe(false);
    expect(pricingSchema.safeParse({ accessType: 'paid', amount: '5', currency: 'XXX' }).success).toBe(false);
    expect(pricingSchema.safeParse({ planModel: 'monthly', amount: '9', currency: 'USD' }).success).toBe(true);
    expect(pricingSchema.safeParse({ planModel: 'yearly', amount: '90', currency: 'USD' }).success).toBe(true);
    expect(pricingSchema.safeParse({ planModel: 'monthly', currency: 'USD' }).success).toBe(false);
  });
  it('upload requests are strictly typed', () => {
    expect(uploadRequestSchema.safeParse({ kind: 'video', lessonId: uuid, contentType: 'video/mp4', sizeBytes: 1000 }).success).toBe(true);
    expect(uploadRequestSchema.safeParse({ kind: 'video', lessonId: 'not-a-uuid', contentType: 'video/mp4', sizeBytes: 1000 }).success).toBe(false);
    expect(uploadRequestSchema.safeParse({ kind: 'video', lessonId: uuid, contentType: 'video/mp4', sizeBytes: -1 }).success).toBe(false);
    expect(uploadRequestSchema.safeParse({ kind: 'resource', lessonId: uuid, filename: 'a.pdf', contentType: 'application/pdf', sizeBytes: 5 }).success).toBe(true);
    expect(uploadRequestSchema.safeParse({ kind: 'other', lessonId: uuid }).success).toBe(false);
    expect(confirmUploadSchema.safeParse({ kind: 'video', id: uuid }).success).toBe(true);
  });
  it('mass assignment: unknown / privileged keys are stripped', () => {
    const parsed = courseSchema.parse({ title: 'Valid title', language: 'en', level: 'all', status: 'published', created_by: uuid, role: 'admin' });
    expect(parsed).not.toHaveProperty('status');
    expect(parsed).not.toHaveProperty('created_by');
    expect(parsed).not.toHaveProperty('role');
  });
  it('playback / progress inputs', () => {
    expect(playbackSchema.safeParse({ sessionId: 'abcdef123456' }).success).toBe(true);
    expect(playbackSchema.safeParse({ sessionId: 'bad id!' }).success).toBe(false);
    expect(progressSchema.safeParse({ positionSeconds: 12.5 }).success).toBe(false);
    expect(progressSchema.safeParse({ positionSeconds: 12, completed: true }).success).toBe(true);
  });
  it('quiz answers must be uuid->short string maps', () => {
    expect(quizAttemptSchema.safeParse({ answers: { [uuid]: 'o1' } }).success).toBe(true);
    expect(quizAttemptSchema.safeParse({ answers: { notuuid: 'o1' } }).success).toBe(false);
  });
  it('question correct option must exist', () => {
    const base = { prompt: 'Q', option1: 'a', option2: 'b', correct: '1' };
    expect(questionSchema.safeParse(base).success).toBe(true);
    expect(questionSchema.safeParse({ ...base, correct: '3' }).success).toBe(false);
    expect(questionSchema.safeParse({ ...base, option3: 'c', correct: '3' }).success).toBe(true);
  });
  it('passwords and assignment bounds', () => {
    expect(registerSchema.safeParse({ fullName: 'Ali Hassan', email: 'a@b.co', password: 'short' }).success).toBe(false);
    expect(registerSchema.safeParse({ fullName: 'Ali Hassan', email: 'a@b.co', password: 'long-enough-pass' }).success).toBe(true);
    expect(assignmentSchema.safeParse({ title: 'T', maxScore: '0' }).success).toBe(false);
  });
});

describe('utils', () => {
  it('safeNext blocks open redirects', () => {
    expect(safeNext('/courses/x')).toBe('/courses/x');
    for (const bad of ['//evil.com', 'https://evil.com', '/\\evil.com', 'javascript:alert(1)', '', null, undefined]) expect(safeNext(bad as string)).toBe('/dashboard');
  });
  it('slugify always yields a DB-valid slug, even for Arabic titles', () => {
    const re = /^[a-z0-9]+(-[a-z0-9]+)*$/;
    for (const t of ['Intro to Python!', 'دورة البرمجة', '  --  ', 'A'.repeat(200)]) expect(slugify(t)).toMatch(re);
  });
});
