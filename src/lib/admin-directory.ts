import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';

type AdminClient = SupabaseClient<any, any, any>;
export type AdminDirectoryUser = {
  id: string;
  email: string;
  full_name: string;
  status: 'active' | 'suspended';
  created_at: string;
  roles: string[];
  instructor_status: 'pending' | 'active' | 'suspended' | null;
};

/**
 * Auth is the source of truth for accounts. Older accounts can exist in auth.users
 * without a profile/role row if they predate the signup trigger. Do not silently
 * omit those people from administration: repair only missing, least-privilege rows.
 */
export async function getAdminDirectory(admin: AdminClient): Promise<{ users: AdminDirectoryUser[]; error: string | null }> {
  const authUsers: Array<{ id: string; email?: string; created_at: string; user_metadata?: Record<string, unknown> }> = [];
  for (let page = 1; page <= 20; page++) {
    const result = await admin.auth.admin.listUsers({ page, perPage: 500 });
    if (result.error) return { users: [], error: `auth.users: ${result.error.message}` };
    authUsers.push(...result.data.users as typeof authUsers);
    if (result.data.users.length < 500) break;
  }
  if (!authUsers.length) return { users: [], error: null };

  const ids = authUsers.map((u) => u.id);
  const [profilesResult, rolesResult, instructorsResult, studentRoleResult] = await Promise.all([
    admin.from('profiles').select('id,full_name,status,created_at').in('id', ids),
    admin.from('user_roles').select('user_id,roles(key)').in('user_id', ids),
    admin.from('instructor_profiles').select('user_id,status').in('user_id', ids),
    admin.from('roles').select('id').eq('key', 'student').maybeSingle(),
  ]);
  if (profilesResult.error) return { users: [], error: `profiles: ${profilesResult.error.message}` };
  if (rolesResult.error) return { users: [], error: `user_roles: ${rolesResult.error.message}` };
  if (instructorsResult.error) return { users: [], error: `instructor_profiles: ${instructorsResult.error.message}` };

  const profiles = new Map((profilesResult.data ?? []).map((p: any) => [p.id, p]));
  const roleMap = new Map<string, string[]>();
  for (const row of (rolesResult.data ?? []) as any[]) {
    const role = Array.isArray(row.roles) ? row.roles[0]?.key : row.roles?.key;
    if (role) roleMap.set(row.user_id, [...(roleMap.get(row.user_id) ?? []), role]);
  }
  const instructorMap = new Map((instructorsResult.data ?? []).map((r: any) => [r.user_id, r.status]));

  const missingProfiles = authUsers.filter((u) => !profiles.has(u.id)).map((u) => ({
    id: u.id,
    full_name: String(u.user_metadata?.full_name ?? u.user_metadata?.name ?? '').slice(0, 120),
    locale: u.user_metadata?.locale === 'ar' ? 'ar' : 'en',
  }));
  if (missingProfiles.length) {
    const { error } = await admin.from('profiles').upsert(missingProfiles, { onConflict: 'id', ignoreDuplicates: true });
    if (error) return { users: [], error: `profile repair: ${error.message}` };
  }

  const missingRoles = authUsers.filter((u) => !(roleMap.get(u.id)?.length));
  if (missingRoles.length && studentRoleResult.data?.id) {
    const { error } = await admin.from('user_roles').upsert(
      missingRoles.map((u) => ({ user_id: u.id, role_id: studentRoleResult.data!.id })),
      { onConflict: 'user_id,role_id', ignoreDuplicates: true },
    );
    if (error) return { users: [], error: `role repair: ${error.message}` };
    for (const u of missingRoles) roleMap.set(u.id, ['student']);
  }

  // An account that already has the instructor role but no instructor profile is
  // kept pending until an administrator reviews it; it is never silently activated.
  const missingInstructorProfiles = authUsers.filter((u) => roleMap.get(u.id)?.includes('instructor') && !instructorMap.has(u.id));
  if (missingInstructorProfiles.length) {
    const { error } = await admin.from('instructor_profiles').upsert(
      missingInstructorProfiles.map((u) => ({ user_id: u.id, status: 'pending' })),
      { onConflict: 'user_id', ignoreDuplicates: true },
    );
    if (error) return { users: [], error: `instructor repair: ${error.message}` };
    for (const u of missingInstructorProfiles) instructorMap.set(u.id, 'pending');
  }

  const finalProfilesResult = missingProfiles.length
    ? await admin.from('profiles').select('id,full_name,status,created_at').in('id', ids)
    : profilesResult;
  const finalProfiles = new Map((finalProfilesResult.data ?? []).map((p: any) => [p.id, p]));
  const finalInstructorsResult = missingInstructorProfiles.length
    ? await admin.from('instructor_profiles').select('user_id,status').in('user_id', ids)
    : instructorsResult;
  const finalInstructors = new Map((finalInstructorsResult.data ?? []).map((r: any) => [r.user_id, r.status]));

  return {
    error: null,
    users: authUsers.map((u) => {
      const profile: any = finalProfiles.get(u.id);
      return {
        id: u.id,
        email: u.email ?? '',
        full_name: profile?.full_name || String(u.user_metadata?.full_name ?? u.user_metadata?.name ?? ''),
        status: profile?.status ?? 'active',
        created_at: profile?.created_at ?? u.created_at,
        roles: roleMap.get(u.id) ?? ['student'],
        instructor_status: (finalInstructors.get(u.id) as AdminDirectoryUser['instructor_status']) ?? null,
      };
    }),
  };
}
