import { z } from 'zod';

const trimmed = (min: number, max: number) => z.string().trim().min(min).max(max);
const optionalText = (max: number) =>
  z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? undefined : v), z.string().trim().max(max).optional());
/** One item per line (textarea) -> trimmed, non-empty, capped array. */
const lines = (maxItems: number, maxLen: number) =>
  z.preprocess(
    (v) => (typeof v === 'string' ? v.split(/\r?\n/).map((x) => x.trim()).filter(Boolean) : []),
    z.array(z.string().max(maxLen)).max(maxItems),
  );
const checkbox = z.preprocess((v) => v === 'on' || v === 'true' || v === true, z.boolean());

export const CURRENCIES = ['USD', 'EUR', 'GBP', 'EGP', 'SAR', 'AED'] as const;

export const loginSchema = z.object({ email: z.string().trim().email().max(254), password: z.string().min(1).max(200) });
export const registerSchema = z.object({
  fullName: trimmed(2, 100),
  email: z.string().trim().email().max(254),
  password: z.string().min(10, 'min10').max(72),
});
export const emailSchema = z.object({ email: z.string().trim().email().max(254) });
export const newPasswordSchema = z.object({ password: z.string().min(10).max(72) });

export const profileSchema = z.object({
  fullName: trimmed(2, 100),
  locale: z.enum(['en', 'ar']),
  avatarUrl: z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? undefined : v), z.string().trim().url().regex(/^https:\/\//i).max(2048).optional()),
});
export const instructorProfileSchema = z.object({
  headline: optionalText(160),
  bio: optionalText(4000),
  website: z.preprocess((v) => (v === '' ? undefined : v), z.string().trim().url().regex(/^https?:\/\//i).max(300).optional()),
});

export const courseSchema = z.object({
  title: trimmed(3, 140),
  subtitle: optionalText(200),
  description: z.string().trim().max(20000).default(''),
  categoryId: z.preprocess((v) => (v === '' ? undefined : v), z.string().uuid().optional()),
  newCategoryNameEn: optionalText(120),
  newCategoryNameAr: optionalText(120),
  existingCategoryRequestId: z.preprocess((v) => (v === '' ? undefined : v), z.string().uuid().optional()),
  coverObjectKey: optionalText(240),
  coverUploadRequested: checkbox,
  language: z.enum(['en', 'ar']),
  level: z.enum(['beginner', 'intermediate', 'advanced', 'all']),
  outcomes: lines(12, 200),
  requirements: lines(12, 200),
  audience: lines(12, 200),
}).refine((v) => {
  const hasEn = Boolean(v.newCategoryNameEn);
  const hasAr = Boolean(v.newCategoryNameAr);
  if (v.categoryId && (hasEn || hasAr)) return false;
  return hasEn === hasAr;
}, {
  path: ['newCategoryNameEn'], message: 'choose_existing_or_propose_category',
}).refine((v) => !v.coverUploadRequested || Boolean(v.coverObjectKey), { path: ['coverObjectKey'], message: 'cover_upload_incomplete' });

export const pricingSchema = z
  .object({
    // `accessType` is accepted for compatibility with older clients; new UI uses the explicit plan model.
    planModel: z.enum(['free', 'one_time', 'monthly', 'yearly']).optional(),
    accessType: z.enum(['free', 'paid']).optional(),
    amount: z.preprocess((v) => (v === '' || v == null ? undefined : Number(v)), z.number().min(1).max(100000).optional()),
    currency: z.enum(CURRENCIES).default('USD'),
    accessDays: z.preprocess((v) => (v === '' || v == null ? undefined : Number(v)), z.number().int().min(1).max(3650).optional()),
  })
  .refine((v) => Boolean(v.planModel || v.accessType), { path: ['planModel'], message: 'pricing_model_required' })
  .refine((v) => (v.planModel ?? (v.accessType === 'free' ? 'free' : 'one_time')) === 'free' || v.amount !== undefined, { path: ['amount'], message: 'amount_required' });

export const sectionSchema = z.object({ title: trimmed(1, 140) });
export const lessonCreateSchema = z.object({ title: trimmed(1, 140), type: z.enum(['video', 'text']) });
export const lessonUpdateSchema = z.object({
  title: trimmed(1, 140),
  description: optionalText(2000),
  isFreePreview: checkbox,
  body: z.string().max(100000).optional(),
  availabilityStartsAt: z.string().trim().optional(),
  availabilityEndsAt: z.string().trim().optional(),
  maxWatchMinutes: z.coerce.number().int().min(1).max(1440).optional(),
  watermarkEnabled: checkbox,
  seekAllowed: checkbox,
});

const uuid = z.string().uuid();
export const uploadRequestSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('video'),
    lessonId: uuid,
    contentType: z.string().max(100),
    sizeBytes: z.number().int().positive(),
    durationSeconds: z.number().int().min(1).max(86400).optional(),
  }),
  z.object({
    kind: z.literal('resource'),
    lessonId: uuid,
    filename: z.string().min(1).max(200),
    contentType: z.string().max(150),
    sizeBytes: z.number().int().positive(),
  }),
]);
export const confirmUploadSchema = z.object({
  kind: z.enum(['video', 'resource']),
  id: uuid,
  durationSeconds: z.number().int().min(1).max(86400).optional(),
});

