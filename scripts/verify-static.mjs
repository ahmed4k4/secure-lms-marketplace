import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const root = process.cwd();
const requiredFiles = [
  "package.json", ".env.example", "README.md", "docs/PROJECT_SPECIFICATION.md", "docs/AUTH_EMAIL_SETUP.md", "docs/INSTALLATION_RECOVERY_WINDOWS.md",
  "supabase/migrations/0001_initial_schema.sql", "supabase/migrations/0002_cloudflare_r2_storage.sql", "supabase/migrations/0003_fix_admin_function_overloads.sql", "supabase/migrations/0004_auth_database_security_repair.sql", "supabase/migrations/0005_public_course_catalog_grants.sql", "supabase/migrations/0006_restore_rls_helper_execute_grants.sql", "supabase/migrations/0007_admin_console_and_role_grants.sql", "supabase/migrations/0008_stream_video_pricing_workflows.sql", "supabase/migrations/0009_r2_video_delivery_and_course_covers.sql", "supabase/migrations/0010_enforce_entitlement_revocation.sql", "supabase/migrations/0011_server_managed_lesson_resources.sql", "supabase/migrations/0012_category_requests.sql", "supabase/migrations/0013_course_category_holds.sql", "supabase/migrations/0014_single_role_per_user.sql", "supabase/migrations/0015_single_role_signup_trigger_fix.sql",
  "scripts/bootstrap-super-admin.mjs", "supabase/BOOTSTRAP_ADMIN.md", "docs/CHANGELOG.md",
  "src/lib/server/r2.ts", "src/lib/server/r2-policy.ts", "src/lib/server/r2-policy.test.ts",
  "src/app/[locale]/admin/page.tsx", "src/components/admin-console.tsx", "src/app/api/admin/users/route.ts", "src/app/api/admin/users/[userId]/route.ts", "src/app/api/admin/courses/[courseId]/route.ts", "src/app/api/admin/categories/route.ts", "src/app/api/admin/categories/[categoryId]/route.ts", "src/app/api/admin/settings/route.ts", "src/app/api/r2/upload-url/route.ts", "src/app/api/r2/upload-cover/route.ts", "src/app/api/r2/complete-upload/route.ts",
  "src/app/api/r2/download-url/route.ts", "src/app/api/r2/playback-url/route.ts", "src/app/api/r2/delete-resource/route.ts", "src/app/api/stream/upload-url/route.ts", "src/app/api/stream/playback-token/route.ts", "src/app/api/stream/status/route.ts", "src/app/api/courses/[courseId]/pricing/route.ts", "src/components/pricing-plan-manager.tsx", "src/components/course-pricing-panel.tsx", "src/components/forgot-password-form.tsx", "src/components/reset-password-form.tsx", "src/components/setup-account-form.tsx", "src/app/[locale]/setup-account/page.tsx", "src/lib/auth-redirects.ts", "src/components/site-header.tsx", "src/components/site-header-client.tsx", "scripts/diagnose-auth-user.mjs", "scripts/check-auth-email-config.mjs", "src/components/instructor-profile-form.tsx", "src/app/api/instructor/profile/route.ts", "src/app/[locale]/instructors/[slug]/page.tsx", "src/app/api/courses/[courseId]/submit-review/route.ts", "src/components/submit-course-review-button.tsx", "src/app/api/lessons/progress/route.ts",
  "src/lib/supabase/admin.ts", "src/lib/server/auth.ts", "src/lib/server/admin-authorization.ts", "src/lib/server/database-errors.ts", "src/lib/auth-errors.ts", "src/app/api/health/route.ts", "src/app/icon.svg", "src/app/favicon.ico", "supabase/migrations/0004_auth_database_security_repair.sql", "docs/R2_SETUP.md", "docs/DATABASE_RECOVERY.md", "scripts/cleanup-r2-orphans.mjs",
];
const missing = requiredFiles.filter((file) => !fs.existsSync(path.join(root, file)));
if (missing.length) {
  console.error(`Missing required files: ${missing.join(", ")}`);
  process.exit(1);
}

