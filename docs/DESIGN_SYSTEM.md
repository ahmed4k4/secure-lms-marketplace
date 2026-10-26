# LearnSpace Design System 2.0

This UI update uses the attached `Archai Design System v2.0` as its visual reference while keeping LearnSpace's own marketplace product name.

## Palette

| Token | Value | Use |
|---|---|---|
| Carbon / background | `#1B2228` | Main page background |
| Panel | `#222B33` | Cards, navigation, footer CTA |
| Steel | `#2D3841` | Secondary surfaces |
| Borders | `#3A4753` | Separators and component edges |
| Silver | `#CCD3DA` | Important secondary text |
| Mist | `#98A5B1` | Body copy and metadata |
| Arc Blue | `#2ED2FF` | Primary CTA, active states, interaction signal |
| Arc Ink | `#07739B` | Dark-surface borders and darker blue details |
| Copper | `#C48A5C` | Secondary/physical cue, used sparingly |
| Success | `#3DDC97` | Successful states |
| Warning | `#E9A24F` | Pending states |
| Error | `#FF6B7A` | Error states |

Dark mode is the default. A bright Arc Blue is not used as text on a light background; primary buttons use Carbon text on Arc Blue. Copper is a secondary accent, not a competing primary CTA.

## Typography

- **Readex Pro**: Arabic headings.
- **IBM Plex Sans Arabic**: Arabic UI and body copy.
- **Sora**: Latin headings and brand wordmark text.
- **JetBrains Mono**: technical labels, section indices, and metadata.

Google Fonts are referenced from the browser with preconnect hints so Next.js does not need to fetch them at build time. System fallbacks are defined; a locally hosted font package can be added if offline operation or strict CSP is required.

## Layout and behavior

- Spacing follows a 4px base rhythm; common values are 8, 12, 16, 24, 32, 48, and 64px.
- Component radii use 8px / 12px / 20px tiers.
- Motion uses restrained 120ms / 240ms / 480ms tiers and respects `prefers-reduced-motion`.
- Use flat Carbon/Panel/Steel surfaces. The circuit motif is a subtle line treatment, not a multi-color gradient background.
- One clear Arc Blue primary action per component region. Copper is a secondary accent.
- Keep focus indicators visible, controls touch-sized, text readable, and navigation mobile-safe.
- Private account/admin/instructor and lesson routes are marked `noindex,nofollow`; this supplements server authorization and is not itself an access-control mechanism.

## Product patterns from research

The information architecture takes cues from public course discovery flows:

- **Coursera**: global search, category browsing, popular learning products, and refinement by topic/level/language/product.
- **edX**: browsing by subject and goal, then drilling into level and learning focus.
- **Udemy**: category shortcuts, popular searches, result filtering/sorting, and previews.
- **Skillshare**: searchable classes, topic hierarchies, and learning paths.

References:
- https://www.coursera.org/browse/
- https://www.coursera.org/courses
- https://www.edx.org/learn
- https://support.udemy.com/hc/en-us/articles/10052796362903-Searching-for-courses-on-the-mobile-app
- https://www.skillshare.com/en/browse
- https://help.skillshare.com/hc/en-us/articles/204536908-How-do-I-find-a-class-to-take

This is an independent design system inspired by general interaction patterns, not a reproduction of competitor branding or assets.
