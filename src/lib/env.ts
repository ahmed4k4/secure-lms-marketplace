import { z } from 'zod';

const serverSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  NEXT_PUBLIC_SITE_URL: z.string().url().default('http://localhost:3000'),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  R2_ACCOUNT_ID: z.string().min(1),
  R2_ACCESS_KEY_ID: z.string().min(1),
  R2_SECRET_ACCESS_KEY: z.string().min(1),
  R2_BUCKET: z.string().min(1),
  R2_COVERS_BUCKET: z.string().min(1).default('lms-public-covers'),
  R2_COVERS_PUBLIC_URL: z.string().url().refine((value) => value.startsWith('https://'), 'Must be an HTTPS public cover URL').optional(),
  PLAYBACK_HMAC_SECRET: z.string().min(32, 'PLAYBACK_HMAC_SECRET must be at least 32 characters'),
  CRON_SECRET: z.string().min(16).optional(),
});

export type ServerEnv = z.infer<typeof serverSchema>;
let cached: ServerEnv | undefined;

/** Validated lazily so `next build` does not need secrets; fails loudly at first real use. */
export function serverEnv(): ServerEnv {
  if (!cached) {
    const parsed = serverSchema.safeParse(process.env);
    if (!parsed.success) {
      const missing = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
      throw new Error(`Invalid server environment: ${missing}`);
    }
    cached = parsed.data;
  }
  return cached;
}

// Literal references so Next can inline them into the client bundle.
export const publicEnv = {
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
  siteUrl: process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000',
};
