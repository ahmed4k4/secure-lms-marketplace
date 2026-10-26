import { NextResponse } from "next/server";
import { z } from "zod";
import { authorizeAdminApi, hasAdminPermission } from "@/lib/server/admin-authorization";
import { isSameOriginMutation } from "@/lib/server/request-security";
import { writeAuditLog } from "@/lib/server/audit";
import type { AppRole } from "@/lib/server/auth";

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("status"), status: z.enum(["active", "pending", "suspended"]) }),
  z.object({ action: z.literal("set_role"), role: z.enum(["super_admin", "admin", "instructor", "student"]) }),
  z.object({ action: z.literal("instructor_approval"), approved: z.boolean() }),
  z.object({ action: z.literal("permissions"), permissions: z.array(z.enum(["users.manage_instructors", "courses.review", "courses.manage_pricing", "categories.manage", "audit.read"])).max(5) }),
]);
const safeMessage = (value: unknown) => typeof value === "string" ? value.replace(/(?:sb_secret_|eyJ)[A-Za-z0-9_.-]+/g, "[REDACTED]").slice(0, 200) : "unknown";

export async function PATCH(request: Request, context: { params: Promise<{ userId: string }> }) {
  if (!isSameOriginMutation(request)) return NextResponse.json({ error: "Cross-origin request denied" }, { status: 403 });
  const auth = await authorizeAdminApi();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { userId } = await context.params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId)) return NextResponse.json({ error: "Invalid user ID" }, { status: 400 });
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid user-management operation" }, { status: 400 });
  const input = parsed.data;
  const superAdmin = auth.actor.roles.includes("super_admin");
  if (input.action === "permissions") {
    if (!superAdmin) return NextResponse.json({ error: "Only a Super Admin can change administrator permissions." }, { status: 403 });
    const { data: permissionTargetRoleRows, error: permissionTargetRolesError } = await auth.db.from("user_roles").select("role").eq("user_id", userId);
    if (permissionTargetRolesError) return NextResponse.json({ error: "Could not verify target roles." }, { status: 503 });
    const permissionTargetRoles = (permissionTargetRoleRows ?? []).map((row) => row.role as AppRole);
    if (!permissionTargetRoles.includes("admin") || permissionTargetRoles.includes("super_admin")) return NextResponse.json({ error: "Granular permissions can only be assigned to ordinary administrator accounts." }, { status: 409 });
    const allowed = [...new Set(input.permissions)];
    const { error: removeError } = allowed.length
      ? await auth.db.from("user_permissions").delete().eq("user_id", userId).not("permission_key", "in", `(${allowed.join(",")})`)
      : await auth.db.from("user_permissions").delete().eq("user_id", userId);
    if (removeError) return NextResponse.json({ error: "Could not remove previous permissions." }, { status: 500 });
    if (allowed.length) {
      const { error: grantError } = await auth.db.from("user_permissions").upsert(allowed.map((permission_key) => ({ user_id: userId, permission_key, granted_by: auth.actor.id })), { onConflict: "user_id,permission_key", ignoreDuplicates: false });
      if (grantError) return NextResponse.json({ error: "Could not save administrator permissions." }, { status: 500 });
    }
    await writeAuditLog({ actorId: auth.actor.id, action: "admin.permissions.updated", targetType: "user", targetId: userId, metadata: { permissions: allowed } });
    return NextResponse.json({ success: true });
  }
  const { data: targetProfile, error: targetProfileError } = await auth.db.from("profiles").select("id,status,display_name").eq("id", userId).maybeSingle();
  if (targetProfileError) {
    console.error("admin_target_profile_read_failed", JSON.stringify({ code: targetProfileError.code, message: safeMessage(targetProfileError.message) }));
    return NextResponse.json({ error: "Could not load the target profile. Check database migrations." }, { status: 503 });
  }
  if (!targetProfile) return NextResponse.json({ error: "User profile not found" }, { status: 404 });
  const { data: currentRoleRows, error: rolesError } = await auth.db.from("user_roles").select("role").eq("user_id", userId);
  if (rolesError) return NextResponse.json({ error: "Could not load target roles. Check the role-table migration." }, { status: 503 });
  const targetRoles = (currentRoleRows ?? []).map((row) => row.role as AppRole);

  if (input.action === "status") {
    if (!superAdmin && !hasAdminPermission(auth.actor, "users.manage_instructors")) return NextResponse.json({ error: "You do not have permission to manage account status." }, { status: 403 });
    if (userId === auth.actor.id && input.status !== "active") return NextResponse.json({ error: "You cannot suspend or deactivate your own active session account." }, { status: 409 });
    if (!superAdmin && targetRoles.some((role) => role === "admin" || role === "super_admin")) return NextResponse.json({ error: "Only a Super Admin can change another administrator's account." }, { status: 403 });
    if (input.status !== "active" && targetRoles.includes("super_admin")) {
      const { data: admins } = await auth.db.from("user_roles").select("user_id").eq("role", "super_admin");
      const ids = [...new Set((admins ?? []).map((row) => row.user_id))];
      const { data: activeProfiles } = ids.length ? await auth.db.from("profiles").select("id").in("id", ids).eq("status", "active") : { data: [] as { id: string }[] };
      if ((activeProfiles?.length ?? 0) <= 1) return NextResponse.json({ error: "The last active Super Admin cannot be suspended." }, { status: 409 });
    }
    const { error } = await auth.db.from("profiles").update({ status: input.status, updated_at: new Date().toISOString() }).eq("id", userId);
    if (error) return NextResponse.json({ error: "Could not update account status." }, { status: 500 });
    await writeAuditLog({ actorId: auth.actor.id, action: "admin.user.status_changed", targetType: "user", targetId: userId, metadata: { from: targetProfile.status, to: input.status } });
    return NextResponse.json({ success: true });
  }

  if (input.action === "instructor_approval") {
    if (!hasAdminPermission(auth.actor, "users.manage_instructors")) return NextResponse.json({ error: "You do not have permission to approve instructors." }, { status: 403 });
    if (!superAdmin && targetRoles.some((role) => role === "admin" || role === "super_admin")) return NextResponse.json({ error: "Only a Super Admin can manage instructor profiles belonging to administrators." }, { status: 403 });
    if (!targetRoles.includes("instructor")) return NextResponse.json({ error: "This user does not have the instructor role." }, { status: 409 });
    const { data, error } = await auth.db.from("instructor_profiles").update({ is_approved: input.approved }).eq("user_id", userId).select("user_id").maybeSingle();
    if (error || !data) return NextResponse.json({ error: "Instructor profile not found or could not be updated." }, { status: 404 });
    await writeAuditLog({ actorId: auth.actor.id, action: input.approved ? "admin.instructor.approved" : "admin.instructor.rejected", targetType: "user", targetId: userId });
    return NextResponse.json({ success: true });
  }

  // One account gets exactly one role. Role changes are exclusively Super Admin operations.
  if (!superAdmin) return NextResponse.json({ error: "Only a Super Admin can change platform roles." }, { status: 403 });
  if (userId === auth.actor.id && input.action === "set_role" && input.role !== "super_admin") return NextResponse.json({ error: "You cannot downgrade your own privileged role from this session." }, { status: 409 });
  if (targetRoles.includes("super_admin") && input.action === "set_role" && input.role !== "super_admin") {
    const { data: admins, error: adminReadError } = await auth.db.from("user_roles").select("user_id").eq("role", "super_admin");
    if (adminReadError) return NextResponse.json({ error: "Could not verify the Super Admin count." }, { status: 503 });
    const ids = [...new Set((admins ?? []).map((row) => row.user_id))];
    const { data: activeProfiles, error: activeReadError } = ids.length ? await auth.db.from("profiles").select("id").in("id", ids).eq("status", "active") : { data: [], error: null };
    if (activeReadError) return NextResponse.json({ error: "Could not verify active Super Admin accounts." }, { status: 503 });
    if ((activeProfiles?.length ?? 0) <= 1) return NextResponse.json({ error: "The last active Super Admin cannot be downgraded." }, { status: 409 });
  }
  if (input.action !== "set_role") return NextResponse.json({ error: "Unsupported operation." }, { status: 400 });

  const previousRole = targetRoles[0] ?? "student";
  const { error: roleError } = await auth.db.from("user_roles").upsert({ user_id: userId, role: input.role }, { onConflict: "user_id", ignoreDuplicates: false });
  if (roleError) {
    console.error("admin_role_change_failed", JSON.stringify({ code: roleError.code, message: safeMessage(roleError.message) }));
    return NextResponse.json({ error: "Could not set the account role. Apply migration 0014 and retry." }, { status: 500 });
  }

  if (previousRole === "instructor" && input.role !== "instructor") {
    const { error } = await auth.db.from("instructor_profiles").update({ is_approved: false }).eq("user_id", userId);
    if (error) return NextResponse.json({ error: "The role was changed, but instructor approval could not be disabled." }, { status: 500 });
  }
  if (input.role === "instructor") {
    const { data: approvalSetting } = await auth.db.from("platform_settings").select("value").eq("key", "instructors.require_approval").maybeSingle();
    const requireApproval = typeof approvalSetting?.value === "boolean" ? approvalSetting.value : true;
    const base = (targetProfile.display_name || "instructor").toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "instructor";
    const { error } = await auth.db.from("instructor_profiles").upsert({ user_id: userId, slug: `${base}-${userId.slice(0, 8)}`, is_approved: !requireApproval }, { onConflict: "user_id", ignoreDuplicates: true });
    if (error) return NextResponse.json({ error: "Role was changed, but instructor profile setup failed. Review the database." }, { status: 500 });
  }
  if (previousRole === "admin" && input.role !== "admin") {
    const { error } = await auth.db.from("user_permissions").delete().eq("user_id", userId);
    if (error) return NextResponse.json({ error: "The role was changed, but admin permissions could not be removed." }, { status: 500 });
  }
  if (input.role === "admin") {
    const baseline = ["users.manage_instructors", "courses.review", "categories.manage", "audit.read"];
    const { error } = await auth.db.from("user_permissions").upsert(baseline.map((permission_key) => ({ user_id: userId, permission_key, granted_by: auth.actor.id })), { onConflict: "user_id,permission_key", ignoreDuplicates: true });
    if (error) return NextResponse.json({ error: "Role was changed, but admin permission setup failed." }, { status: 500 });
  }
  await writeAuditLog({ actorId: auth.actor.id, action: "admin.role.changed", targetType: "user", targetId: userId, metadata: { from: previousRole, to: input.role } });
  return NextResponse.json({ success: true, previousRole, role: input.role });
}
