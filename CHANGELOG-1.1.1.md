# v1.1.1 — Upload and workflow reliability

- Course covers now upload through a same-origin Next.js route, eliminating browser-to-R2 CORS preflight for covers. Cover files are limited to 4 MB and validated by MIME type plus magic bytes before server-side storage.
- Instructors can fill in a proposed category as part of the course form and continue preparing lessons/pricing. Courses are linked to pending category requests and cannot be published until approval.
- Admin category queue now supports approving/rejecting requests; approval attaches the new category to all linked courses.
- Added `0013_course_category_holds.sql` and `0014_single_role_per_user.sql` migrations. Old duplicate roles are resolved by priority; future role changes replace rather than accumulate roles.
- Admin user management now provides a single-role control, with special handling to avoid removing the final active Super Admin.
- Refined mobile navigation and added a multi-column footer based on current course marketplace patterns: prominent discovery, role-relevant entry points, topical exploration, and trust-oriented messaging.

Reference patterns researched on 2026-10-21: Coursera emphasizes search and topic discovery; Udemy emphasizes browse/search, popular topics, and learning/career goals; edX emphasizes exploration by subject and learning type. These are design references, not copied assets. See the official sites: https://www.coursera.org/ · https://www.udemy.com/ · https://www.edx.org/.

Validation limitation: no live Cloudflare or Supabase credentials are used during archive preparation. Apply migrations and run provider-bound integration checks in a staging project before production.


### Follow-up reliability fixes

- Cover uploads use the same-origin API; public cover URLs reject the R2 S3 API hostname, since it cannot be used as a public asset domain. Configure an actual R2 public custom domain or activated `r2.dev` URL for covers.
- Course creation now navigates directly into the new course editor so instructors can immediately continue curriculum, video, and pricing setup.
- A rejected category request keeps linked courses unpublished. The admin queue continues to show rejected requests and can approve them later; approval links the category and releases publication holds.
- Pending category proposals are deduplicated by slug, and existing rejected requests can be reopened when the same proposal is submitted again.
