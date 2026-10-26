# Cloudflare R2 setup (private videos/resources + public covers)

This version uses Cloudflare R2 for all new lesson videos and private lesson attachments. A separate bucket is used for public course-cover images. **Never expose the private bucket or set a public domain on it.** R2 object storage is not a video transcoding/DRM service; accepted formats are MP4, WebM, and QuickTime/MOV.

## 1. Create buckets and credentials

1. In Cloudflare Dashboard → R2 Object Storage, create `lms-private-media` with public access disabled.
2. Create `lms-public-covers` for course thumbnail images. Configure its own HTTPS custom domain, or an equivalent HTTPS public base URL. Do not configure that domain on the private bucket.
3. Create an R2 API token with only the Object Read & Write permissions required for these two buckets. If possible, create separate tokens and extend the server helper to use separate credentials per bucket. Never put R2 credentials in a `NEXT_PUBLIC_*` variable.
4. Configure exact-origin CORS on the private media bucket for direct browser video/resource PUTs and playback reads using `r2-cors.json` as a starting point. Replace the example production origin with the actual application origin; do not use `*`. Normal course-cover uploads use the same-origin Next.js route and do not require cover-bucket CORS.
5. Ensure the cover domain serves image objects as images and is distinct from the authenticated app origin. Keep Supabase service keys and R2 secrets server-only.

## 2. Configure `.env.local`

```dotenv
CLOUDFLARE_R2_ACCOUNT_ID=your_account_id
CLOUDFLARE_R2_BUCKET=lms-private-media
CLOUDFLARE_R2_ACCESS_KEY_ID=server_only_key
CLOUDFLARE_R2_SECRET_ACCESS_KEY=server_only_secret

CLOUDFLARE_R2_COVERS_BUCKET=lms-public-covers
CLOUDFLARE_R2_COVERS_PUBLIC_BASE_URL=https://covers.your-domain.example

R2_MAX_VIDEO_SIZE_BYTES=1073741824
R2_MAX_RESOURCE_SIZE_BYTES=26214400
R2_MAX_COVER_SIZE_BYTES=4194304
R2_UPLOAD_URL_TTL_SECONDS=600
R2_DOWNLOAD_URL_TTL_SECONDS=300
R2_VIDEO_URL_TTL_SECONDS=21600
```

`CLOUDFLARE_R2_COVERS_PUBLIC_BASE_URL` must be the HTTPS public custom domain (or configured `r2.dev` public URL) for the *covers bucket only*. Never use `https://<account-id>.r2.cloudflarestorage.com/` here; that is the S3 API endpoint, not public image delivery. `R2_VIDEO_URL_TTL_SECONDS` is a tradeoff: shorter lifetimes reduce link-sharing windows but can interrupt long playback if the browser needs to seek or reload. The default is six hours; consider reducing it after testing the course player with real networks and lesson lengths.

## 3. Apply migration and test upload

Apply migrations `0001`–`0015` in numeric order to a backed-up development/staging database. For an existing installation that already applied `0001`–`0012`, apply `0013_course_category_holds.sql`, `0014_single_role_per_user.sql`, then `0015_single_role_signup_trigger_fix.sql`. If `0013` and `0014` are already recorded, still apply `0015` once. Do not reset the database to install this update.

- In the instructor workspace, create a draft course and a section. Pending instructor approval should not block preparing drafts.
- Select a JPG/PNG/WebP cover image up to 4 MB and upload it through the same-origin Next.js server route; covers no longer require browser-to-R2 CORS or a presigned PUT. Confirm it appears through the public covers domain and that its URL does not contain private bucket credentials.
- Upload an MP4/WebM/MOV lesson. Confirm the browser PUT targets the private bucket via a short-lived signed URL, and the app stores an R2 object key—not a public media URL.
- Verify an unrelated user cannot get a playback URL for an unpublished lesson or a paid lesson they cannot access. Try direct API requests, not just the UI.
- Confirm the private bucket cannot be read anonymously, the playback API responds with `Cache-Control: no-store`, and an expired signed URL stops working.
- Test a file larger than the configured limit and a disallowed MIME type; both should be rejected.

## 4. CORS template

`r2-cors.json` is a template for direct private video/resource uploads and playback reads, not a deployable file until its example origins are replaced. Course-cover uploads pass through the same-origin Next.js route and do not depend on cover-bucket browser CORS. Allow `PUT` for direct video/resource uploads and `GET`/`HEAD`/`Range` reads from exact web origins as required by the player. Cloudflare may expose range-related headers differently depending on configuration; validate playback seek behavior in each supported browser.

## 5. Cleanup

The orphan cleanup command performs a dry run by default:

```bash
npm run cleanup:r2-orphans
npm run cleanup:r2-orphans -- --apply
```

Review the dry-run results and verify the configured account/bucket before applying deletions. Do not use destructive cleanup against production until it has been tested in staging. Old legacy Stream assets are not deleted by this command.


## Upload limitations

The current browser upload uses one signed S3-compatible `PUT` request. It reports upload progress, but interrupted uploads must be restarted; multipart/resumable uploads are not implemented yet. Cloudflare recommends multipart uploads for larger video objects and better recovery from network interruptions. Until multipart support is added, test very large videos on the actual target network before production launch.


## Category approval holds and exclusive roles

Migration `0013_course_category_holds.sql` links a proposed category request to one or more courses. Instructors can finish lessons and pricing and submit the course for review, but the database guard blocks publication while the linked category is pending. Approval adds the category and attaches it to all linked courses. Migration `0014_single_role_per_user.sql` resolves old multi-role accounts by keeping the strongest role (Super Admin, Admin, Instructor, Student) and changes `user_roles` to one row per user. Apply all three migrations before using the newer role-management API. Migration `0015_single_role_signup_trigger_fix.sql` updates the Supabase Auth signup trigger to use `ON CONFLICT (user_id)`, matching the new primary key. Without it, new account registration can fail because the original trigger targets the old `(user_id, role)` key.
