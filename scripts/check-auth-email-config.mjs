const raw = process.env.NEXT_PUBLIC_APP_URL?.trim();
if (!raw) {
  console.error("NEXT_PUBLIC_APP_URL is missing. Set it in .env.local to the exact origin used to open the app, e.g. http://localhost:3000.");
  process.exit(2);
}
let app;
try { app = new URL(raw); } catch {
  console.error("NEXT_PUBLIC_APP_URL must be a valid absolute URL.");
  process.exit(2);
}
if (!['http:', 'https:'].includes(app.protocol)) {
  console.error("NEXT_PUBLIC_APP_URL must use http or https."); process.exit(2);
}
const origin = app.origin;
console.log("App origin:", origin);
console.log("Add these to Supabase Dashboard → Authentication → URL Configuration → Redirect URLs:");
console.log(`  ${origin}/ar/auth/callback`);
console.log(`  ${origin}/en/auth/callback`);
console.log(`  ${origin}/ar/reset-password`);
console.log(`  ${origin}/en/reset-password`);
console.log(`  ${origin}/ar/setup-account`);
console.log(`  ${origin}/en/setup-account`);
console.log("Also set Site URL to this origin for local development, and configure a real SMTP provider for production email delivery.");
console.log("This script prints the required settings; it does not connect to or modify the Supabase project.");
