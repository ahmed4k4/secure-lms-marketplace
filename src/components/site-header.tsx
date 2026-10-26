import { getAuthenticatedUser, getUserRoles } from "@/lib/server/auth";
import { SiteHeaderClient } from "@/components/site-header-client";

export async function SiteHeader({ locale }: { locale: string }) {
  let user: { id: string; email?: string } | null = null;
  let roles: string[] = [];
  try {
    const authUser = await getAuthenticatedUser();
    if (authUser) {
      user = { id: authUser.id, email: authUser.email };
      roles = await getUserRoles(authUser.id);
    }
  } catch {
    // Public navigation remains available if auth configuration is temporarily unavailable.
  }
  return <SiteHeaderClient locale={locale} email={user?.email ?? null} roles={roles} />;
}
