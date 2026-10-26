/**
 * Maps a watermark seen on leaked footage (e.g. "ID-A1B2C3D4E5") back to an account.
 *   npm run watermark:resolve -- ID-A1B2C3D4E5
 * The watermark is an HMAC of the user id, so it is pseudonymous to everyone without the server secret.
 */
import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { watermarkId } from '../src/lib/security';

config({ path: '.env.local' });
config();

async function main() {
  const code = (process.argv[2] ?? '').replace(/^ID-/i, '').toUpperCase();
  const secret = process.env.PLAYBACK_HMAC_SECRET;
  if (!/^[0-9A-F]{10}$/.test(code) || !secret) throw new Error('Usage: npm run watermark:resolve -- ID-XXXXXXXXXX (needs PLAYBACK_HMAC_SECRET)');
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from('profiles').select('id, full_name').range(from, from + 999);
    if (error) throw error;
    for (const p of data ?? []) if (watermarkId(p.id, secret) === code) return console.log(`Match: ${p.id} (${p.full_name})`);
    if (!data || data.length < 1000) break;
  }
  console.log('No matching account.');
}
main().catch((e) => { console.error(e.message); process.exit(1); });