const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
for (const dep of ["@aws-sdk/client-s3", "@aws-sdk/s3-request-presigner"]) {
  if (!pkg.dependencies?.[dep]) { console.error(`Missing R2 dependency: ${dep}`); process.exit(1); }
}

const sourceFiles = [];
function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (["node_modules", ".next", "coverage", "dist"].includes(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(absolute);
    else if (/\.(tsx?|mts|cts)$/.test(entry.name)) sourceFiles.push(absolute);
  }
}
walk(path.join(root, "src"));
for (const file of ["next.config.ts", "vitest.config.ts", "playwright.config.ts"]) {
  if (fs.existsSync(path.join(root, file))) sourceFiles.push(path.join(root, file));
}
const syntaxIssues = [];
for (const file of sourceFiles) {
  const source = fs.readFileSync(file, "utf8");
  const result = ts.transpileModule(source, {
    fileName: file,
    reportDiagnostics: true,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX },
  });
  for (const diagnostic of result.diagnostics ?? []) {
    if (diagnostic.category === ts.DiagnosticCategory.Error) {
      syntaxIssues.push(`${path.relative(root, file)}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, " ")}`);
    }
  }
}
if (syntaxIssues.length) {
  console.error(`TypeScript syntax diagnostics:\n${syntaxIssues.join("\n")}`);
  process.exit(1);
}

