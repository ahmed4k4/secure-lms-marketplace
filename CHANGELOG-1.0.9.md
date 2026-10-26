# Secure LMS Marketplace 1.0.9

- Corrected the AWS SDK pin from a non-existent `3.900.0` release to published `3.899.0` for both S3 client and presigner.
- Aligned React/React DOM and React type packages to remove mixed peer-version warnings observed during installation.
- Fixed ESLint flat-config imports to use the `.js` entry points exported by `eslint-config-next`.
- Fixed TypeScript errors involving Supabase `PostgrestError.status`, course metadata returned for lesson navigation, lesson duration fields, and a nullable video ref.
- Added instructor category proposals with admin approval/rejection API and migration `0012_category_requests.sql`.
- Documented the R2 CORS policy and the requirement to use a real public custom domain for course-cover delivery rather than the S3 API endpoint.
- Documented secure Super Admin bootstrap and credential rotation.

Verification: `npm run verify:static` passed. Full npm installation timed out in the build environment; typecheck, lint, full tests and production build were therefore not re-run here. Apply migration 0012 and configure R2 CORS/public domain before using the new category proposal and cover upload workflows.
