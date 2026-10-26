# Changelog — 1.1.0

## Authentication lifecycle
- Added a dedicated first-time password setup screen for invited accounts.
- Updated instructor invitations to return to account setup instead of sending users directly to the dashboard.
- Hardened callback redirect validation to same-origin, selected-locale paths and separated recovery failures from invitation failures.
- Improved recovery-email error messages and included allowlist/SMTP guidance without exposing whether an email is registered.
- Added a service-role-only diagnostic script for Auth identity, confirmation state, profile, and instructor-role troubleshooting.

## Experience
- Rebuilt the responsive navbar with authenticated navigation, role-aware links, active states, language switching, and an accessible mobile menu.
- Refined auth page form and mobile navigation styles.

## Validation
- Added tests for safe auth callback destinations.
- Database state, Supabase SMTP, redirect allowlists, and real email delivery still require verification in the owner's Supabase project.
