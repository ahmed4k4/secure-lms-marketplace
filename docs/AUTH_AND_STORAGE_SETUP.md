# Authentication, OAuth, and email delivery setup

The application code cannot enable an OAuth provider, create Google/GitHub OAuth credentials, or configure Supabase SMTP on your behalf. These are project-level settings and must match the Supabase project used by `.env.local`.

## 1. App environment

Set the exact public origin used by the browser in `.env.local`:

```env
NEXT_PUBLIC_SITE_URL=http://localhost:3000
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=YOUR_PUBLIC_ANON_OR_PUBLISHABLE_KEY
```

For production, `NEXT_PUBLIC_SITE_URL` must be your deployed HTTPS origin (for example `https://learn.example.com`) with no trailing path. Restart the Next.js process after changing it. Ensure URL and public key belong to the same Supabase project. Never expose `SUPABASE_SERVICE_ROLE_KEY` or Cloudflare R2 secret keys to the browser.

## 2. Supabase URL allow-list

Open **Supabase Dashboard → Authentication → URL Configuration**.

For local development:

- Site URL: `http://localhost:3000`
- Redirect URLs: `http://localhost:3000/auth/callback`, `http://localhost:3000/reset-password`, `http://localhost:3000/dashboard`

Add the corresponding exact HTTPS URLs for the production domain. Do not add an unrestricted wildcard for arbitrary domains. The app sends confirmation, OAuth and password-reset callbacks through `/auth/callback`; after code exchange the app returns to the local `next` path. Query strings do not need separate allow-list entries.

## 3. Enable Google sign-in

1. Open **Supabase Dashboard → Authentication → Sign In / Providers → Google** and enable it.
2. In Google Cloud Console, create/configure an OAuth client of type **Web application**.
3. Add the Supabase callback URI shown on the Google provider setup page (normally `https://YOUR_PROJECT_REF.supabase.co/auth/v1/callback`) to Google's **Authorized redirect URIs**. Do not use the Next.js `/auth/callback` URL as Google's provider callback; that is the app's callback after Supabase.
4. Paste the Google Client ID and Client Secret into the Supabase Google provider settings and save.
5. Test on the exact local/production origin configured above.

## 4. Enable GitHub sign-in

1. Open **Supabase Dashboard → Authentication → Sign In / Providers → GitHub** and enable it.
2. In GitHub Developer Settings, create an OAuth App. Set **Authorization callback URL** to the Supabase callback URI shown by Supabase (normally `https://YOUR_PROJECT_REF.supabase.co/auth/v1/callback`).
3. Copy the GitHub Client ID and generate/copy the Client Secret into the Supabase GitHub provider settings. Save and test.

`Unsupported provider: provider is not enabled` is returned by Supabase before the user is redirected when the selected provider is disabled or not configured. The app now shows a provider-specific explanation instead of a generic expired-link message; enabling the provider in Supabase is still required.

## 5. Email confirmation and password reset

Open **Authentication → Email Templates**. Keep the Supabase confirmation URL (`{{ .ConfirmationURL }}`) unless a custom token-hash template has been deliberately implemented and tested. The app callback supports Supabase PKCE `code` and token-hash OTP links.

For production, configure a verified sender/domain under **Authentication → SMTP Settings** using an SMTP provider. Check the SMTP host, port, username, password, sender address/name, provider logs, spam folder, sender-domain DNS (SPF/DKIM/DMARC as required), and Supabase email rate limits. Default/test email delivery may be restricted and is not a production mail service.

When email delivery fails:

1. Check the error code in the server terminal; the app logs only the provider code/status, not the email body or secrets.
2. Confirm the URL/key pair belongs to the correct Supabase project.
3. Confirm `NEXT_PUBLIC_SITE_URL` is exact and `/auth/callback` is allow-listed.
4. Verify SMTP and sender settings, then check provider delivery logs and quotas.
5. Request a fresh link and use the newest message only.

## 6. Instructor invitations and roles

Instructor accounts must be created through the authorized admin flow. An invitation identity must exist in `auth.users` and have the corresponding profile/role. Never insert a fake `auth.users` row or trust a role supplied by the client. If an invited instructor needs to set a password, use the invitation/setup flow or request a password-reset email. Do not disable email confirmation merely to bypass a delivery problem.

## 7. Security reminders

- Never send service-role or R2 secret keys to the browser or commit them to Git.
- Do not allow arbitrary redirect origins.
- OAuth callback URLs configured at Google/GitHub must point to Supabase's `/auth/v1/callback`; Supabase Redirect URLs must allow the app's `/auth/callback`.
- Rotate any service-role or R2 secret that has been pasted into chat, logs, screenshots, or a public issue.
