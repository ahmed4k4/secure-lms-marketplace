-- Allow a course held for a proposed category to proceed when the instructor selects an already-approved category.
-- Still prevent review submission without an approved category and do not allow a pending proposal to bypass approval.
begin;
create or replace function public.enforce_course_status() returns trigger
language plpgsql set search_path = public as $$
declare
  v_request_status text;
  v_request_category uuid;
begin
  if auth.uid() is null then return new; end if;
  if public.has_permission('courses.review') then
    if new.status = 'published' and old.status <> 'published' then
      new.published_at := coalesce(old.published_at, now());
    end if;
    return new;
  end if;

  new.created_by := old.created_by;
  new.rejection_reason := old.rejection_reason;
  new.published_at := old.published_at;

  if new.status <> old.status then
    if new.status = 'category_pending' and new.category_request_id is not null
       and exists (select 1 from public.category_requests r where r.id = new.category_request_id and r.status = 'pending') then
      return new;
    end if;

    if old.status = 'category_pending' and new.status = 'in_review' then
      -- Selecting a real category clears the pending request and is safe to submit immediately.
      if new.category_request_id is null and new.category_id is not null then return new; end if;
      select r.status, r.category_id into v_request_status, v_request_category
      from public.category_requests r where r.id = old.category_request_id;
      if v_request_status = 'approved' and v_request_category = new.category_id and new.category_request_id is null then return new; end if;
    end if;

    if old.status = 'category_pending' and new.status = 'draft' then
      select r.status into v_request_status from public.category_requests r where r.id = old.category_request_id;
      if v_request_status = 'rejected' then return new; end if;
    end if;

    if old.status in ('draft','rejected') and new.status = 'in_review'
       and new.category_id is not null and new.category_request_id is null then
      return new;
    end if;
    if old.status = 'in_review' and new.status = 'draft' then return new; end if;
    raise exception 'invalid_status_transition' using errcode = '42501';
  end if;
  return new;
end $$;
commit;
