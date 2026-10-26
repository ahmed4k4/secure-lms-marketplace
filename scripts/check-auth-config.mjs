const origin = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
let parsed;
try { parsed = new URL(origin); } catch { console.error('NEXT_PUBLIC_SITE_URL must be an absolute URL.'); process.exit(1); }
if (!['http:', 'https:'].includes(parsed.protocol)) { console.error('NEXT_PUBLIC_SITE_URL must use HTTP or HTTPS.'); process.exit(1); }
if (parsed.pathname !== '/' || parsed.search || parsed.hash) { console.error('Set NEXT_PUBLIC_SITE_URL to the origin only (scheme + host + optional port), without a path/query/hash.'); process.exit(1); }
const cleanOrigin = parsed.origin;
console.log('\nSupabase Auth configuration checklist');
console.log('App origin:', cleanOrigin);
console.log('\nAdd these to Supabase → Authentication → URL Configuration → Redirect URLs:');
for (const path of ['/auth/callback', '/reset-password', '/dashboard']) console.log(`  ${new URL(path, cleanOrigin).toString()}`);
console.log('\nOAuth provider callback URI (configure this URI at Google/GitHub, not the app callback):');
const projectUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
if (projectUrl) {
  try { const u = new URL(projectUrl); console.log(`  ${u.origin}/auth/v1/callback`); }
  catch { console.log('  Check NEXT_PUBLIC_SUPABASE_URL; it is not a valid URL.'); process.exitCode = 1; }
} else console.log('  https://YOUR_PROJECT_REF.supabase.co/auth/v1/callback (replace with your project ref)');
console.log('\nProvider toggles, client secrets and SMTP delivery must be configured in Supabase Dashboard; this script only prints URLs and does not modify your project.');
