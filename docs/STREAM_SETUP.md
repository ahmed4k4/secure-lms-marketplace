# Legacy Cloudflare Stream setup (deprecated)

Cloudflare Stream is **not used by this release**. New video upload and playback use private Cloudflare R2 storage; course-cover images use a separate public R2 bucket. No Stream credentials are required.

Older installations may still contain `stream_uid` values and assets stored in Stream. Migration `0009_r2_video_delivery_and_course_covers.sql` does not delete legacy records or provider media. Existing lessons without `lessons.r2_object_key` must be re-uploaded from the instructor editor before review/publication. The `/api/stream/*` routes intentionally respond with HTTP 410 to avoid silently using the former provider workflow.

Follow [R2 setup](R2_SETUP.md) for the current bucket configuration and upload/playback test plan. Do not delete old Stream files until you have confirmed which courses still depend on them and intentionally decided whether to retain or remove them.