export const playbackSchema = z.object({ sessionId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/) });
export const progressSchema = z.object({
  sessionId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/).optional(),
  positionSeconds: z.number().int().min(0).max(86400),
  completed: z.boolean().optional(),
});
export const quizAttemptSchema = z.object({ answers: z.record(z.string().uuid(), z.string().max(50)) });

export const quizSchema = z.object({ title: trimmed(1, 160), passPercent: z.coerce.number().int().min(1).max(100), durationMinutes: z.coerce.number().int().min(1).max(600).optional(), questionTimeSeconds: z.coerce.number().int().min(5).max(3600).optional(), attemptsLimit: z.coerce.number().int().min(1).max(100).optional(), shuffleQuestions: z.coerce.boolean().optional(), shuffleOptions: z.coerce.boolean().optional(), availableFrom: z.string().trim().optional(), availableUntil: z.string().trim().optional() });
export const questionSchema = z
  .object({
    prompt: trimmed(1, 1000),
    option1: trimmed(1, 300),
    option2: trimmed(1, 300),
    option3: optionalText(300),
    option4: optionalText(300),
    correct: z.coerce.number().int().min(1).max(4),
    explanation: optionalText(1000),
  })
  .refine((v) => (v.correct === 3 ? !!v.option3 : v.correct === 4 ? !!v.option4 : true), { path: ['correct'], message: 'invalid_correct' });
export const assignmentSchema = z.object({ title: trimmed(1, 160), instructions: z.string().trim().max(10000).default(''), maxScore: z.coerce.number().int().min(1).max(1000), dueAt: z.string().trim().optional(), durationMinutes: z.coerce.number().int().min(1).max(10080).optional(), availableFrom: z.string().trim().optional(), availableUntil: z.string().trim().optional(), allowLateSubmission: z.coerce.boolean().optional() });
export const submissionSchema = z.object({ content: trimmed(1, 20000) });
export const gradeSchema = z.object({ score: z.coerce.number().int().min(0).max(1000), feedback: optionalText(5000) });
export const reviewSchema = z.object({ rating: z.coerce.number().int().min(1).max(5), comment: optionalText(3000) });
export const questionPostSchema = z.object({ title: trimmed(3, 140), body: trimmed(1, 4000) });
export const replySchema = z.object({ body: trimmed(1, 4000) });
export const noteSchema = z.object({ body: trimmed(1, 2000), positionSeconds: z.coerce.number().int().min(0).max(86400) });
export const announcementSchema = z.object({ title: trimmed(1, 120), body: trimmed(1, 2000) });

export const createInstructorSchema = z.object({ fullName: trimmed(2, 100), email: z.string().trim().email().max(254) });
export const categorySchema = z.object({
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/).max(60),
  nameEn: trimmed(1, 80),
  nameAr: trimmed(1, 80),
});
export const grantSchema = z.object({
  email: z.string().trim().email(),
  courseId: uuid,
  days: z.preprocess((v) => (v === '' || v == null ? undefined : Number(v)), z.number().int().min(1).max(3650).optional()),
  note: optionalText(300),
});
export const rejectSchema = z.object({ reason: trimmed(3, 1000) });
export const roleChangeSchema = z.object({ userId: uuid, role: z.enum(['student', 'instructor', 'admin']) });
export const settingsSchema = z.object({
  sharing_block: checkbox,
  watermark_enforced: checkbox,
  capture_deterrence_enabled: checkbox,
  hls_max_height: z.coerce.number().int().refine((n) => [360, 480, 720, 1080].includes(n), 'Choose 360, 480, 720 or 1080.'),
  max_concurrent_streams: z.coerce.number().int().min(1).max(10),
  sharing_ip_threshold: z.coerce.number().int().min(2).max(50),
  signed_url_ttl_seconds: z.coerce.number().int().min(60).max(7200),
  max_video_mb: z.coerce.number().int().min(10).max(5000),
  max_video_minutes: z.coerce.number().int().min(1).max(1440),
  max_resource_mb: z.coerce.number().int().min(1).max(500),
  instructor_storage_quota_mb: z.coerce.number().int().min(100).max(1000000),
  commission_percent: z.coerce.number().min(0).max(100),
});

export type ActionState = { ok?: boolean; error?: string; message?: string; data?: Record<string, string> } | undefined;

export function parseForm<T extends z.ZodTypeAny>(schema: T, formData: FormData): { ok: true; data: z.infer<T> } | { ok: false; error: string } {
  const raw: Record<string, unknown> = {};
  formData.forEach((v, k) => {
    if (typeof v === 'string' && !k.startsWith('$ACTION')) raw[k] = v;
  });
  const parsed = schema.safeParse(raw);
  if (parsed.success) return { ok: true, data: parsed.data };
  const issue = parsed.error.issues[0];
  return { ok: false, error: `${issue?.path.join('.') ?? ''}: ${issue?.message ?? 'invalid'}` };
}
