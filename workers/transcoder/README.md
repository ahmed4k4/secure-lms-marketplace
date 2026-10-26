# Private R2 HLS transcoder

This is a separate, long-running worker because Cloudflare R2 stores objects but does not transcode uploaded videos. It downloads the private source from `R2_BUCKET`, uses FFmpeg to produce HLS VOD renditions (up to 1080p, capped by the uploaded source resolution), uploads all variant playlists/segments to the same **private** bucket, then marks the lesson ready. The website only exposes a master manifest after processing has completed.

## Run with Docker

Build from the repository root so the package manifest is available:

```sh
docker build -f workers/transcoder/Dockerfile -t archai-lms-transcoder .
docker run --restart unless-stopped \
  -e NEXT_PUBLIC_SUPABASE_URL="$NEXT_PUBLIC_SUPABASE_URL" \
  -e SUPABASE_SERVICE_ROLE_KEY="$SUPABASE_SERVICE_ROLE_KEY" \
  -e R2_ACCOUNT_ID="$R2_ACCOUNT_ID" \
  -e R2_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" \
  -e R2_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY" \
  -e R2_BUCKET="$R2_BUCKET" \
  archai-lms-transcoder
```

The worker needs CPU/RAM and temporary disk capacity at least as large as the source file plus generated renditions. Run one worker with one job at a time initially (`TRANSCODER_MAX_JOBS=1`). A DB heartbeat is refreshed during FFmpeg processing so interrupted jobs can be recovered after a stale heartbeat. Multiple workers can safely claim jobs through `claim_video_transcode_job()` using `FOR UPDATE SKIP LOCKED`. Retries are capped at three attempts. Monitor container logs and rows in `video_transcode_jobs` for failed jobs.

## R2 CORS

Configure the **private media bucket** to allow browser `GET`, `HEAD`, and `PUT` from the deployed site's exact origin and expose the `ETag` response header. Signed segment redirects require CORS on the final R2 response; do not make the bucket public. Add an R2 lifecycle rule to abort incomplete multipart uploads after one day. The application API rechecks the account, lesson entitlement, playback session, and lesson availability before issuing each segment URL. Signed segment URLs expire after 75 seconds.

## Important protection limit

HLS is segmented delivery, not DRM. A determined learner can still capture screen output or save segments while authorized. The product adds a moving per-account watermark, temporary object URLs, access checks, concurrent-session limits, and audit events; none can reliably block OS-level screenshots, external cameras, or privileged recording software. For stronger content protection, integrate a commercial DRM license service.
