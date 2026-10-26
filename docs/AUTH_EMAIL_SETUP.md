# Authentication and email setup

This checklist covers local development plus invitation, sign-in, and password recovery. The application cannot override Supabase Auth users, SMTP delivery, confirmation state, or redirect allowlists from the browser.

## 1. Configure the app origin

In `.env.local`, set `NEXT_PUBLIC_APP_URL` to the exact origin used in the browser, for example:

```env
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=YOUR_PUBLIC_ANON_OR_PUBLISHABLE_KEY
SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVER_ONLY_SERVICE_ROLE_KEY
```

Do not paste service-role or R2 secret keys into client-side variables. Restart `npm run dev` after changing environment values. Confirm that the URL and public key belong to the same Supabase project as the existing instructor identity.

## 2. Supabase URL Configuration

Open **Supabase Dashboard → Authentication → URL Configuration**.

- For local development, set **Site URL** to `http://localhost:3000`.
- Add each URL below to **Redirect URLs** (or add a narrow project-specific wildcard such as `http://localhost:3000/**` if appropriate):
  - `http://localhost:3000/ar/auth/callback`
  - `http://localhost:3000/en/auth/callback`
  - `http://localhost:3000/ar/reset-password`
  - `http://localhost:3000/en/reset-password`
  - `http://localhost:3000/ar/setup-account`
  - `http://localhost:3000/en/setup-account`
- Add the equivalent exact HTTPS URLs for the production domain. Do not allow arbitrary origins.

The reset request intentionally sends users through `/{locale}/auth/callback` and then to `/{locale}/reset-password`, so the callback URL must be allowed. Supabase may reject or rewrite links if the redirect is not in the allowlist.

Run `npm run auth:email-check` to print the app-specific URLs your current environment requires. The command does not modify Supabase.

## 3. Email templates and SMTP

Open **Authentication → Email Templates** and keep the Supabase-generated confirmation URL (`{{ .ConfirmationURL }}`) unless you have deliberately built and tested a custom token-hash confirmation template. The application callback supports the Supabase PKCE `code` and token-hash OTP patterns.

For production, configure a verified sender/domain using a supported SMTP provider in **Authentication → SMTP Settings**. Check provider logs, spam/junk folders, sender-domain DNS (SPF/DKIM/DMARC where required), Supabase Auth rate limits, and the provider's send quotas. Default/test email delivery is restricted and should not be treated as production email service.

If Supabase reports that an email was sent but the link fails:

1. Use the newest email; older links can expire or be invalidated.
2. Open it on the same site origin where the request was made (localhost links only work on that machine's local development server).
3. Verify the final browser URL stays on your intended domain and ends at `/ar/reset-password` or `/en/reset-password`.
4. Confirm the allowlist and email template above.

## 4. Instructor invitation lifecycle

Instructor accounts created through the admin invitation flow receive a Supabase Auth identity and an instructor role from server-side code. The invitation link returns to `/ar/setup-account` so the invited person can set an initial password. The setup page requires a valid Supabase session and never assigns or upgrades a role.

If an account was invited by an earlier app version and landed directly on the dashboard without setting a password, use **Forgot password** to set one. If the email is not confirmed, finish the latest invitation/confirmation link first. An identity in `public.profiles` without a matching `auth.users` identity cannot sign in; never fix that by inserting a fake row into `auth.users` or trusting a role sent by the client.

## 5. Diagnose the existing account

Use the server-only service-role key from `.env.local` and run:

```powershell
npm run auth:diagnose -- instructor@example.com
```

The script reports whether the email exists in this Supabase Auth project, whether it is confirmed, and whether its LMS profile/instructor role exists. It never prints the service-role key or password. If an Auth identity exists and is confirmed but password sign-in still returns `invalid_credentials`, use the password reset flow, and verify the URL/key pair belongs to the same project.

## 6. Security checklist

- Never send the Supabase service-role key or Cloudflare R2 secret to the browser.
- Do not disable email verification just to hide an authentication error.
- Do not create public instructor self-assignment; role changes must remain behind admin authorization.
- Rotate any service-role or R2 secret that was pasted into chat, logs, screenshots, or a public issue.
