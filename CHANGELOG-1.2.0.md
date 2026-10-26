# v1.2.0 — LearnSpace Design System 2.0 and marketplace UX

## Design system
- Rebuilt the visual layer around the supplied Archai Design System: Carbon `#1B2228`, Panel `#222B33`, Steel `#2D3841`, Silver `#CCD3DA`, Mist `#98A5B1`, Arc Blue `#2ED2FF`, and Copper `#C48A5C`.
- Applied the requested Google Fonts system: Readex Pro for Arabic display headings, IBM Plex Sans Arabic for Arabic UI/body, Sora for Latin display text, and JetBrains Mono for technical labels.
- Reworked the landing hero with restrained circuit-line motifs, a learning-workspace visual, clearer search and topic discovery, and a more explicit course discovery path.
- Reworked course/category cards, CTAs, status chips, pricing surfaces, course details, lesson/player framing, dashboard/admin controls, inputs, notices, and empty states for contrast on the dark system.
- Added a same-system multi-column footer with a course discovery CTA and functional account/instructor links.
- Added a skip-to-content link, better focus styles, motion-reduction support, mobile menu behavior, and a compact desktop navbar search that sends users to the live course catalog query route.
- Marked account, lesson, instructor, reset/recovery, and admin routes `noindex,nofollow`; public pages remain eligible for indexing.

## Discovery research
- Coursera course browsing combines a global course search, subject discovery, popular programs, and refinement by topic, level, language, learning product, and educator: https://www.coursera.org/browse/ and https://www.coursera.org/courses.
- edX centers subject-based discovery, learner goals, course levels, and a broad course catalog: https://www.edx.org/learn.
- Udemy's mobile browse/search flow includes categories, top searches, filters, sort, and previews: https://support.udemy.com/hc/en-us/articles/10052796362903-Searching-for-courses-on-the-mobile-app.
- Skillshare combines topical browsing, searchable classes, levels, languages, and learning paths: https://www.skillshare.com/en/browse and https://help.skillshare.com/hc/en-us/articles/204536908-How-do-I-find-a-class-to-take.
- Those information-architecture patterns informed the product design. No competitor logos, copy, or proprietary assets were copied.

## Validation note
- `npm run verify:static` checks source syntax and required architecture markers. `npm install` could not complete in the archive-preparation environment because the package registry request timed out, so the full typecheck, lint, Vitest, Playwright, production build, database migration execution, and live Supabase/R2 workflows must be confirmed from a connected development/staging environment before production.
