import { requireAnyRole } from "@/lib/server/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { AdminConsole } from "@/components/admin-console";

type ProfileRow = { id: string; display_name: string; status: "active" | "pending" | "suspended"; created_at: string };
type RoleRow = { user_id: string; role: "super_admin" | "admin" | "instructor" | "student" };
type CourseRow = { id: string; owner_id: string; title_ar: string; title_en: string; status: string; is_featured: boolean; created_at: string };
type CategoryRow = { id: string; slug: string; name_en: string; name_ar: string; sort_order: number };
type CategoryRequestRow = { id: string; requester_id: string; name_en: string; name_ar: string; slug: string; status: string; created_at: string };
const safeText = (value: unknown) => typeof value === "string" ? value.slice(0, 200) : "unknown";

export const metadata = { robots: { index: false, follow: false } };

export default async function AdminPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const { user, roles } = await requireAnyRole(locale, ["admin", "super_admin"]);
  const isSuperAdmin = roles.includes("super_admin");
  const db = createAdminClient();
  const [profileResult, courseResult, categoryResult, instructorResult, auditResult, settingsResult, roleResult, permissionResult, authUsersResult, categoryRequestsResult, totalUsers, totalCourses, pendingCourses, pendingInstructors] = await Promise.all([
    db.from("profiles").select("id,display_name,status,created_at").order("created_at", { ascending: false }).limit(200),
    db.from("courses").select("id,owner_id,title_ar,title_en,status,is_featured,created_at").order("created_at", { ascending: false }).limit(200),
    db.from("categories").select("id,slug,name_en,name_ar,sort_order").order("sort_order").limit(300),
    db.from("instructor_profiles").select("user_id,is_approved").limit(500),
    db.from("audit_logs").select("id,actor_id,action,target_type,target_id,created_at").order("created_at", { ascending: false }).limit(100),
    isSuperAdmin ? db.from("platform_settings").select("key,value").limit(100) : Promise.resolve({ data: [], error: null }),
    db.from("user_roles").select("user_id,role").limit(1500),
    db.from("user_permissions").select("user_id,permission_key").limit(2500),
    db.auth.admin.listUsers({ page: 1, perPage: 1000 }),
    db.from("category_requests").select("id,requester_id,name_en,name_ar,slug,status,created_at").in("status", ["pending", "rejected"]).order("created_at", { ascending: false }).limit(100),
    db.from("profiles").select("id", { count: "exact", head: true }),
    db.from("courses").select("id", { count: "exact", head: true }),
    db.from("courses").select("id", { count: "exact", head: true }).eq("status", "in_review"),
    db.from("instructor_profiles").select("user_id", { count: "exact", head: true }).eq("is_approved", false),
  ]);

  const warnings: string[] = [];
  const check = (label: string, error: { code?: string; message?: string } | null | undefined) => {
    if (!error) return;
    warnings.push(label);
    console.error("admin_console_data_query_failed", JSON.stringify({ query: label, code: error.code ?? "unknown", message: safeText(error.message) }));
  };
  check("profiles", profileResult.error); check("courses", courseResult.error); check("categories", categoryResult.error);
  check("instructor_profiles", instructorResult.error); check("audit_logs", auditResult.error); check("platform_settings", settingsResult.error);
  check("user_roles", roleResult.error); check("user_permissions", permissionResult.error); check("auth_users", authUsersResult.error); check("category_requests", categoryRequestsResult.error);

  const profiles = (profileResult.data ?? []) as ProfileRow[];
  const courses = (courseResult.data ?? []) as CourseRow[];
  const categories = (categoryResult.data ?? []) as CategoryRow[];
  const categoryRequests = (categoryRequestsResult.data ?? []) as CategoryRequestRow[];
  const roleRows = (roleResult.data ?? []) as RoleRow[];
  const safePermissionRows = (permissionResult.data ?? []) as Array<{ user_id: string; permission_key: string }>;
  const safeAuditRows = (auditResult.data ?? []) as Array<{ id: number; actor_id: string | null; action: string; target_type: string; target_id: string | null; created_at: string }>;
  const safeSettingsRows = (settingsResult.data ?? []) as Array<{ key: string; value: unknown }>;
  const authUsers = (authUsersResult.data?.users ?? []) as Array<{ id: string; email?: string }>;
  const permissionsById = new Map<string, string[]>();
  for (const row of safePermissionRows) permissionsById.set(row.user_id, [...(permissionsById.get(row.user_id) ?? []), row.permission_key]);
  const actorPermissions = permissionsById.get(user.id) ?? [];
  const canManageUsers = isSuperAdmin || actorPermissions.includes("users.manage_instructors");
  const canReviewCourses = isSuperAdmin || actorPermissions.includes("courses.review");
  const canManageCategories = isSuperAdmin || actorPermissions.includes("categories.manage");
  const canReadAudit = isSuperAdmin || actorPermissions.includes("audit.read");
  const instructorRows = (instructorResult.data ?? []) as Array<{ user_id: string; is_approved: boolean }>;
  const profilesById = new Map(profiles.map((profile) => [profile.id, profile]));
  const emailById = new Map(authUsers.map((authUser) => [authUser.id, authUser.email ?? ""]));
  const rolesById = new Map<string, RoleRow["role"][]>();
  for (const row of roleRows) rolesById.set(row.user_id, [row.role]);
  const instructorById = new Map(instructorRows.map((row) => [row.user_id, row.is_approved]));

  const initialUsers = profiles.map((profile) => ({
    id: profile.id,
    email: emailById.get(profile.id) ?? "(email unavailable)",
    displayName: profile.display_name || emailById.get(profile.id) || profile.id,
    status: profile.status,
    roles: [...new Set(rolesById.get(profile.id) ?? ["student" as const])] as RoleRow["role"][],
    createdAt: profile.created_at,
    instructorApproved: instructorById.has(profile.id) ? Boolean(instructorById.get(profile.id)) : null,
    permissions: permissionsById.get(profile.id) ?? [],
  })).filter((row) => isSuperAdmin || (!row.roles.includes("admin") && !row.roles.includes("super_admin")));
  const initialCourses = courses.map((course) => ({
    id: course.id, titleAr: course.title_ar, titleEn: course.title_en, status: course.status,
    featured: course.is_featured, ownerEmail: emailById.get(course.owner_id) ?? profilesById.get(course.owner_id)?.display_name ?? course.owner_id,
    createdAt: course.created_at,
  }));
  const initialCategories = categories.map((category) => ({ id: category.id, slug: category.slug, nameEn: category.name_en, nameAr: category.name_ar, sortOrder: category.sort_order }));
  const initialAudit = (canReadAudit ? safeAuditRows : []).map((item) => ({ id: item.id, action: item.action, targetType: item.target_type, targetId: item.target_id, createdAt: item.created_at, actorEmail: item.actor_id ? emailById.get(item.actor_id) ?? item.actor_id : "system" }));
  const settingsMap = new Map(safeSettingsRows.map((setting) => [setting.key, setting.value as unknown]));
  const asNumber = (key: string, fallback: number) => { const value = settingsMap.get(key); return typeof value === "number" && Number.isFinite(value) ? value : fallback; };
  const asBoolean = (key: string, fallback: boolean) => { const value = settingsMap.get(key); return typeof value === "boolean" ? value : fallback; };
  const initialSettings = {
    commissionBps: asNumber("platform.commission_bps", 0),
    requireInstructorApproval: asBoolean("instructors.require_approval", true),
    requireCourseReview: asBoolean("courses.require_review", true),
    maxResourceBytes: asNumber("uploads.max_resource_bytes", 26_214_400),
  };

  return <>
    {warnings.length > 0 && <div className="container"><div className="notice notice-error" role="alert">{locale === "ar" ? `بعض بيانات لوحة الإدارة لم تُحمّل (${warnings.join(", ")}). طبّق migrations المطلوبة وافحص سجل الخادم.` : `Some admin data could not be loaded (${warnings.join(", ")}). Apply required migrations and inspect server logs.`}</div></div>}
    <AdminConsole locale={locale} actorId={user.id} isSuperAdmin={isSuperAdmin} actorPermissions={actorPermissions} counts={{ users: totalUsers.count ?? profiles.length, courses: totalCourses.count ?? courses.length, pendingCourses: pendingCourses.count ?? courses.filter((item) => item.status === "in_review").length, pendingInstructors: pendingInstructors.count ?? instructorRows.filter((item) => !item.is_approved).length }} initialUsers={canManageUsers ? initialUsers : []} initialCourses={canReviewCourses ? initialCourses : []} initialCategories={canManageCategories ? initialCategories : []} initialCategoryRequests={canManageCategories ? categoryRequests.map((r) => ({ id: r.id, requesterId: r.requester_id, nameEn: r.name_en, nameAr: r.name_ar, slug: r.slug, status: r.status, createdAt: r.created_at })) : []} initialAudit={initialAudit} initialSettings={isSuperAdmin ? initialSettings : { commissionBps: 0, requireInstructorApproval: true, requireCourseReview: true, maxResourceBytes: 26_214_400 }}/>
  </>;
}
