/**
 * Super Admin bootstrap / repair (idempotent). Run from a trusted machine:
 *   npm run bootstrap:admin                               # reads BOOTSTRAP_SUPER_ADMIN_* from .env.local
 *   npm run bootstrap:admin -- you@example.com "Name"     # or pass e-mail and name explicitly
 *   npm run bootstrap:admin -- --reset-password           # also (re)sets the password from BOOTSTRAP_SUPER_ADMIN_PASSWORD
 *
 * - Creates the auth user if missing (password from BOOTSTRAP_SUPER_ADMIN_PASSWORD, otherwise a random one is printed once).
 * - Guarantees a profile row and exactly one super_admin role assignment.
 * - Refuses to promote a second, different user unless --force.
 * Remove BOOTSTRAP_SUPER_ADMIN_PASSWORD from .env.local afterwards.
 */
import { config } from 'dotenv';
import { randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

config({ path: '.env.local' });
config();

async function main() {
  const flags = process.argv.slice(2).filter((a) => a.startsWith('--'));
  const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const force = flags.includes('--force');
  const reset = flags.includes('--reset-password');
  const email = (args[0] ?? process.env.BOOTSTRAP_SUPER_ADMIN_EMAIL ?? '').trim().toLowerCase();
  const fullName = args[1] ?? process.env.BOOTSTRAP_SUPER_ADMIN_NAME ?? 'Super Admin';
  const envPassword = process.env.BOOTSTRAP_SUPER_ADMIN_PASSWORD;
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('Provide an e-mail: npm run bootstrap:admin -- <email> ["Full Name"], or set BOOTSTRAP_SUPER_ADMIN_EMAIL in .env.local');
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env.local');

  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: superRole, error: roleErr } = await db.from('roles').select('id').eq('key', 'super_admin').single();
  if (roleErr || !superRole) throw new Error(`Super Admin role not found (${roleErr?.message ?? 'empty'}). Apply all migrations first, then run: notify pgrst, 'reload schema';`);

  // find existing user (RPC from migration 0005, with a pagination fallback)
  let userId: string | null = null;
  const rpc = await db.rpc('find_user_id_by_email', { p_email: email });
  if (!rpc.error) userId = (rpc.data as string | null) ?? null;
  else {
    for (let page = 1; page <= 20 && !userId; page++) {
      const { data } = await db.auth.admin.listUsers({ page, perPage: 200 });
      userId = data?.users.find((u) => u.email?.toLowerCase() === email)?.id ?? null;
      if (!data?.users.length) break;
    }
  }

  const { data: others } = await db.from('user_roles').select('user_id').eq('role_id', superRole.id);
  if ((others ?? []).some((o) => o.user_id !== userId) && !force) throw new Error('A different super admin already exists. Use --force only if you are sure.');

  let printedPassword: string | null = null;
  if (!userId) {
    const password = envPassword || randomBytes(18).toString('base64url');
    if (!envPassword) printedPassword = password;
    const { data, error } = await db.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: fullName } });
    if (error || !data.user) throw new Error(`Could not create user: ${error?.message}`);
    userId = data.user.id;
  } else if (reset) {
    if (!envPassword) throw new Error('--reset-password needs BOOTSTRAP_SUPER_ADMIN_PASSWORD in .env.local');
    const { error } = await db.auth.admin.updateUserById(userId, { password: envPassword, email_confirm: true, ban_duration: 'none' });
    if (error) throw new Error(`Could not reset password: ${error.message}`);
  }

  // Works even if the user was created before the signup trigger existed.
  await db.from('profiles').upsert({ id: userId, full_name: fullName, status: 'active' }, { onConflict: 'id', ignoreDuplicates: true });
  await db.from('user_roles').delete().eq('user_id', userId);
  const { error: roleInsertError } = await db.from('user_roles').insert({ user_id: userId, role_id: superRole.id });
  if (roleInsertError) throw new Error(`Could not assign Super Admin role: ${roleInsertError.message}`);
  await db.from('audit_logs').insert({ actor_id: null, action: 'bootstrap.super_admin', entity_type: 'user', entity_id: userId, metadata: { email } });

  console.log(`\nSuper admin ready: ${email} (${userId})`);
  if (printedPassword) console.log(`One-time password (store it, then change it): ${printedPassword}`);
  else if (reset) console.log('Password was set from BOOTSTRAP_SUPER_ADMIN_PASSWORD.');
  else console.log('Existing account kept its current password (add --reset-password to set it from .env.local).');
  if (envPassword && envPassword.length < 12) console.log('\nWARNING: that password is short/guessable. Acceptable for local testing only; use a long unique password before real data or deployment.');
  console.log('Remove BOOTSTRAP_SUPER_ADMIN_PASSWORD from .env.local now. MFA is not used by this application. Keep this account protected with a strong unique password.\n');
}

main().catch((e) => { console.error(`\nError: ${e.message}\n`); process.exit(1); });