const sql = fs.readFileSync(path.join(root, "supabase/migrations/0001_initial_schema.sql"), "utf8");
if (!/create\s+table\s+if\s+not\s+exists\s+public\.profiles/i.test(sql)) {
  console.error("Migration is missing repeat-safe profiles table creation."); process.exit(1);
}
if (/create\s+table\s+public\.profiles\s*\(/i.test(sql)) {
  console.error("Migration contains a non-idempotent profiles table creation."); process.exit(1);
}
const policies = [...sql.matchAll(/create\s+policy\s+"([^"]+)"\s+on\s+public\.([a-z0-9_]+)/gi)];
for (const policy of policies) {
  const needle = `drop policy if exists "${policy[1]}" on public.${policy[2]};`;
  if (sql.indexOf(needle) === -1 || sql.indexOf(needle) > policy.index) {
    console.error(`Policy is not dropped before recreation: ${policy[1]} on ${policy[2]}`); process.exit(1);
  }
}
for (const feature of ["quiz_question_catalog", "guard_lesson_stream_state", "guard_submission_grading_fields", "guard_quiz_attempt_score"]) {
  if (!sql.includes(feature)) { console.error(`Missing expected database hardening object: ${feature}`); process.exit(1); }
}
for (const migrationPath of ["supabase/migrations/0001_initial_schema.sql", "supabase/migrations/0003_fix_admin_function_overloads.sql"]) {
  const migrationText = fs.readFileSync(path.join(root, migrationPath), "utf8");
  if (/function\s+public\.is_admin\s*\(\s*_user_id\s+uuid\s+default\b/i.test(migrationText)) {
    console.error(`${migrationPath} must not define is_admin(uuid DEFAULT ...); it is ambiguous when a no-argument overload exists.`); process.exit(1);
  }
  for (const signature of ["public.is_admin()", "public.is_admin(_user_id uuid)", "public.is_active_user()", "public.is_active_user(_user_id uuid)", "public.owns_course(_course_id uuid)", "public.owns_course(_course_id uuid, _user_id uuid)"]) {
    if (!migrationText.includes(signature)) { console.error(`${migrationPath} is missing explicit helper overload ${signature}`); process.exit(1); }
  }
}
const bootstrapScript = fs.readFileSync(path.join(root, "scripts/bootstrap-super-admin.mjs"), "utf8");
for (const marker of ["auth.admin.createUser", 'role: "super_admin"', "--resume-existing", "BOOTSTRAP_SUPER_ADMIN_PASSWORD", "profiles"]) {
  if (!bootstrapScript.includes(marker)) { console.error(`Missing Super Admin bootstrap safety/functionality marker: ${marker}`); process.exit(1); }
}
const r2Sql = fs.readFileSync(path.join(root, "supabase/migrations/0002_cloudflare_r2_storage.sql"), "utf8");
for (const feature of ["r2_uploads", "lessons_r2_object_key_unique", "guard_lesson_media_fields", "revoke all on table public.r2_uploads from anon, authenticated"]) {
  if (!r2Sql.includes(feature)) { console.error(`Missing R2 schema hardening: ${feature}`); process.exit(1); }
}
const r2Upload = fs.readFileSync(path.join(root, "src/app/api/r2/upload-url/route.ts"), "utf8");
const r2Complete = fs.readFileSync(path.join(root, "src/app/api/r2/complete-upload/route.ts"), "utf8");
const r2Playback = fs.readFileSync(path.join(root, "src/app/api/r2/playback-url/route.ts"), "utf8");
const r2Service = fs.readFileSync(path.join(root, "src/lib/server/r2.ts"), "utf8");
if (!r2Upload.includes("createR2UploadUrl") || !r2Upload.includes("canManageCourse") || !r2Upload.includes('purpose: z.enum(["video", "resource", "cover"])') || !r2Upload.includes("Direct browser-to-R2 cover uploads are disabled") || !r2Complete.includes("headR2Object") || !r2Complete.includes("expected_size_bytes") || !r2Complete.includes("getR2CoverPublicUrl") || !r2Complete.includes("matchesFileSignature") || !r2Playback.includes("createR2DownloadUrl") || !r2Playback.includes("canReadLessonContent") || !r2Playback.includes("Cache-Control") || !r2Service.includes('signableHeaders: new Set(["content-type", "if-none-match"])')) {
  console.error("Private R2 upload/playback, cover-upload, ownership or integrity checks are missing."); process.exit(1);
}
const streamUpload = fs.readFileSync(path.join(root, "src/app/api/stream/upload-url/route.ts"), "utf8");
const streamPlayback = fs.readFileSync(path.join(root, "src/app/api/stream/playback-token/route.ts"), "utf8");
if (!streamUpload.includes("status: 410") || !streamPlayback.includes("status: 410")) {
  console.error("Legacy Stream endpoints must be explicitly disabled after migration to R2."); process.exit(1);
}
const r2Migration = fs.readFileSync(path.join(root, "supabase/migrations/0009_r2_video_delivery_and_course_covers.sql"), "utf8");
for (const marker of ["purpose in ('video','resource','cover')", "purpose = 'cover'", "revoke insert, update, delete on table public.r2_uploads"]) {
  if (!r2Migration.includes(marker)) { console.error(`R2 media migration is missing security marker: ${marker}`); process.exit(1); }
}
const submitReviewRoute = fs.readFileSync(path.join(root, "src/app/api/courses/[courseId]/submit-review/route.ts"), "utf8");
if (!submitReviewRoute.includes("course.submitted_for_review") || !submitReviewRoute.includes("processing_status !== \"ready\"") || !submitReviewRoute.includes("pricing plan")) {
  console.error("Course review submission must validate ready video processing and an active pricing plan."); process.exit(1);
}
const permissionRoute = fs.readFileSync(path.join(root, "src/app/api/admin/users/[userId]/route.ts"), "utf8");
if (!permissionRoute.includes("courses.manage_pricing") || !permissionRoute.includes(".max(5)")) {
  console.error("Delegated administrator permissions are missing the course-pricing permission."); process.exit(1);
}
const pricingRoute = fs.readFileSync(path.join(root, "src/app/api/courses/[courseId]/pricing/route.ts"), "utf8");
const pricingUi = fs.readFileSync(path.join(root, "src/components/pricing-plan-manager.tsx"), "utf8");
if (!pricingRoute.includes("hasSameOrigin") && !pricingRoute.includes("isSameOriginMutation") || !pricingRoute.includes("amount_minor") || !pricingRoute.includes("is_active") || !pricingUi.includes("Phase 1") || !pricingUi.includes("billingPeriod")) {
  console.error("Pricing plan management is missing access checks, stored price metadata, or the no-payment Phase 1 warning."); process.exit(1);
}
const cleanupScript = fs.readFileSync(path.join(root, "scripts/cleanup-r2-orphans.mjs"), "utf8");
if (!cleanupScript.includes('const dryRun = !process.argv.includes("--apply")') || !cleanupScript.includes("const deleteLimit = 250") || !cleanupScript.includes('Prefix: "lms/"')) {
  console.error("R2 orphan cleanup must default to dry-run and restrict bounded deletion to the LMS prefix."); process.exit(1);
}
const accessHelper = fs.readFileSync(path.join(root, "src/lib/server/r2-access.ts"), "utf8");
if (accessHelper.includes('from("enrollments")')) { console.error("Playback authorization must not fall back to stale enrollment rows after entitlement expiry/revocation."); process.exit(1); }
const entitlementSql = fs.readFileSync(path.join(root, "supabase/migrations/0010_enforce_entitlement_revocation.sql"), "utf8");
for (const marker of ["has_active_entitlement(auth.uid(), c.id)", "create or replace view public.quiz_question_catalog", "reviews enrolled write"]) { if (!entitlementSql.includes(marker)) { console.error(`Entitlement revocation migration is missing marker: ${marker}`); process.exit(1); } }
const resourceHardeningSql = fs.readFileSync(path.join(root, "supabase/migrations/0011_server_managed_lesson_resources.sql"), "utf8");
for (const marker of ["revoke all on table public.lesson_resources from public, anon, authenticated", "grant select on table public.lesson_resources to authenticated", "lesson_resource_metadata_is_server_managed", "lesson_resources_server_write_guard"]) {
  if (!resourceHardeningSql.includes(marker)) { console.error(`Lesson resource write hardening is missing ${marker}.`); process.exit(1); }
}
const r2Tests = fs.readFileSync(path.join(root, "src/lib/server/r2-policy.test.ts"), "utf8");
for (const testCase of ["allows only the supported video formats", "checks basic magic bytes", "rejects executable and HTML content", "sanitizes display names"]) {
  if (!r2Tests.includes(testCase)) { console.error(`Missing R2 upload policy test: ${testCase}`); process.exit(1); }
}
const courseCreateRoute = fs.readFileSync(path.join(root, "src/app/api/courses/route.ts"), "utf8");
const coverForm = fs.readFileSync(path.join(root, "src/components/course-create-form.tsx"), "utf8");
const lessonEditor = fs.readFileSync(path.join(root, "src/components/instructor-course-editor.tsx"), "utf8");
if (courseCreateRoute.includes("isInstructorApproved") || !courseCreateRoute.includes('status: "draft"') || !courseCreateRoute.includes('"instructor", "super_admin"')) {
  console.error("Draft creation must permit active instructor-role users without silently granting review/publication rights."); process.exit(1);
}
for (const marker of ['type="file"', 'fetch("/api/r2/upload-cover"', "coverPreview", "Upload cover"]) {
  if (!coverForm.includes(marker)) { console.error(`Manual course-cover upload flow is missing ${marker}.`); process.exit(1); }
}
for (const marker of ["uploadFileWithProgress", "uploadProgress", "resuming an interrupted upload is not supported yet", 'purpose: \"video\"']) {
  if (!lessonEditor.includes(marker)) { console.error(`R2 video upload UX or workflow is missing ${marker}.`); process.exit(1); }
}
if (!/^begin;\s/i.test(r2Migration) || !/commit;\s*$/i.test(r2Migration)) {
  console.error("R2 media migration must be transaction-wrapped."); process.exit(1);
}
for (const route of ["src/app/api/courses/route.ts", "src/app/api/courses/[courseId]/sections/route.ts", "src/app/api/sections/[sectionId]/lessons/route.ts", "src/app/api/r2/upload-url/route.ts", "src/app/api/r2/upload-cover/route.ts", "src/app/api/r2/complete-upload/route.ts", "src/app/api/r2/delete-resource/route.ts", "src/app/api/enrollments/free/route.ts"]) {
  if (!fs.readFileSync(path.join(root, route), "utf8").includes("writeAuditLog")) { console.error(`Missing mutation audit event: ${route}`); process.exit(1); }
}

const quizViewSql = fs.readFileSync(path.join(root, "supabase/migrations/0004_auth_database_security_repair.sql"), "utf8");
if (!/security_invoker\s*=\s*true/i.test(quizViewSql) || !/revoke\s+select\s+on\s+table\s+public\.questions\s+from\s+public,\s*anon,\s*authenticated/i.test(quizViewSql) || /grant\s+select\s*\([^)]*correct_answer/i.test(quizViewSql)) {
  console.error("Quiz catalog must use security_invoker and must not grant the correct_answer column to browser roles."); process.exit(1);
}
if (!fs.existsSync(path.join(root, "src/app/favicon.ico"))) { console.error("Missing App Router favicon.ico."); process.exit(1); }
const catalogGrants = fs.readFileSync(path.join(root, "supabase/migrations/0005_public_course_catalog_grants.sql"), "utf8");
if (!/grant\s+select\s*\(\s*id,\s*slug,\s*title_ar,\s*title_en,\s*summary_ar,\s*summary_en,\s*status,\s*published_at\s*\)\s*on\s+table\s+public\.courses\s+to\s+anon,\s*authenticated/i.test(catalogGrants)) {
  console.error("Public course catalog is missing its minimal column-level grants."); process.exit(1);
}

const helperGrants = fs.readFileSync(path.join(root, "supabase/migrations/0006_restore_rls_helper_execute_grants.sql"), "utf8");
if (!/grant\s+execute\s+on\s+function\s+public\.is_admin\(\)\s+to\s+anon,\s*authenticated,\s*service_role/i.test(helperGrants) || /disable\s+row\s+level\s+security/i.test(helperGrants)) {
  console.error("RLS helper repair must grant only the explicit is_admin() predicate without disabling RLS."); process.exit(1);
}

const adminSql = fs.readFileSync(path.join(root, "supabase/migrations/0007_admin_console_and_role_grants.sql"), "utf8");
const lessonGuard = adminSql.match(/create or replace function public\.guard_lesson_stream_state\(\)([\s\S]*?)\$\$;/i)?.[1] ?? "";
if (!lessonGuard.includes("r2_object_key") || !lessonGuard.includes("lesson_media_fields_are_server_managed") || /from\s+public\.stream_uploads/i.test(lessonGuard)) {
  console.error("Migration 0007 must preserve the current private R2 lesson-upload workflow."); process.exit(1);
}
const categoryRoute = fs.readFileSync(path.join(root, "src/app/api/admin/categories/[categoryId]/route.ts"), "utf8");
if ((categoryRoute.match(/hasAdminPermission\(auth\.actor, "categories\.manage"\)/g) ?? []).length < 2) {
  console.error("Both category update and delete endpoints must enforce delegated category permissions."); process.exit(1);
}
for (const marker of [
  "create or replace function public.is_super_admin()",
  "create table if not exists public.user_permissions",
  "users.manage_instructors",
  "courses.review",
  "categories.manage",
  "audit.read",
  "public.owns_course(_course_id uuid, _user_id uuid)",
  "public.guard_course_privileged_fields()",
  "grant insert (section_id, title_en, title_ar, kind, body_en, body_ar, is_preview, sort_order)",
  "from pg_policies",
  "replace(replace(p.qual, 'public.is_admin()', 'public.is_super_admin()')",
  "revoke insert, update, delete on table public.user_roles from public, anon, authenticated",
  "revoke insert, update, delete on table public.categories from public, anon, authenticated",
  "grant execute on function public.is_super_admin() to anon, authenticated, service_role",
]) {
  if (!adminSql.toLowerCase().includes(marker.toLowerCase())) {
    console.error(`Admin migration is missing a required security/functionality marker: ${marker}`); process.exit(1);
  }
}
const authCallback = fs.readFileSync(path.join(root, "src/app/[locale]/auth/callback/route.ts"), "utf8");
if (!authCallback.includes("exchangeCodeForSession") || !authCallback.includes("verifyOtp") || !authCallback.includes("token_hash")) {
  console.error("Auth callback must support both PKCE and token-hash invitation links."); process.exit(1);
}
const serverAuth = fs.readFileSync(path.join(root, "src/lib/server/auth.ts"), "utf8");
if (!serverAuth.includes('import "server-only"') || !serverAuth.includes('createAdminClient()') || !serverAuth.includes('.from("user_roles").select("role")')) {
  console.error("Role lookup must be server-only and use the trusted service client."); process.exit(1);
}
const adminAuthorization = fs.readFileSync(path.join(root, "src/lib/server/admin-authorization.ts"), "utf8");
if (!adminAuthorization.includes("hasAdminPermission") || !adminAuthorization.includes("getAccountState") || !adminAuthorization.includes("user_permissions")) {
  console.error("Administrator API authorization is missing server-side account/permission checks."); process.exit(1);
}
const setupPage = path.join(root, "src/app/[locale]/setup-account/page.tsx");
const setupForm = path.join(root, "src/components/setup-account-form.tsx");
const inviteRoute = fs.readFileSync(path.join(root, "src/app/api/admin/users/route.ts"), "utf8");
const recoveryForm = fs.readFileSync(path.join(root, "src/components/forgot-password-form.tsx"), "utf8");
if (!fs.existsSync(setupPage) || !fs.existsSync(setupForm) || !inviteRoute.includes("/setup-account?flow=invite") || !recoveryForm.includes("/auth/callback?flow=recovery&next=")) {
  console.error("Invitation first-password setup or password-recovery callback workflow is incomplete."); process.exit(1);
}
const headerClient = fs.readFileSync(path.join(root, "src/components/site-header-client.tsx"), "utf8");
if (!headerClient.includes("aria-expanded={open}") || !headerClient.includes("nav-link-active")) {
  console.error("Accessible responsive navigation is missing its open state or active link state."); process.exit(1);
}
const coverUploadRoute = fs.readFileSync(path.join(root, "src/app/api/r2/upload-cover/route.ts"), "utf8");
const categoryHoldMigration = fs.readFileSync(path.join(root, "supabase/migrations/0013_course_category_holds.sql"), "utf8");
const singleRoleMigration = fs.readFileSync(path.join(root, "supabase/migrations/0014_single_role_per_user.sql"), "utf8");
const categoryAdminRoute = fs.readFileSync(path.join(root, "src/app/api/admin/category-requests/[requestId]/route.ts"), "utf8");
const courseFormSource = fs.readFileSync(path.join(root, "src/components/course-create-form.tsx"), "utf8");
const userRoleApi = fs.readFileSync(path.join(root, "src/app/api/admin/users/[userId]/route.ts"), "utf8");
if (!coverUploadRoute.includes('request.formData()') || !coverUploadRoute.includes('matchesFileSignature') || !coverUploadRoute.includes('putR2Object') || courseFormSource.includes('fetch(prepare.uploadUrl') || !r2Service.includes('must be a public custom domain')) {
  console.error("Course cover uploads must use same-origin server-side R2 upload with signature validation, not browser CORS PUTs."); process.exit(1);
}
for (const marker of ["course_category_holds", "prevent_course_publish_with_pending_category", "course_category_approval_pending"]) if (!categoryHoldMigration.includes(marker)) { console.error(`Missing course category hold rule: ${marker}`); process.exit(1); }
if (!singleRoleMigration.includes("primary key (user_id)") || !singleRoleMigration.includes("on conflict (user_id) do nothing") || !userRoleApi.includes('onConflict: "user_id"') || !userRoleApi.includes('action: z.literal("set_role")')) {
  console.error("User accounts must have exactly one role and role changes must replace the current role."); process.exit(1);
}
const singleRoleTrigger = fs.readFileSync(path.join(root, "supabase/migrations/0015_single_role_signup_trigger_fix.sql"), "utf8");
if (!singleRoleTrigger.includes("create or replace function public.handle_new_auth_user()") || !singleRoleTrigger.includes("on conflict (user_id) do nothing") || singleRoleTrigger.includes("on conflict (user_id, role)")) {
  console.error("The Auth signup trigger must match the single-role primary key, otherwise new registrations may fail."); process.exit(1);
}
if (!categoryAdminRoute.includes("course_category_holds") || !categoryAdminRoute.includes("linkedCourseCount") || !courseFormSource.includes("proposedCategory")) {
  console.error("Course/category approval flow must keep course creation moving and attach approved categories to linked courses."); process.exit(1);
}
const footerSource = fs.readFileSync(path.join(root, "src/components/site-footer.tsx"), "utf8");
const rootLayout = fs.readFileSync(path.join(root, "src/app/layout.tsx"), "utf8");
const globalCss = fs.readFileSync(path.join(root, "src/app/globals.css"), "utf8");
const homeSource = fs.readFileSync(path.join(root, "src/app/[locale]/page.tsx"), "utf8");
if (!footerSource.includes("footer-link-column") || !headerClient.includes("nav-search") || !headerClient.includes("aria-expanded={open}") || !rootLayout.includes("IBM+Plex+Sans+Arabic") || !globalCss.includes("--bg: #1B2228") || !globalCss.includes("--brand: #2ED2FF") || !homeSource.includes("hero-visual")) {
  console.error("Design-system typography/tokens, discovery search, hero composition, or responsive navigation/footer refinements are missing."); process.exit(1);
}
for (const privatePage of [
  "src/app/[locale]/admin/page.tsx", "src/app/[locale]/dashboard/page.tsx", "src/app/[locale]/my-learning/page.tsx",
  "src/app/[locale]/instructor/courses/page.tsx", "src/app/[locale]/instructor/courses/new/page.tsx",
  "src/app/[locale]/instructor/courses/[courseId]/page.tsx", "src/app/[locale]/instructor/profile/page.tsx",
  "src/app/[locale]/lessons/[lessonId]/page.tsx", "src/app/[locale]/setup-account/page.tsx",
  "src/app/[locale]/reset-password/page.tsx", "src/app/[locale]/sign-in/page.tsx",
  "src/app/[locale]/sign-up/page.tsx", "src/app/[locale]/forgot-password/page.tsx"
]) {
  if (!fs.readFileSync(path.join(root, privatePage), "utf8").includes("robots: { index: false, follow: false }")) {
    console.error(`Sensitive/account-specific route must opt out of search indexing: ${privatePage}`); process.exit(1);
  }
}
if (rootLayout.includes("robots: { index: true")) {
  console.error("Do not globally opt private account/admin pages into search indexing."); process.exit(1);
}

console.log(`Static verification passed: ${sourceFiles.length} TypeScript/TSX files parsed, ${policies.length} repeat-safe policies checked, explicit SQL helper overloads and RLS helper grants verified, Super Admin bootstrap, admin console, private R2 video upload/playback, same-origin public course cover workflow, category approval holds, exclusive user roles, pricing-plan routes, and R2 schema checks found.`);
console.log("This is a syntax/structure check, not a full typecheck, SQL execution, integration test, or production build.");
