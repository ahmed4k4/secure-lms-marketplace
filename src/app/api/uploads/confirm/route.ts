import { handle, json, readJson, requireApiUser } from '@/lib/api';
import { confirmUploadSchema } from '@/lib/validation';
import { confirmUpload } from '@/lib/media';

/** Verifies the stored object (size, type, magic bytes) before it can be used. */
export const POST = handle(async (req) => {
  const ctx = await requireApiUser();
  const input = confirmUploadSchema.parse(await readJson(req));
  return json(await confirmUpload(ctx, input.kind, input.id, input.durationSeconds));
});
