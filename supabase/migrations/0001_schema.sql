-- =====================================================================
-- 0001_schema.sql — core schema (tables, enums, indexes)
-- All timestamps are timestamptz (UTC). Monetary amounts are integer minor units.
-- Row Level Security is enabled in 0003_rls.sql.
-- =====================================================================

-- ---------- Enums ----------
create type public.course_status       as enum ('draft','in_review','category_pending','published','rejected','suspended','archived');
create type public.account_status      as enum ('active','suspended');
create type public.instructor_status   as enum ('pending','active','suspended');
create type public.course_access_type  as enum ('free','paid');
create type public.lesson_type         as enum ('video','text');
create type public.media_status        as enum ('pending_upload','ready','failed');
create type public.product_type        as enum ('course','bundle','instructor_membership','platform_membership');
create type public.plan_kind           as enum ('free','one_time','subscription');
create type public.billing_interval    as enum ('month','year');
create type public.order_status        as enum ('pending','paid','failed','canceled','refunded','partially_refunded');
create type public.subscription_status as enum ('active','past_due','canceled','expired');
create type public.entitlement_source  as enum ('free','purchase','subscription','membership','bundle','coupon','promo','admin_grant');
create type public.entitlement_status  as enum ('active','revoked','expired');
create type public.revoke_reason       as enum ('refund','chargeback','expired','canceled','admin','policy');
create type public.earning_status      as enum ('pending','available','paid','reversed');
create type public.refund_status       as enum ('pending','succeeded','failed');

-- ---------- Identity & authorization ----------
create table public.roles (
  id            uuid primary key default gen_random_uuid(),
  key           text not null unique,
  name          text not null,
  created_at    timestamptz not null default now()
);
comment on table public.roles is 'Role catalogue for the single-role-per-account authorization model.';

create table public.permissions (
  key         text primary key,
  description text not null
);

create table public.role_permissions (
  role_id        uuid not null references public.roles(id) on delete cascade,
  permission_key text not null references public.permissions(key) on delete cascade,
  primary key (role_id, permission_key)
);

