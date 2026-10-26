import { createClient } from "@supabase/supabase-js";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import fs from "node:fs";
import path from "node:path";

const args = new Set(process.argv.slice(2));
const resumeExisting = args.has("--resume-existing");
const confirmCreate = args.has("--confirm-create");

function fail(message) {
  console.error(`Super Admin bootstrap failed: ${message}`);
  process.exit(1);
}

function parseProjectRef(url) {
  try {
    const hostname = new URL(url).hostname;
    return hostname.endsWith(".supabase.co") ? hostname.split(".")[0] : null;
  } catch { return null; }
}
function validateServiceKey(key, expectedRef) {
  // Legacy JWT keys expose a role and project ref in their payload. New sb_secret_* keys
  // are opaque and cannot be inspected locally; Supabase validates them on first request.
  if (!key.startsWith("sb_secret_") && key.split(".").length === 3) {
    try {
      const payload = JSON.parse(Buffer.from(key.split(".")[1], "base64url").toString("utf8"));
      if (payload.role !== "service_role") fail("SUPABASE_SERVICE_ROLE_KEY is not a service_role key. Use the server-only key from the same Supabase project.");
      if (expectedRef && payload.ref && payload.ref !== expectedRef) fail("The Supabase URL and service-role key belong to different projects. Verify the project URL and server-only key.");
    } catch (error) {
      if (error?.name === "ExitError") throw error;
      if (error?.message?.startsWith("Super Admin bootstrap failed:")) throw error;
      fail("SUPABASE_SERVICE_ROLE_KEY is not a valid recognized key format. Re-copy the server-only key from the Supabase project settings.");
    }
  }
}
async function confirmOwnership(email) {
  if (!input.isTTY || !output.isTTY) fail("Resume mode requires an interactive terminal. Run it locally and type the exact account email to confirm you verified ownership.");
  const rl = createInterface({ input, output });
  try {
    const answer = (await rl.question(`\nRESUME MODE will grant super_admin to the existing account: ${email}\nConfirm you own/control this account by typing the exact email: `)).trim().toLowerCase();
    if (answer !== email) fail("Ownership confirmation did not match. No role changes were made.");
  } finally { rl.close(); }
}
function removeBootstrapPasswordFromEnvFile() {
  const envPath = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return;
  const original = fs.readFileSync(envPath, "utf8");
  const sanitized = original.replace(/^\s*BOOTSTRAP_SUPER_ADMIN_PASSWORD\s*=.*$/m, "BOOTSTRAP_SUPER_ADMIN_PASSWORD=");
  if (sanitized !== original) fs.writeFileSync(envPath, sanitized, { mode: 0o600 });
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
const email = process.env.BOOTSTRAP_SUPER_ADMIN_EMAIL?.trim().toLowerCase();
const password = process.env.BOOTSTRAP_SUPER_ADMIN_PASSWORD;
const displayName = process.env.BOOTSTRAP_SUPER_ADMIN_NAME?.trim() || "Platform Super Administrator";

if (!supabaseUrl || !serviceRoleKey) fail("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local. Never use the service-role key in browser-visible variables.");
const expectedRef = parseProjectRef(supabaseUrl);
if (!expectedRef) fail("NEXT_PUBLIC_SUPABASE_URL must be a valid Supabase project URL, for example https://your-project.supabase.co.");
validateServiceKey(serviceRoleKey, expectedRef);
if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail("Set a valid BOOTSTRAP_SUPER_ADMIN_EMAIL in .env.local.");
if (confirmCreate && (!password || password.length < 16)) fail("Set BOOTSTRAP_SUPER_ADMIN_PASSWORD to a strong, unique password of at least 16 characters.");
if (!confirmCreate && !resumeExisting) fail("Use `npm run bootstrap:super-admin` to create a new account, or `npm run bootstrap:super-admin:resume` to finish an interrupted bootstrap.");
if (confirmCreate && resumeExisting) fail("Choose either --confirm-create or --resume-existing, not both.");

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
  global: { headers: { "X-Client-Info": "secure-lms-bootstrap-super-admin" } },
});

