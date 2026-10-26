-- Expose subscription price cadence in the public catalogue while preserving all existing view columns.
-- Product metadata only: no payment provider is enabled and no paid access is granted here.
begin;
create or replace view public.course_catalog as
  select c.id, c.slug, c.title, c.subtitle, c.language, c.level, c.access_type, c.status, c.published_at, c.updated_at,
         c.category_id, cat.slug as category_slug, cat.name_en as category_name_en, cat.name_ar as category_name_ar,
         c.created_by as owner_id, pi.full_name as owner_name,
         pp.amount_cents as price_cents, pp.currency,
         coalesce(r.avg_rating, 0) as rating_avg, coalesce(r.cnt, 0) as rating_count,
         coalesce(l.cnt, 0) as lesson_count, coalesce(l.total_seconds, 0) as total_duration_seconds,
         coalesce(e.cnt, 0) as student_count, c.cover_url as cover_url,
         pp.kind as price_kind, pp.billing_interval as billing_interval
  from public.courses c
  left join public.categories cat on cat.id = c.category_id
  left join public.public_instructors pi on pi.id = c.created_by
  left join lateral (
    select pl.amount_cents, pl.currency, pl.kind, pl.billing_interval
    from public.products pr join public.pricing_plans pl on pl.product_id = pr.id
    where pr.course_id = c.id and pr.type = 'course' and pr.active and pl.active and pl.kind in ('one_time','subscription')
    order by pl.created_at desc limit 1
  ) pp on true
  left join lateral (
    select round(avg(rating)::numeric, 2) as avg_rating, count(*) as cnt
    from public.reviews where course_id = c.id and not is_hidden
  ) r on true
  left join lateral (
    select count(*) as cnt, coalesce(sum(duration_seconds), 0)::int as total_seconds
    from public.lessons where course_id = c.id
  ) l on true
  left join lateral (select count(*) as cnt from public.enrollments where course_id = c.id) e on true
  where c.status = 'published';
grant select on public.course_catalog to anon, authenticated;
commit;
