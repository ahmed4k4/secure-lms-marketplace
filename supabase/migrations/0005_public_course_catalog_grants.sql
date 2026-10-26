-- Allow anonymous visitors to read only the fields required by the published-course catalog.
-- Row-level security remains enabled; the existing courses SELECT policy exposes published rows.
-- Column-level grants also include status and published_at because the catalog filters/orders on them.
begin;

grant usage on schema public to anon, authenticated;
grant select (id, slug, title_ar, title_en, summary_ar, summary_en, status, published_at)
  on table public.courses to anon, authenticated;

commit;
