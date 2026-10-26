# Archai Academy LMS — fixes v1.9.1

## Applied
- Added `avatar_url` to the authenticated profile query so the account page's profile-photo preview and URL field are correctly typed.
- Fixed the RLS integration-test fixture: the auth signup trigger correctly assigns a default `student` role, so the tests explicitly replace that default before assigning `super_admin` / `instructor`. The single-role database constraint remains intact.
- Replaced unsupported `primary` button variants on the finance console with the design system's supported `default` variant.
- Imported the shared `Input` component in the wallet refund form.
- Replaced the unsupported React `onEnterPictureInPicture` JSX prop with a native video event listener whose cleanup is tied to the playback effect. Renamed the dynamic HLS module variable to avoid the Next.js reserved `module` lint rule, and made the effect dependencies explicit.
- Corrected the publishing test fixture to use an existing approved category when testing submission to review; the production category approval rule is unchanged.
- Removed unused finance/media imports and unused catch/argument warnings.
- Synchronized `package.json` and `package-lock.json` to version `1.9.1`.

## Environment and validation
- This project requires Node.js `>=22.22.2` (also required by locked dependencies). Node `22.21.0` is below the supported engine; upgrade to Node `22.22.2` or newer before running `npm ci`. Do not bypass this by lowering the declared engine.
- Recommended clean validation on the supported Node version: `npm ci`, `npm run verify:static`, `npm run typecheck`, `npm run lint`, `npm test`, and `npm run build`.
- `npm run verify:static` passed in the packaging environment after these changes. Full typecheck/lint/tests/build could not be rerun here because the container uses Node `22.16.0` and `npm ci` timed out, leaving an incomplete dependency tree. Therefore this archive is not represented as fully build-verified.
- The reported PGlite/RLS publishing failure was addressed in its fixture by supplying an approved category, matching the transition rule. The test suite should be rerun locally to confirm. No live Supabase database was modified.
