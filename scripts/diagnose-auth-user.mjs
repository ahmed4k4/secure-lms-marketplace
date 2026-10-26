import { createClient } from "@supabase/supabase-js";

const email = (process.argv[2] ?? "").trim().toLowerCase();
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  console.error("Usage: npm run auth:diagnose -- instructor@example.com");
  process.exit(2);
}
if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local. Never expose the service-role key in browser code.");
  process.exit(2);
}

const db = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
let matched = null;
for (let page = 1; page <= 100; page += 1) {
  const { data, error } = await db.auth.admin.listUsers({ page, perPage: 100 });
  if (error) {
    console.error("Could not query Supabase Auth user directory:", error.code ?? error.message);
    process.exit(1);
  }
  matched = data.users.find((user) => (user.email ?? "").toLowerCase() === email) ?? null;
  if (matched || data.users.length < 100) break;
}

if (!matched) {
  console.log(JSON.stringify({
    diagnosis: "auth_user_not_found_in_this_supabase_project",
    email,
    nextSteps: [
      "Verify NEXT_PUBLIC_SUPABASE_URL points to the project where this instructor was invited.",
      "Create/invite the instructor through the LMS admin dashboard; a public.profiles row by itself cannot authenticate.",
      "Do not insert a fake Auth identity manually into public.profiles."
    ]
  }, null, 2));
  process.exit(3);
}

const [profileResult, rolesResult, instructorResult] = await Promise.all([
  db.from("profiles").select("id,status,display_name").eq("id", matched.id).maybeSingle(),
  db.from("user_roles").select("role").eq("user_id", matched.id),
  db.from("instructor_profiles").select("is_approved").eq("user_id", matched.id).maybeSingle()
]);
if (profileResult.error || rolesResult.error || instructorResult.error) {
  console.error("Auth user was found but database checks failed. Apply the migrations and inspect the named tables.", JSON.stringify({
    profiles: profileResult.error?.code,
    user_roles: rolesResult.error?.code,
    instructor_profiles: instructorResult.error?.code
  }));
  process.exit(1);
}
const roles = (rolesResult.data ?? []).map((row) => row.role);
const result = {
  diagnosis: "auth_user_found",
  email: matched.email,
  userId: matched.id,
  emailConfirmed: Boolean(matched.email_confirmed_at),
  invitedAt: matched.invited_at ?? null,
  lastSignInAt: matched.last_sign_in_at ?? null,
  profile: profileResult.data ? { status: profileResult.data.status, displayName: profileResult.data.display_name } : null,
  roles,
  instructorApproved: instructorResult.data?.is_approved ?? null,
  nextSteps: []
};
if (!matched.email_confirmed_at) result.nextSteps.push("Finish the newest invitation/confirmation link. If it expired, ask an administrator to resend the invite or use the configured recovery flow.");
if (!profileResult.data) result.nextSteps.push("The Auth identity has no public.profiles row. Apply migrations and repair provisioning before granting access.");
if (!roles.includes("instructor")) result.nextSteps.push("The Auth identity has no instructor role. Assign it through the Super Admin dashboard, never from the browser.");
if (matched.email_confirmed_at && profileResult.data && roles.includes("instructor")) result.nextSteps.push("The Auth identity and instructor role exist. Use Forgot password to set a fresh password; if the reset link cannot arrive/work, check SMTP and Redirect URLs in Supabase Auth.");
console.log(JSON.stringify(result, null, 2));
