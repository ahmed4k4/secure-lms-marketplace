import { z } from 'zod';
import { ApiError, handle, requireApiUser } from '@/lib/api';
import { serveHlsAsset } from '@/lib/hls-stream';

type Context = { params: Promise<{ lessonId: string; assetPath: string[] }> };
export const GET = handle<Context>(async (req, { params }) => {
  const { lessonId, assetPath } = await params;
  if (!z.string().uuid().safeParse(lessonId).success) throw new ApiError(404, 'NOT_FOUND', 'Media asset not found.');
  const sessionId = req.nextUrl.searchParams.get('sessionId') ?? '';
  const ctx = await requireApiUser();
  return serveHlsAsset(ctx, lessonId, assetPath, sessionId);
}, { csrf: false });
