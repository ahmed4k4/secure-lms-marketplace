begin;

-- Remove redundant duplicate pending requests for the same slug, preserving the oldest, before adding a global pending-slug guard.
with ranked_pending as (
  select id, row_number() over (partition by slug order by created_at asc, id asc) as rn
  from public.category_requests
  where status = 'pending'
)
delete from public.category_requests r
using ranked_pending d
where r.id = d.id and d.rn > 1;
create unique index if not exists category_requests_one_pending_per_slug
  on public.category_requests(slug) where status = 'pending';

-- One approved category proposal may be associated with more than one course.
create table if not exists public.course_category_holds (
  course_id uuid primary key references public.courses(id) on delete cascade,
  category_request_id uuid not null references public.category_requests(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists course_category_holds_request_idx on public.course_category_holds(category_request_id);
alter table public.course_category_holds enable row level security;
revoke all on table public.course_category_holds from public, anon, authenticated;
grant all on table public.course_category_holds to service_role;

-- Defense in depth: courses linked to a non-approved category proposal cannot be published.
create or replace function public.prevent_course_publish_with_pending_category()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if new.status = 'published' and exists (
    select 1
    from public.course_category_holds h
    join public.category_requests r on r.id = h.category_request_id
    where h.course_id = new.id and r.status <> 'approved'
  ) then
    raise exception 'course_category_approval_pending' using errcode = '23514';
  end if;
  return new;
end;
$$;
drop trigger if exists courses_category_approval_guard on public.courses;
create trigger courses_category_approval_guard
before insert or update of status on public.courses
for each row execute procedure public.prevent_course_publish_with_pending_category();

comment on table public.course_category_holds is 'Courses that may be prepared and submitted for review but cannot be published until the proposed category is approved.';
commit;