create table public.profiles (
  id               uuid primary key references auth.users(id) on delete cascade,
  full_name        text not null default '',
  avatar_url       text,
  locale           text not null default 'en' check (locale in ('en','ar')),
  status           public.account_status not null default 'active',
  suspended_reason text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
comment on table public.profiles is 'One row per auth user. status is only writable by server-side admin code.';

create table public.user_roles (
  user_id    uuid not null references public.profiles(id) on delete cascade,
  role_id    uuid not null references public.roles(id) on delete cascade,
  granted_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (user_id, role_id)
);
create index user_roles_role_idx on public.user_roles(role_id);

create table public.instructor_profiles (
  user_id    uuid primary key references public.profiles(id) on delete cascade,
  headline   text check (char_length(headline) <= 160),
  bio        text check (char_length(bio) <= 4000),
  website    text check (website is null or website ~* '^https?://'),
  status     public.instructor_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------- Catalogue ----------
create table public.categories (
  id       uuid primary key default gen_random_uuid(),
  slug     text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name_en  text not null,
  name_ar  text not null,
  position int  not null default 0
);

create table public.courses (
  id               uuid primary key default gen_random_uuid(),
  slug             text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  title            text not null check (char_length(title) between 3 and 140),
  subtitle         text check (char_length(subtitle) <= 200),
  description      text not null default '' check (char_length(description) <= 20000),
  category_id      uuid references public.categories(id) on delete set null,
  language         text not null default 'en' check (language in ('en','ar')),
  level            text not null default 'all' check (level in ('beginner','intermediate','advanced','all')),
  access_type      public.course_access_type not null default 'free',
  status           public.course_status not null default 'draft',
  rejection_reason text,
  created_by       uuid not null references public.profiles(id) on delete restrict,
  published_at     timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index courses_status_pub_idx on public.courses(status, published_at desc);
create index courses_category_idx   on public.courses(category_id);
create index courses_created_by_idx on public.courses(created_by);

create table public.course_instructors (
  course_id     uuid not null references public.courses(id) on delete cascade,
  instructor_id uuid not null references public.profiles(id) on delete cascade,
  role          text not null default 'owner' check (role in ('owner','co_instructor')),
  primary key (course_id, instructor_id)
);
create index course_instructors_instructor_idx on public.course_instructors(instructor_id);

create table public.sections (
  id         uuid primary key default gen_random_uuid(),
  course_id  uuid not null references public.courses(id) on delete cascade,
  title      text not null check (char_length(title) between 1 and 140),
  position   int  not null default 0,
  created_at timestamptz not null default now()
);
create index sections_course_idx on public.sections(course_id, position);

create table public.lessons (
  id               uuid primary key default gen_random_uuid(),
  section_id       uuid not null references public.sections(id) on delete cascade,
  course_id        uuid not null references public.courses(id) on delete cascade, -- synced from section by trigger
  title            text not null check (char_length(title) between 1 and 140),
  description      text check (char_length(description) <= 2000),
  type             public.lesson_type not null default 'video',
  position         int  not null default 0,
  is_free_preview  boolean not null default false,
  duration_seconds int check (duration_seconds is null or duration_seconds between 0 and 86400),
  created_at       timestamptz not null default now()
);
create index lessons_section_idx on public.lessons(section_id, position);
create index lessons_course_idx  on public.lessons(course_id);

-- Text lesson body kept apart so it is only readable by people with access.
create table public.lesson_contents (
  lesson_id uuid primary key references public.lessons(id) on delete cascade,
  body      text not null default '' check (char_length(body) <= 100000)
);

-- Private video metadata. Never readable by students; object keys never leave the server.
create table public.lesson_videos (
  lesson_id        uuid primary key references public.lessons(id) on delete cascade,
  object_key       text not null unique,
  content_type     text not null,
  size_bytes       bigint not null check (size_bytes > 0),
  duration_seconds int,
  status           public.media_status not null default 'pending_upload',
  uploaded_by      uuid references public.profiles(id) on delete set null,
  created_at       timestamptz not null default now(),
  verified_at      timestamptz
);
create index lesson_videos_uploader_idx on public.lesson_videos(uploaded_by);
create index lesson_videos_pending_idx  on public.lesson_videos(created_at) where status = 'pending_upload';

create table public.lesson_resources (
  id           uuid primary key default gen_random_uuid(),
  lesson_id    uuid not null references public.lessons(id) on delete cascade,
  course_id    uuid not null references public.courses(id) on delete cascade,
  title        text not null check (char_length(title) between 1 and 200),
  object_key   text not null unique,
  content_type text not null,
  size_bytes   bigint not null check (size_bytes > 0),
  status       public.media_status not null default 'pending_upload',
  uploaded_by  uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now()
);
create index lesson_resources_lesson_idx on public.lesson_resources(lesson_id);

-- ---------- Monetisation (payment-ready, no payments in phase 1) ----------
create table public.products (
  id            uuid primary key default gen_random_uuid(),
  type          public.product_type not null,
  course_id     uuid references public.courses(id) on delete cascade,
  instructor_id uuid references public.profiles(id) on delete cascade,
  title         text not null,
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  check ((type = 'course') = (course_id is not null))
);
create unique index products_one_per_course on public.products(course_id) where type = 'course';

create table public.pricing_plans (
  id               uuid primary key default gen_random_uuid(),
  product_id       uuid not null references public.products(id) on delete cascade,
  kind             public.plan_kind not null,
  billing_interval public.billing_interval,
  amount_cents     int not null check (amount_cents >= 0),
  currency         text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  access_days      int check (access_days is null or access_days > 0), -- null = lifetime
  active           boolean not null default true,
  created_at       timestamptz not null default now(),
  check ((kind = 'subscription') = (billing_interval is not null)),
  check (kind = 'free' or amount_cents > 0)
);
create index pricing_plans_product_idx on public.pricing_plans(product_id) where active;

create table public.plan_items (
  plan_id   uuid not null references public.pricing_plans(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete cascade,
  primary key (plan_id, course_id)
);

create table public.orders (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references public.profiles(id) on delete restrict,
  status            public.order_status not null default 'pending',
  currency          text not null default 'USD',
  total_cents       int not null check (total_cents >= 0),
  provider          text,
  provider_order_id text,
  idempotency_key   text unique,
  created_at        timestamptz not null default now(),
  paid_at           timestamptz,
  unique (provider, provider_order_id)
);
create index orders_user_idx on public.orders(user_id);

create table public.order_items (
  id                uuid primary key default gen_random_uuid(),
  order_id          uuid not null references public.orders(id) on delete cascade,
  product_id        uuid not null references public.products(id) on delete restrict,
  plan_id           uuid not null references public.pricing_plans(id) on delete restrict,
  quantity          int not null default 1 check (quantity > 0),
  unit_amount_cents int not null check (unit_amount_cents >= 0)
);
create index order_items_order_idx on public.order_items(order_id);

create table public.subscriptions (
  id                       uuid primary key default gen_random_uuid(),
  user_id                  uuid not null references public.profiles(id) on delete restrict,
  plan_id                  uuid not null references public.pricing_plans(id) on delete restrict,
  status                   public.subscription_status not null default 'active',
  current_period_start     timestamptz,
  current_period_end       timestamptz,
  cancel_at_period_end     boolean not null default false, -- paid-through-date policy
  canceled_at              timestamptz,
  provider                 text,
  provider_subscription_id text,
  created_at               timestamptz not null default now(),
  unique (provider, provider_subscription_id)
);
create index subscriptions_user_idx on public.subscriptions(user_id);

-- The effective permission to access a course. Enrollment and ordering are separate records.
create table public.entitlements (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles(id) on delete cascade,
  course_id       uuid not null references public.courses(id) on delete cascade,
  source          public.entitlement_source not null,
  status          public.entitlement_status not null default 'active',
  product_id      uuid references public.products(id) on delete set null,
  order_item_id   uuid references public.order_items(id) on delete set null,
  subscription_id uuid references public.subscriptions(id) on delete set null,
  starts_at       timestamptz not null default now(),
  expires_at      timestamptz,                 -- null = lifetime
  revoked_at      timestamptz,
  revoked_reason  public.revoke_reason,
  revoked_by      uuid references public.profiles(id) on delete set null,
  granted_by      uuid references public.profiles(id) on delete set null,
  note            text,
  created_at      timestamptz not null default now(),
  check (expires_at is null or expires_at > starts_at),
  check (status <> 'revoked' or (revoked_at is not null and revoked_reason is not null))
);
create index entitlements_user_course_idx on public.entitlements(user_id, course_id);
create index entitlements_course_idx      on public.entitlements(course_id);
create index entitlements_expiry_idx      on public.entitlements(expires_at) where status = 'active' and expires_at is not null;

create table public.enrollments (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles(id) on delete cascade,
  course_id    uuid not null references public.courses(id) on delete cascade,
  enrolled_at  timestamptz not null default now(),
  completed_at timestamptz,
  unique (user_id, course_id)
);
create index enrollments_course_idx on public.enrollments(course_id);

-- ---------- Learning ----------
create table public.lesson_progress (
  user_id          uuid not null references public.profiles(id) on delete cascade,
  lesson_id        uuid not null references public.lessons(id) on delete cascade,
  course_id        uuid not null references public.courses(id) on delete cascade,
  position_seconds int not null default 0 check (position_seconds >= 0),
  completed        boolean not null default false,
  completed_at     timestamptz,
  updated_at       timestamptz not null default now(),
  primary key (user_id, lesson_id)
);
create index lesson_progress_course_idx on public.lesson_progress(course_id, user_id);

create table public.quizzes (
  id           uuid primary key default gen_random_uuid(),
  course_id    uuid not null references public.courses(id) on delete cascade,
  lesson_id    uuid references public.lessons(id) on delete set null,
  title        text not null check (char_length(title) between 1 and 160),
  pass_percent int not null default 70 check (pass_percent between 1 and 100),
  is_published boolean not null default false,
  created_at   timestamptz not null default now()
);
create index quizzes_course_idx on public.quizzes(course_id);

create table public.questions (
  id       uuid primary key default gen_random_uuid(),
  quiz_id  uuid not null references public.quizzes(id) on delete cascade,
  prompt   text not null check (char_length(prompt) between 1 and 1000),
  options  jsonb not null check (jsonb_typeof(options) = 'array' and jsonb_array_length(options) between 2 and 8),
  position int not null default 0
);
create index questions_quiz_idx on public.questions(quiz_id, position);

-- Answer keys are in a separate table so students can never select them.
create table public.question_keys (
  question_id       uuid primary key references public.questions(id) on delete cascade,
  correct_option_id text not null,
  explanation       text
);

create table public.quiz_attempts (
  id            uuid primary key default gen_random_uuid(),
  quiz_id       uuid not null references public.quizzes(id) on delete cascade,
  user_id       uuid not null references public.profiles(id) on delete cascade,
  course_id     uuid not null references public.courses(id) on delete cascade,
  answers       jsonb not null,
  score_percent int not null check (score_percent between 0 and 100),
  passed        boolean not null,
  created_at    timestamptz not null default now()
);
create index quiz_attempts_quiz_user_idx on public.quiz_attempts(quiz_id, user_id);

create table public.assignments (
  id           uuid primary key default gen_random_uuid(),
  course_id    uuid not null references public.courses(id) on delete cascade,
  lesson_id    uuid references public.lessons(id) on delete set null,
  title        text not null check (char_length(title) between 1 and 160),
  instructions text not null default '' check (char_length(instructions) <= 10000),
  due_at       timestamptz,
  max_score    int not null default 100 check (max_score between 1 and 1000),
  is_published boolean not null default false,
  created_at   timestamptz not null default now()
);
create index assignments_course_idx on public.assignments(course_id);

create table public.submissions (
  id            uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.assignments(id) on delete cascade,
  user_id       uuid not null references public.profiles(id) on delete cascade,
  content       text not null check (char_length(content) between 1 and 20000),
  score         int check (score >= 0),
  feedback      text check (char_length(feedback) <= 5000),
  graded_by     uuid references public.profiles(id) on delete set null,
  graded_at     timestamptz,
  submitted_at  timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (assignment_id, user_id)
);
create index submissions_user_idx on public.submissions(user_id);

create table public.reviews (
  id         uuid primary key default gen_random_uuid(),
  course_id  uuid not null references public.courses(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  rating     smallint not null check (rating between 1 and 5),
  comment    text check (char_length(comment) <= 3000),
  is_hidden  boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (course_id, user_id)
);
create index reviews_course_idx on public.reviews(course_id) where not is_hidden;

create table public.certificates (
  id        uuid primary key default gen_random_uuid(),
  user_id   uuid not null references public.profiles(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete cascade,
  code      text not null unique,
  issued_at timestamptz not null default now(),
  unique (user_id, course_id)
);

create table public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  type       text not null,
  title      text not null,
  body       text,
  link       text,
  read_at    timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on public.notifications(user_id, created_at desc);

-- ---------- Payments (phase 2 — structures only) ----------
create table public.payment_events (
  id           uuid primary key default gen_random_uuid(),
  provider     text not null,
  event_id     text not null,
  type         text not null,
  payload      jsonb not null,
  received_at  timestamptz not null default now(),
  processed_at timestamptz,
  error        text,
  unique (provider, event_id)         -- idempotency: duplicate webhook deliveries collide here
);

create table public.refunds (
  id                 uuid primary key default gen_random_uuid(),
  order_id           uuid not null references public.orders(id) on delete restrict,
  amount_cents       int not null check (amount_cents > 0),
  currency           text not null,
  status             public.refund_status not null default 'pending',
  reason             text,
  provider_refund_id text unique,
  created_at         timestamptz not null default now()
);

create table public.instructor_earnings (
  id               uuid primary key default gen_random_uuid(),
  instructor_id    uuid not null references public.profiles(id) on delete restrict,
  order_item_id    uuid not null references public.order_items(id) on delete restrict,
  gross_cents      int not null,
  commission_cents int not null,
  net_cents        int not null,
  status           public.earning_status not null default 'pending',
  created_at       timestamptz not null default now(),
  check (gross_cents = commission_cents + net_cents)
);
create index instructor_earnings_instructor_idx on public.instructor_earnings(instructor_id);

-- ---------- Platform ----------
create table public.audit_logs (
  id          bigint generated always as identity primary key,
  actor_id    uuid references public.profiles(id) on delete set null,
  action      text not null,
  entity_type text,
  entity_id   text,
  metadata    jsonb not null default '{}'::jsonb,
  ip_hash     text,
  created_at  timestamptz not null default now()
);
create index audit_logs_created_idx on public.audit_logs(created_at desc);
create index audit_logs_actor_idx   on public.audit_logs(actor_id, created_at desc);
create index audit_logs_action_idx  on public.audit_logs(action, created_at desc);

create table public.platform_settings (
  key        text primary key,
  value      jsonb not null,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

-- Active streaming sessions for concurrency limits / sharing detection. Service-role only.
create table public.playback_sessions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles(id) on delete cascade,
  lesson_id    uuid not null references public.lessons(id) on delete cascade,
  session_id   text not null unique,
  ip_hash      text,
  started_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create index playback_sessions_user_idx on public.playback_sessions(user_id, last_seen_at desc);

-- DB-backed fixed-window rate limiting (no paid Redis needed). Service-role only.
create table public.rate_limits (
  key          text primary key,
  window_start timestamptz not null default now(),
  count        int not null default 0
);