async function findExistingUserByEmail(targetEmail) {
  for (let page = 1; page <= 100; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) fail(`Could not query Supabase Auth users (HTTP/auth error). Verify the service-role key and project URL. Provider message: ${error.message}`);
    const match = data.users.find((candidate) => candidate.email?.trim().toLowerCase() === targetEmail);
    if (match) return match;
    if (data.users.length < 1000) return null;
  }
  fail("More than 100,000 Auth users were found without an exact match. Use a reviewed Supabase Dashboard workflow instead.");
}

let user;
if (resumeExisting) {
  user = await findExistingUserByEmail(email);
  if (!user) fail("--resume-existing was specified but no Auth account matches BOOTSTRAP_SUPER_ADMIN_EMAIL.");
  if (!user.email_confirmed_at) fail("The existing account email is not confirmed. Confirm the email through Supabase Auth before resuming privilege assignment.");
  await confirmOwnership(email);
} else {
  const existing = await findExistingUserByEmail(email);
  if (existing) fail(`An Auth account already exists for the configured email. No privileges were changed. Verify account ownership, then run the resume command interactively.`);
  const { data, error } = await supabase.auth.admin.createUser({
    email, password, email_confirm: true, user_metadata: { display_name: displayName },
  });
  if (error) fail(`Supabase could not create the Auth user. Check the auth trigger and migrations. Provider message: ${error.message}`);
  if (!data.user) fail("Supabase did not return the newly created Auth user.");
  user = data.user;
}

// Preserve existing profile fields/status. Create a profile only if the Auth trigger did not.
const { data: existingProfile, error: profileReadError } = await supabase.from("profiles").select("id,status").eq("id", user.id).maybeSingle();
if (profileReadError) fail(`Could not read the profile using the server-side service-role key. Check migration 0004 grants and confirm the key belongs to this project. Provider code: ${profileReadError.code ?? "unknown"}; message: ${profileReadError.message}`);
if (!existingProfile) {
  const { error } = await supabase.from("profiles").insert({ id: user.id, display_name: displayName, status: "active", preferred_locale: "ar" });
  if (error) fail(`Auth user exists, but profile provisioning failed. Apply migration 0004 and retry resume. Provider code: ${error.code ?? "unknown"}; message: ${error.message}`);
} else if (existingProfile.status !== "active") {
  fail(`The existing profile is ${existingProfile.status}. It was not reactivated automatically; an authorized operator must review the account status first.`);
}

// Enforce the platform's single-role rule: the bootstrap account becomes Super Admin only.
const { error: roleError } = await supabase.from("user_roles").upsert({ user_id: user.id, role: "super_admin" }, { onConflict: "user_id", ignoreDuplicates: false });
if (roleError) fail(`Profile is present, but super_admin assignment failed. Apply migration 0004 grants and retry resume. Provider code: ${roleError.code ?? "unknown"}; message: ${roleError.message}`);
const { data: verifiedRole, error: verifyRoleError } = await supabase.from("user_roles").select("role").eq("user_id", user.id).eq("role", "super_admin").maybeSingle();
if (verifyRoleError || !verifiedRole) fail(`Could not verify the final super_admin assignment. ${verifyRoleError?.message ?? "Role row was not found."}`);

const { error: auditError } = await supabase.from("audit_logs").insert({
  actor_id: user.id, action: "platform.bootstrap_super_admin", target_type: "profile", target_id: user.id,
  metadata: { bootstrap_mode: resumeExisting ? "resume_existing" : "create_new" },
});
if (auditError) console.warn(`Warning: role assignment succeeded, but audit insert failed. Provider code: ${auditError.code ?? "unknown"}. Apply migration 0004 and review audit_logs grants.`);

removeBootstrapPasswordFromEnvFile();
console.log("\nSuper Admin account provisioned and verified successfully.");
console.log(`Account: ${email}`);
console.log(`Auth user UUID: ${user.id}`);
console.log("The profile status was preserved; the account now has exactly one role: super_admin.");
console.log("The bootstrap password was cleared from .env.local if it was stored there. Rotate/remove temporary credentials and keep the service-role key private.");
