import { NextResponse } from "next/server";
import { z } from "zod";
import { authorizeAdminApi, hasAdminPermission } from "@/lib/server/admin-authorization";
import { isSameOriginMutation } from "@/lib/server/request-security";
import { writeAuditLog } from "@/lib/server/audit";
import { localRateLimit } from "@/lib/server/rate-limit";

const inviteSchema = z.object({
  email: z.string().trim().email().max(254),
  displayName: z.string().trim().min(2).max(100),
  role: z.enum(["student", "instructor", "admin"]),
});
function safeMessage(value: unknown): string {
  if (typeof value !== "string") return "unknown";
  return value.replace(/(?:sb_secret_|eyJ)[A-Za-z0-9_.-]+/g, "[REDACTED]").slice(0, 250);
}

/** Invite a new platform user. Auth identity and role assignment are created server-side. */
export async function POST(request: Request) {
  if (!isSameOriginMutation(request)) return NextResponse.json({ error: "Cross-origin request denied" }, { status: 403 });
  const auth = await authorizeAdminApi();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }); }
  const parsed = inviteSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Enter a valid email, display name, and supported role." }, { status: 400 });
  if (!hasAdminPermission(auth.actor, "users.manage_instructors")) return NextResponse.json({ error: "You do not have permission to manage users." }, { status: 403 });
  if (parsed.data.role === "admin" && !auth.actor.roles.includes("super_admin")) {
    return NextResponse.json({ error: "Only a Super Admin can invite another administrator." }, { status: 403 });
  }
  const rate = localRateLimit(`admin-invite:${auth.actor.id}`, 8, 60_000);
  if (!rate.allowed) return NextResponse.json({ error: "Too many invitations. Try again shortly." }, { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } });

  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (!appUrl) return NextResponse.json({ error: "NEXT_PUBLIC_APP_URL must be configured before sending invitations." }, { status: 503 });
  try { new URL(appUrl); } catch { return NextResponse.json({ error: "NEXT_PUBLIC_APP_URL is invalid." }, { status: 503 }); }

  const email = parsed.data.email.toLowerCase();
  const { data: invite, error: inviteError } = await auth.db.auth.admin.inviteUserByEmail(email, {
    data: { display_name: parsed.data.displayName },
    redirectTo: `${appUrl.replace(/\/$/, "")}/ar/auth/callback?flow=invite&next=${encodeURIComponent("/ar/setup-account?flow=invite")}`,
  });
  if (inviteError || !invite.user) {
    const message = safeMessage(inviteError?.message);
    const duplicate = /already|registered|exists/i.test(message);
    console.error("admin_user_invite_failed", JSON.stringify({ code: inviteError?.code ?? "unknown", message }));
    return NextResponse.json({ error: duplicate ? "An Auth account with this email already exists. Find it in the users list and manage its roles instead." : "Supabase could not send the invitation. Check Auth email/SMTP configuration and server logs." }, { status: duplicate ? 409 : 502 });
  }

  const userId = invite.user.id;
  const { error: profileError } = await auth.db.from("profiles").upsert({ id: userId, display_name: parsed.data.displayName }, { onConflict: "id" });
  if (profileError) {
    await auth.db.auth.admin.deleteUser(userId);
    console.error("admin_user_profile_provision_failed", JSON.stringify({ code: profileError.code, message: safeMessage(profileError.message) }));
    return NextResponse.json({ error: "The invitation could not be provisioned in the profile table. The incomplete Auth account was rolled back; review database migrations." }, { status: 500 });
  }

  const { error: roleError } = await auth.db.from("user_roles").upsert({ user_id: userId, role: parsed.data.role }, { onConflict: "user_id", ignoreDuplicates: false });
  if (roleError) {
    await auth.db.auth.admin.deleteUser(userId);
    console.error("admin_user_role_provision_failed", JSON.stringify({ code: roleError.code, message: safeMessage(roleError.message) }));
    return NextResponse.json({ error: "The role could not be assigned. The incomplete Auth account was rolled back; review database migrations." }, { status: 500 });
  }

  if (parsed.data.role === "instructor") {
    const { data: approvalSetting } = await auth.db.from("platform_settings").select("value").eq("key", "instructors.require_approval").maybeSingle();
    const requireApproval = typeof approvalSetting?.value === "boolean" ? approvalSetting.value : true;
    const base = email.split("@")[0].toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "instructor";
    const { error: instructorError } = await auth.db.from("instructor_profiles").upsert({ user_id: userId, slug: `${base}-${userId.slice(0, 8)}`, is_approved: !requireApproval }, { onConflict: "user_id", ignoreDuplicates: true });
    if (instructorError) {
      await auth.db.auth.admin.deleteUser(userId);
      console.error("admin_instructor_profile_provision_failed", JSON.stringify({ code: instructorError.code, message: safeMessage(instructorError.message) }));
      return NextResponse.json({ error: "The instructor profile could not be created. The incomplete Auth account was rolled back." }, { status: 500 });
    }
  }

  // New admins receive a conservative baseline; the Super Admin can refine this per user.
  if (parsed.data.role === "admin") {
    const baseline = ["users.manage_instructors", "courses.review", "categories.manage", "audit.read"];
    const { error: permissionsError } = await auth.db.from("user_permissions").upsert(baseline.map((permission_key) => ({ user_id: userId, permission_key, granted_by: auth.actor.id })), { onConflict: "user_id,permission_key", ignoreDuplicates: true });
    if (permissionsError) {
      await auth.db.auth.admin.deleteUser(userId);
      console.error("admin_user_permission_provision_failed", JSON.stringify({ code: permissionsError.code, message: safeMessage(permissionsError.message) }));
      return NextResponse.json({ error: "Default administrator permissions could not be provisioned. The incomplete Auth account was rolled back." }, { status: 500 });
    }
  }
  await writeAuditLog({ actorId: auth.actor.id, action: "admin.user.invited", targetType: "user", targetId: userId, metadata: { email, assignedRole: parsed.data.role } });
  return NextResponse.json({ success: true, user: { id: userId, email, display_name: parsed.data.displayName, status: "active", roles: [parsed.data.role], invitationSent: true } }, { status: 201 });
}
