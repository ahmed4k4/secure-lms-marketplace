# Windows clean-install recovery

Use this if `npm install` fails with `ETARGET`, peer dependency warnings, or a partially populated `node_modules` directory after changing branches/releases. Run PowerShell from the project root.

## 1. Keep your environment file

Do **not** delete `.env.local`; it contains the local service configuration. Confirm it is not committed to Git or shared in screenshots/logs.

## 2. Remove only generated dependency state

Stop `npm run dev`, then run:

```powershell
Remove-Item -Recurse -Force node_modules -ErrorAction SilentlyContinue
Remove-Item -Force package-lock.json -ErrorAction SilentlyContinue
npm cache verify
npm install
```

The dependency versions in `package.json` are pinned; this clean install allows npm to generate a fresh `package-lock.json` rather than reusing stale lock entries. After install and checks succeed, keep the newly generated lockfile in source control.

If npm reports an unavailable version, test that exact pin before changing anything:

```powershell
npm view @aws-sdk/client-s3@3.899.0 version
npm view @aws-sdk/s3-request-presigner@3.899.0 version
```

Do not use `--force` or `--legacy-peer-deps` as a routine fix for incompatible peer dependencies. React and React DOM are pinned to the same release in this version.

## 3. Verify in order

```powershell
npm run verify:static
npm run typecheck
npm run lint
npm test
npm run build
```

If installation succeeded but typecheck or build fails, keep the full first error and fix that source issue before trying to deploy. `verify:static` is not a substitute for these checks.

## 4. Verify Auth

```powershell
npm run auth:email-check
npm run auth:diagnose -- instructor@example.com
```

The diagnostics use `.env.local`. The second command requires `SUPABASE_SERVICE_ROLE_KEY`, is for a trusted local terminal only, and only reports the target Auth identity/profile/role state. Never expose the service-role key or use it in client-side code.

This archive was authored in an environment where npm registry access timed out, so a generated lockfile and complete dependency-backed build are not included as verified outputs. Generate and commit `package-lock.json` on a network-enabled workstation after a successful clean install and test run.
