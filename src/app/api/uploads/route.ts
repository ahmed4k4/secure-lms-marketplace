import { handle, json, readJson, requireApiUser } from '@/lib/api';
import { uploadRequestSchema } from '@/lib/validation';
import { createUploadSession } from '@/lib/media';

/** Creates a pending upload and returns a short-lived signed PUT URL. The browser uploads straight to R2. */
export const POST = handle(async (req) => {
  const ctx = await requireApiUser();
  const input = uploadRequestSchema.parse(await readJson(req));
  return json(await createUploadSession(ctx, input), 201);
});
