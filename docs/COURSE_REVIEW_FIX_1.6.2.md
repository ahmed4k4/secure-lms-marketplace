# Course review and publication workflow — v1.6.2

## What changed

- `reviewCourseAction` verifies `courses.review` through the authenticated Supabase session before obtaining the server-only service-role client.
- The review mutation uses that privileged client so approval does not fail because of user-scoped UPDATE grants or RLS policy drift.
- Before publish/restore, the action checks the course has an approved category, no linked pending category request, at least one lesson, and an active instructor profile.
- Course status and `published_at` are written together. Notification failures are logged separately and do not misreport a successful course status change.
- Revalidates the admin overview, admin course queue, public catalog, and instructor editor after decisions.

## Deploy

1. Deploy the updated application code and install dependencies using the Node version in `.nvmrc`.
2. Ensure migration `0015_service_role_privileges.sql` from v1.6.1 has been applied to the same Supabase project used by the deployment.
3. Test with a staging course first: create a draft, add at least one lesson, select an approved category, submit for review, then approve it from `/admin/courses?status=in_review`.
4. Verify the course status is `published` and that it appears in the public `/courses` catalog.
5. Test a course with a pending category request: it must remain blocked from publication until the category is approved.

## Security notes

- Do not expose the service-role key to browser code or `NEXT_PUBLIC_*` variables.
- The server action checks reviewer permission before every privileged mutation. Do not call the action from a public API without preserving that permission check.
- The application-level checks are not a replacement for RLS. Keep RLS enabled and review the SQL migrations against the deployed database.
- A full production build and live Supabase integration test must be run in the deployment environment; a static check alone cannot verify remote database grants or schema state.
