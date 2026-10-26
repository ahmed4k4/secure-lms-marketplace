import { createClient } from "@supabase/supabase-js";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import fs from "node:fs";
import path from "node:path";

function fail(message) {
  console.error(`Super Admin password reset failed: ${message}`);
  process.exit(1);
}

function parseProjectRef(url) {
  try {
    const hostname = new URL(url).hostname;
    return hostname.endsWith(".supabase.co") ? hostname.split(".")[0] : null;
  } catch { return null; }
}

function validateServiceKey(key, expectedRef) {
  // Legacy JWT service-role keys expose their role/ref; opaque sb_secret_* keys
  // are validated by Supabase on the first request.
  if (key.startsWith("sb_secret_") || key.split(".").length !== 3) return;
  try {
    const payload = JSON.parse(Buffer.from(key.split(".")[1], "base64url").toString("utf8"));
    if (payload.role !== "service_role") fail("SUPABASE_SERVICE_ROLE_KEY is not a service_role key. Use the server-only key from this same Supabase project.");
    if (expectedRef && payload.ref && payload.ref !== expectedRef) fail("The Supabase URL and service-role key belong to different projects.");
  } catch (error) {
    if (error?.message?.startsWith("Super Admin password reset failed:")) throw error;
    fail("SUPABASE_SERVICE_ROLE_KEY has an unrecognized JWT format. Re-copy the server-only key from this project.");
  }
}

async function confirmOwnership(email) {
  if (!input.isTTY || !output.isTTY) fail("Run this command in an interactive local terminal; it requires typing the exact email to confirm ownership.");
  const rl = createInterface({ input, output });
  try {
    const answer = (await rl.question(`\nPASSWORD RESET for existing Super Admin: ${email}\nType the exact email to confirm you own/control this account: `)).trim().toLowerCase();
    if (answer !== email) fail("Email confirmation did not match. Password was not changed.");
  } finally { rl.close(); }
}

function clearTemporaryPassword() {
  const envPath = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return;
  const original = fs.readFileSync(envPath, "utf8");
  const cleaned = original.replace(/^\s*BOOTSTRAP_SUPER_ADMIN_PASSWORD\s*=.*$/m, "BOOTSTRAP_SUPER_ADMIN_PASSWORD=");
  if (cleaned !== original) fs.writeFileSync(envPath, cleaned, { mode: 0o600 });
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
const email = process.env.BOOTSTRAP_SUPER_ADMIN_EMAIL?.trim().toLowerCase();
const password = process.env.BOOTSTRAP_SUPER_ADMIN_PASSWORD;
if (!supabaseUrl || !serviceRoleKey) fail("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local.");
const expectedRef = parseProjectRef(supabaseUrl);
if (!expectedRef) fail("NEXT_PUBLIC_SUPABASE_URL must be the URL of your Supabase project.");
validateServiceKey(serviceRoleKey, expectedRef);
if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail("Set a valid BOOTSTRAP_SUPER_ADMIN_EMAIL in .env.local.");
if (!password || password.length < 16) fail("Set a new, unique BOOTSTRAP_SUPER_ADMIN_PASSWORD with at least 16 characters in .env.local. It will be cleared after success.");

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
  global: { headers: { "X-Client-Info": "secure-lms-admin-password-reset" } },
});

let user = null;
for (let page = 1; page <= 100; page += 1) {
  const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
  if (error) fail(`Could not query Supabase Auth users (provider code: ${error.code ?? "unknown"}). Verify the server-only key and project URL.`);
  user = data.users.find((candidate) => candidate.email?.trim().toLowerCase() === email) ?? null;
  if (user || data.users.length < 1000) break;
}
if (!user) fail("No Auth account matches BOOTSTRAP_SUPER_ADMIN_EMAIL. Password was not changed.");
if (!user.email_confirmed_at) fail("The account email is not confirmed in Supabase Auth. Confirm account ownership/email before resetting its password.");

const { data: profile, error: profileError } = await supabase.from("profiles").select("id,status").eq("id", user.id).maybeSingle();
if (profileError) fail(`Could not verify the profile (provider code: ${profileError.code ?? "unknown"}). Password was not changed.`);
if (!profile || profile.status !== "active") fail(`The account profile is ${profile?.status ?? "missing"}; this script will not reactivate or create profiles. Password was not changed.`);
const { data: role, error: roleError } = await supabase.from("user_roles").select("role").eq("user_id", user.id).eq("role", "super_admin").maybeSingle();
if (roleError || !role) fail("The existing account's super_admin role could not be verified. Run the reviewed bootstrap-resume workflow first; password was not changed.");

await confirmOwnership(email);
const { error: updateError } = await supabase.auth.admin.updateUserById(user.id, { password });
if (updateError) fail(`Supabase rejected the password update (provider code: ${updateError.code ?? "unknown"}). Password was not changed; check Auth password policy.`);
clearTemporaryPassword();
console.log("\nSuper Admin password updated successfully.");
console.log(`Account: ${email}`);
console.log("The profile status and role assignments were not changed.");
console.log("The temporary password value was cleared from .env.local. Sign in using the new password you supplied.");
