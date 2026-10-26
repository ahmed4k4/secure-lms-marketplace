import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { uploadCoverObject } from '@/lib/r2';

export const runtime = 'nodejs';
const MAX_BYTES = 5 * 1024 * 1024;
export async function POST(request: Request) {
  const { user } = await requireUser('/account');
  const form = await request.formData();
  const file = form.get('avatar');
  if (!(file instanceof File) || file.size < 1 || file.size > MAX_BYTES) return NextResponse.json({ error: 'الصورة يجب أن تكون أقل من 5 ميجابايت.' }, { status: 400 });
  const allowed = new Map([['image/jpeg','jpg'],['image/png','png'],['image/webp','webp']]);
  const ext = allowed.get(file.type);
  if (!ext) return NextResponse.json({ error: 'الامتدادات المسموحة: JPG وPNG وWebP.' }, { status: 415 });
  const bytes = new Uint8Array(await file.arrayBuffer());
  const valid = ext === 'jpg' ? bytes[0] === 0xff && bytes[1] === 0xd8
    : ext === 'png' ? bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
    : bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && String.fromCharCode(...bytes.slice(8,12)) === 'WEBP';
  if (!valid) return NextResponse.json({ error: 'محتوى الصورة لا يطابق نوع الملف.' }, { status: 415 });
  const key = `avatars/${user.id}/${crypto.randomUUID()}.${ext}`;
  const uploaded = await uploadCoverObject({ key, bytes, contentType: file.type });
  const admin = createAdminClient();
  const { error } = await admin.from('profiles').update({ avatar_url: uploaded.publicUrl }).eq('id', user.id);
  if (error) return NextResponse.json({ error: 'تم رفع الصورة لكن تعذر تحديث الملف الشخصي.' }, { status: 500 });
  return NextResponse.redirect(new URL('/account?avatar=updated', request.url), 303);
}
