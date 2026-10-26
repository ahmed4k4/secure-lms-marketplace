import { NextResponse } from 'next/server';
import { z } from 'zod';
import { ApiError, handle, requireApiUser } from '@/lib/api';
import { createAdminClient } from '@/lib/supabase/admin';
import { presignGet } from '@/lib/r2';
import { enforceRateLimit } from '@/lib/rate-limit';

type Ctx = { params: Promise<{ resourceId: string }> };

/** Authorizes, then redirects to a 60-second signed URL. The bucket itself is private. */
export const GET = handle<Ctx>(async (_req, { params }) => {
  const { resourceId } = await params;
  if (!z.string().uuid().safeParse(resourceId).success) throw new ApiError(404, 'NOT_FOUND', 'Not found.');
  const { supabase, user } = await requireApiUser();
  await enforceRateLimit(`download:${user.id}`, 60, 30);

  // RLS only returns the row if this user may see it; can_access_lesson is checked again explicitly.
  const { data: res } = await supabase.from('lesson_resources').select('id, lesson_id, title').eq('id', resourceId).maybeSingle();
  if (!res) throw new ApiError(404, 'NOT_FOUND', 'Not found.');
  const { data: ok } = await supabase.rpc('can_access_lesson', { p_lesson_id: res.lesson_id });
  if (!ok) throw new ApiError(403, 'NO_ACCESS', 'You do not have access to this file.');

  const { data: row } = await createAdminClient().from('lesson_resources').select('object_key, status').eq('id', resourceId).single();
  if (!row || row.status !== 'ready') throw new ApiError(404, 'NOT_FOUND', 'Not found.');
  const url = await presignGet({ key: row.object_key, expiresIn: 60, disposition: 'attachment', filename: res.title });
  return NextResponse.redirect(url, { status: 302, headers: { 'Cache-Control': 'no-store' } });
});
