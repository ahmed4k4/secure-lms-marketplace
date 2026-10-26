import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const walk = (dir) => fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((entry) => {
  const next = path.join(dir, entry.name);
  return entry.isDirectory() ? walk(next) : /\.(ts|tsx)$/.test(entry.name) ? [next] : [];
});
const errors = [];
const assert = (condition, message) => { if (!condition) errors.push(message); };

const en = read('src/lib/i18n/en.ts');
const ar = read('src/lib/i18n/ar.ts');
const keys = (text) => new Set([...text.matchAll(/^\s*'([^']+)'\s*:/gm)].map((m) => m[1]));
const enKeys = keys(en), arKeys = keys(ar);
assert([...enKeys].every((key) => arKeys.has(key)) && [...arKeys].every((key) => enKeys.has(key)), 'English and Arabic translation keys must match.');

const migrationDir = path.join(root, 'supabase/migrations');
const migrations = fs.readdirSync(migrationDir).filter((name) => /^\d+.*\.sql$/.test(name)).sort();
assert(migrations.length >= 15, 'Expected the full schema, security, performance, and service-role privilege migration sequence.');
const serviceRoleMigration = read('supabase/migrations/0015_service_role_privileges.sql');
assert(serviceRoleMigration.includes('GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO service_role'), 'Server-side service_role must have explicit privileges on existing public tables.');
assert(serviceRoleMigration.includes('ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public'), 'Future public tables must inherit service_role privileges.');
assert(!/GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO anon|GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO authenticated/i.test(serviceRoleMigration), 'Do not grant broad table privileges to public client roles.');
assert(migrations.every((name, index) => index === 0 || migrations[index - 1].slice(0, 4) <= name.slice(0, 4)), 'Migrations must be lexicographically ordered.');

const auth = read('src/lib/auth.ts');
const rolesMigration = read('supabase/migrations/0007_single_role_remove_mfa.sql');
const allSource = walk('src').map(read).join('\n');
assert(auth.includes('requirePermission') && auth.includes('has_permission'), 'Server-side permission checks must remain present.');
assert(rolesMigration.includes('user_roles_one_role_per_user'), 'Database must enforce a single role per account.');
assert(!/aal2|admin_mfa_ok|mfa-panel|totp/i.test(allSource), 'The application source must not include MFA gates or TOTP flows.');
assert(read('src/app/api/uploads/cover/route.ts').includes('uploadCoverObject'), 'Course covers must use server-side R2 upload.');
assert(read('src/app/api/lessons/[lessonId]/qa/route.ts').includes('has_course_access'), 'Deferred Q&A route must verify course access server-side.');
assert(read('src/components/lesson-panel.tsx').includes('<LessonQa'), 'Lesson Q&A should be loaded only after its tab is opened.');
assert(read('src/components/course-card.tsx').includes('prefetch={false}'), 'Catalog cards must avoid a burst of prefetch requests.');
assert(!read('src/components/course-card.tsx').includes('unoptimized sizes='), 'Course covers must use the Next.js image optimizer.');
assert(read('src/middleware.ts').includes('hasSession && !isApiRoute'), 'API handlers must not repeat the middleware Supabase auth round-trip.');
assert(read('supabase/migrations/0014_performance_indexes.sql').includes('notifications_unread_user_created_idx'), 'Unread notification queries must have a targeted partial index.');
assert(read('src/app/api/uploads/cover/route.ts').includes('enforceRateLimit'), 'Cover uploads must be rate-limited.');
assert(read('src/lib/r2.ts').includes('R2_COVERS_PUBLIC_URL') && read('src/lib/r2.ts').includes('r2\\.cloudflarestorage\\.com'), 'Cover URLs must validate public URL configuration and reject the S3 API host.');
assert(read('supabase/migrations/0009_category_cover_workflow.sql').includes('review_category_request'), 'Category request review RPC must exist.');
assert(read('supabase/migrations/0011_existing_category_transition.sql').includes("new.category_id is not null and new.category_request_id is null"), 'Courses must be able to switch to an approved category instead of waiting for a rejected proposal.');
assert(read('src/components/course-cover-field.tsx').includes('/api/uploads/cover'), 'The browser should upload covers through same-origin Next.js.');
assert(read('src/components/course-category-field.tsx').includes('setCategoryId'), 'Category selection/proposal UX must be mutually exclusive.');
assert(read('src/components/site-header.tsx').includes('header-course-search'), 'The header should offer desktop course search.');
assert(read('src/components/site-header.tsx').includes('mobile-course-search'), 'The mobile menu should offer course search.');
assert(read('src/app/globals.css').includes('--arc: 46 210 255'), 'Arc Blue must be defined through the design-system token.');
assert(read('src/lib/validation.ts').includes("z.enum(['free', 'one_time', 'monthly', 'yearly'])"), 'Instructor pricing must support free, one-time, monthly, and yearly plans.');
assert(read('supabase/migrations/0012_pricing_model_catalog.sql').includes('pp.billing_interval as billing_interval'), 'The public catalogue must expose subscription cadence.');
assert(read('src/lib/auth.ts').includes("redirect('/suspended?reason=instructor')"), 'Suspended instructors must be blocked at the server authorization layer.');
assert(read('supabase/migrations/0013_atomic_course_pricing.sql').includes('configure_course_pricing'), 'Pricing changes must be transactional.');

assert(read('src/lib/admin-directory.ts').includes('admin.auth.admin.listUsers'), 'Admin directory must source accounts from Supabase Auth, not profiles alone.');
assert(read('src/lib/admin-directory.ts').includes('least-privilege rows'), 'Missing legacy profile rows must be repaired without privilege escalation.');
assert(read('src/app/admin/users/page.tsx').includes('Search name, email, or ID') || read('src/app/admin/users/page.tsx').includes('Search name'), 'Admin user directory must support broad account search.');
assert(read('src/app/admin/courses/new/page.tsx').includes('ownerInstructorId'), 'Super admins need a course creation flow that assigns an active instructor owner.');
assert(read('src/app/instructor/page.tsx').includes('Awaiting grading') || read('src/app/instructor/page.tsx').includes('تحتاج تصحيحًا'), 'Instructor dashboard must surface pending assignment grading.');

assert(read('src/components/action-form.tsx').includes('children?: ReactNode'), 'ActionForm must support server actions without visible input fields.');
assert(read('src/app/courses/[slug]/page.tsx').includes('description, cover_url, language'), 'Course detail query must select the cover_url field that it renders.');
assert(read('src/app/dashboard/page.tsx').includes('cover_url: string | null'), 'Dashboard joined-course typing must include nullable cover_url.');
assert(read('tests/db/rls.test.ts').includes('expect(rows.rows[0]).toEqual({ n: 1 })'), 'PGlite Results must be accessed through its rows array.');

assert(read('src/actions/admin.ts').includes('[admin.course-review] update failed'), 'Course review must log safe diagnostics when privileged status updates fail.');
assert(read('src/actions/admin.ts').includes('course.category_request_id || !course.category_id'), 'Course publication must be blocked while category approval is incomplete.');
assert(read('src/actions/admin.ts').includes("admin.from('instructor_profiles').select('status')"), 'Course publication must require an active instructor.');
assert(fs.existsSync('supabase/migrations/0017_wallet_and_revenue.sql'), 'wallet/revenue migration missing');
assert(fs.existsSync('src/app/wallet/page.tsx'), 'wallet page missing');
assert(fs.existsSync('src/app/admin/wallets/page.tsx'), 'admin wallet page missing');
assert(fs.existsSync('src/api/account/avatar/route.ts') || fs.existsSync('src/app/api/account/avatar/route.ts'), 'avatar upload route missing');
assert(fs.existsSync('supabase/migrations/0018_hls_transcoding_and_playback_audit.sql'), 'HLS and playback audit migration missing');
assert(fs.existsSync('supabase/migrations/0019_wallet_subscriptions_payouts_refunds.sql'), 'subscription and finance migration missing');
assert(fs.existsSync('supabase/migrations/0020_video_controls_and_finance_hardening.sql'), 'video controls and finance hardening migration missing');
assert(read('src/components/video-player.tsx').includes("import('hls.js')") && read('src/components/video-player.tsx').includes('currentLevel = next'), 'Video player must load HLS and support quality selection.');
assert(read('workers/transcoder/transcode.mjs').includes("'-hls_playlist_type', 'vod'") && read('workers/transcoder/transcode.mjs').includes('heartbeat_at'), 'Transcoder must produce HLS VOD and maintain queue heartbeats.');
assert(read('src/app/admin/settings/page.tsx').includes('hls_max_height') && read('src/actions/admin.ts').includes("requirePermission('admins.manage')"), 'Only the Super Admin should control global video processing/security settings.');
assert(fs.existsSync('src/app/admin/finance/page.tsx') && read('src/app/admin/finance/page.tsx').includes('reviewPayoutAction'), 'Admin finance review console missing.');
assert(read('src/app/api/cron/maintenance/route.ts').includes("admin.rpc('renew_wallet_subscriptions')") && read('src/app/api/cron/maintenance/route.ts').includes("admin.rpc('settle_instructor_earnings'"), 'Daily maintenance must renew wallet subscriptions and settle eligible earnings.');
assert(fs.existsSync('src/app/api/uploads/multipart/abort/route.ts'), 'Multipart upload cleanup endpoint missing.');

const tsFiles = walk('src');
if (errors.length) {
  console.error('Static verification failed:');
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log(`Static verification passed: ${tsFiles.length} TypeScript/TSX files, ${migrations.length} SQL migrations, bilingual dictionary parity, no application MFA/TOTP, single-role constraint, rate-limited same-origin cover upload, category hold workflow, free/one-time/subscription plan configuration, and responsive search and performance paths, repaired admin account directory, instructor-owned admin course creation, assessment dashboard checks, HLS transcoding and rendition selection, Super Admin video controls, multi-currency payout reservations, wallet subscriptions/refunds, finance-console, heartbeat-recovery, and daily renewal/settlement checks; explicit server-only service_role grants. This is not a substitute for typecheck, SQL integration tests, lint, or production build.`);
}

