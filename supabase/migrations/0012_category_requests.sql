-- Instructor-proposed categories. Requests remain private until an authorized admin approves them.
create table if not exists public.category_requests (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references auth.users(id) on delete cascade,
  name_en text not null check (char_length(trim(name_en)) between 2 and 120),
  name_ar text not null check (char_length(trim(name_ar)) between 2 and 120),
  slug text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  category_id uuid references public.categories(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (requester_id, slug, status)
);
create index if not exists category_requests_status_created_idx on public.category_requests(status, created_at desc);
create index if not exists category_requests_requester_idx on public.category_requests(requester_id, created_at desc);
alter table public.category_requests enable row level security;
revoke all on public.category_requests from anon, authenticated;
grant select, insert on public.category_requests to authenticated;
grant select, insert, update on public.category_requests to service_role;
drop policy if exists category_requests_read_own_or_admin on public.category_requests;
create policy category_requests_read_own_or_admin on public.category_requests for select to authenticated
using (requester_id = auth.uid() or public.is_admin());
drop policy if exists category_requests_insert_own on public.category_requests;
create policy category_requests_insert_own on public.category_requests for insert to authenticated
with check (requester_id = auth.uid() and status = 'pending' and reviewed_by is null and reviewed_at is null and category_id is null);
comment on table public.category_requests is 'Instructor-submitted category proposals awaiting admin review; proposals are not public categories until approved.';
