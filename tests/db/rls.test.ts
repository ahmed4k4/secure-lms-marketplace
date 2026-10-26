import { describe, it, expect, beforeAll } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { createDb, as, asService } from './harness';

let db: PGlite;
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ADMIN = id(1), INSTR_A = id(2), INSTR_B = id(3), STU1 = id(4), STU2 = id(5);
const C_FREE_A = id(100), C_DRAFT_A = id(101), C_PAID_B = id(102), C_CATEGORY_HOLD = id(103), C_PRICING = id(104);
const REQ_CATEGORY = id(600), EXISTING_CATEGORY = id(700);
const SEC_A = id(200), L_PREVIEW = id(300), L_LOCKED = id(301), L_DRAFT = id(302);
const QUIZ = id(400), Q1 = id(401), Q2 = id(402);
const ASSIGN = id(500);

const q = (sql: string, params?: unknown[]) => db.query(sql, params);

beforeAll(async () => {
  db = await createDb();
  for (const [i, email] of [[1, 'admin'], [2, 'a'], [3, 'b'], [4, 's1'], [5, 's2']] as const) {
    await q(`insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)`,
      [id(i), `${email}@example.test`, JSON.stringify({ full_name: `User ${email}`, locale: 'ar' })]);
  }
  await q(`insert into user_roles (user_id, role_id) select $1, id from roles where key = 'super_admin'`, [ADMIN]);
  for (const u of [INSTR_A, INSTR_B]) {
    await q(`insert into user_roles (user_id, role_id) select $1, id from roles where key = 'instructor'`, [u]);
    await q(`insert into instructor_profiles (user_id, headline) values ($1, 'Teacher')`, [u]);
  }
  await q(`insert into categories (id, slug, name_en, name_ar) values ($1,'existing-category-test','Existing category','تصنيف موجود')`, [EXISTING_CATEGORY]);
  await q(`insert into category_requests (id, slug, name_en, name_ar, requested_by, status) values ($1,'proposed-category-test','Proposed category','تصنيف مقترح',$2,'pending')`, [REQ_CATEGORY, INSTR_A]);
  await q(`insert into courses (id, slug, title, status, access_type, created_by, category_request_id) values ($1,'category-hold','Course waiting on category','draft','free',$2,$3)`, [C_CATEGORY_HOLD, INSTR_A, REQ_CATEGORY]);
  await q(`insert into courses (id, slug, title, status, access_type, created_by, published_at) values
    ($1,'free-a','Free course A','published','free',$4, now()),
    ($2,'draft-a','Draft course A','draft','free',$4, null),
    ($3,'paid-b','Paid course B','published','paid',$5, now())`, [C_FREE_A, C_DRAFT_A, C_PAID_B, INSTR_A, INSTR_B]);
  await q(`insert into courses (id, slug, title, status, access_type, created_by) values ($1,'pricing-test','Pricing test course','draft','free',$2)`, [C_PRICING, INSTR_A]);
  await q(`insert into sections (id, course_id, title) values ($1,$2,'Intro')`, [SEC_A, C_FREE_A]);
  await q(`insert into lessons (id, section_id, title, is_free_preview) values ($1,$2,'Preview',true), ($3,$2,'Locked',false)`, [L_PREVIEW, SEC_A, L_LOCKED]);
  const secDraft = id(201);
  await q(`insert into sections (id, course_id, title) values ($1,$2,'Draft sec')`, [secDraft, C_DRAFT_A]);
  await q(`insert into lessons (id, section_id, title, is_free_preview) values ($1,$2,'Draft lesson',true)`, [L_DRAFT, secDraft]);
  await q(`insert into lesson_videos (lesson_id, object_key, content_type, size_bytes, status) values ($1,'videos/x/y/z.mp4','video/mp4',1000,'ready')`, [L_LOCKED]);
  await q(`insert into lesson_resources (lesson_id, course_id, title, object_key, content_type, size_bytes, status) values ($1,$2,'Slides','resources/k.pdf','application/pdf',10,'ready')`, [L_LOCKED, C_FREE_A]);
  await q(`insert into quizzes (id, course_id, title, pass_percent, is_published) values ($1,$2,'Quiz',50,true)`, [QUIZ, C_FREE_A]);
  await q(`insert into questions (id, quiz_id, prompt, options, position) values
    ($1,$3,'2+2?','[{"id":"a","text":"3"},{"id":"b","text":"4"}]',0),
    ($2,$3,'Sky?','[{"id":"a","text":"blue"},{"id":"b","text":"green"}]',1)`, [Q1, Q2, QUIZ]);
  await q(`insert into question_keys (question_id, correct_option_id, explanation) values ($1,'b','four'), ($2,'a','blue')`, [Q1, Q2]);
  await q(`insert into assignments (id, course_id, title, is_published) values ($1,$2,'Essay',true)`, [ASSIGN, C_FREE_A]);
});

describe('signup trigger and identity', () => {
  it('creates a profile and student role; locale comes from metadata', async () => {
    const r = await q(`select p.locale, r.key from profiles p join user_roles ur on ur.user_id=p.id join roles r on r.id=ur.role_id where p.id=$1`, [STU1]);
    expect(r.rows).toEqual([{ locale: 'ar', key: 'student' }]);
  });
  it('students cannot grant themselves roles or change their status', async () => {
    await expect(as(db, { sub: STU1 }, (x) => x(`insert into user_roles (user_id, role_id) select $1, id from roles where key='super_admin'`, [STU1]))).rejects.toThrow();
    await expect(as(db, { sub: STU1 }, (x) => x(`update profiles set status='active', full_name='x' where id=$1`, [STU1]).then(() => x(`update profiles set status='suspended' where id=$1`, [STU1])))).rejects.toThrow(/permission denied/);
  });
  it('the database enforces one platform role per account', async () => {
    await expect(q(`insert into user_roles (user_id, role_id) select $1, id from roles where key='instructor'`, [STU1])).rejects.toThrow(/user_roles_one_role_per_user|duplicate key/i);
    const rows = await q(`select count(*)::int as n from user_roles where user_id=$1`, [STU1]);
    expect(rows.rows[0]).toEqual({ n: 1 });
  });
  it('users cannot read other users profiles', async () => {
    const rows = await as(db, { sub: STU1 }, (x) => x(`select id from profiles`));
    expect(rows.map((r) => (r as { id: string }).id)).toEqual([STU1]);
  });
});

describe('course visibility and ownership (BOLA/IDOR)', () => {
  it('anonymous users only see published courses', async () => {
    const rows = await as(db, null, (x) => x(`select slug from courses order by slug`));
    expect(rows).toEqual([{ slug: 'free-a' }, { slug: 'paid-b' }]);
  });
  it('instructor A sees own draft; instructor B does not', async () => {
    expect((await as(db, { sub: INSTR_A }, (x) => x(`select id from courses where id=$1`, [C_DRAFT_A]))).length).toBe(1);
    expect((await as(db, { sub: INSTR_B }, (x) => x(`select id from courses where id=$1`, [C_DRAFT_A]))).length).toBe(0);
  });
  it('instructor B cannot modify or delete instructor A courses', async () => {
    const upd = await as(db, { sub: INSTR_B }, (x) => x(`update courses set title='hijacked' where id=$1 returning id`, [C_FREE_A]));
    expect(upd.length).toBe(0);
    const del = await as(db, { sub: INSTR_B }, (x) => x(`delete from courses where id=$1 returning id`, [C_DRAFT_A]));
    expect(del.length).toBe(0);
    await expect(as(db, { sub: INSTR_B }, (x) => x(`insert into sections (course_id, title) values ($1,'evil')`, [C_FREE_A]))).rejects.toThrow(/row-level security/);
  });
  it('instructor B cannot read A lesson videos, quiz keys or draft lessons', async () => {
    expect((await as(db, { sub: INSTR_B }, (x) => x(`select 1 from lesson_videos`))).length).toBe(0);
    expect((await as(db, { sub: INSTR_B }, (x) => x(`select 1 from question_keys`))).length).toBe(0);
    expect((await as(db, { sub: INSTR_B }, (x) => x(`select 1 from lessons where id=$1`, [L_DRAFT]))).length).toBe(0);
  });
  it('students cannot create courses', async () => {
    await expect(as(db, { sub: STU1 }, (x) => x(`insert into courses (slug,title,created_by) values ('s','Student course',$1)`, [STU1]))).rejects.toThrow(/row-level security/);
  });
  it('instructors cannot create courses on behalf of someone else', async () => {
    await expect(as(db, { sub: INSTR_A }, (x) => x(`insert into courses (slug,title,created_by) values ('imp','Impersonation',$1)`, [INSTR_B]))).rejects.toThrow(/row-level security/);
  });
  it('a new course gets its owner row and starts as draft', async () => {
    const rows = await as(db, { sub: INSTR_A }, async (x) => {
      await x(`insert into courses (slug, title, created_by) values ('mine','My new course',$1)`, [INSTR_A]);
      return x(`select ci.role, c.status from course_instructors ci join courses c on c.id=ci.course_id where c.slug='mine'`);
    });
    expect(rows).toEqual([{ role: 'owner', status: 'draft' }]);
  });
});

describe('course pricing model configuration', () => {
  it('updates monthly/yearly plan metadata atomically without creating paid entitlements', async () => {
    const rows = await as(db, { sub: INSTR_A }, async (x) => {
      await x(`select public.configure_course_pricing($1, 'monthly', 1900, 'USD', null)`, [C_PRICING]);
      await x(`select public.configure_course_pricing($1, 'yearly', 19000, 'USD', null)`, [C_PRICING]);
      return x(`select c.access_type::text as access_type, pl.kind::text as kind,
                       pl.billing_interval::text as billing_interval, pl.amount_cents,
                       (select count(*)::int from pricing_plans p2 join products pr2 on pr2.id=p2.product_id where pr2.course_id=c.id and p2.active) as active_plans,
                       (select count(*)::int from pricing_plans p2 join products pr2 on pr2.id=p2.product_id where pr2.course_id=c.id) as all_plans,
                       (select count(*)::int from entitlements e where e.course_id=c.id) as entitlements
                from courses c join products pr on pr.course_id=c.id join pricing_plans pl on pl.product_id=pr.id and pl.active
                where c.id=$1`, [C_PRICING]);
    });
    expect(rows).toEqual([{ access_type: 'paid', kind: 'subscription', billing_interval: 'year', amount_cents: 19000, active_plans: 1, all_plans: 2, entitlements: 0 }]);
  });
});

describe('publishing workflow', () => {
  it('a held course cannot bypass approval while its proposed category is still pending', async () => {
    await expect(as(db, { sub: INSTR_A }, (x) => x(`update courses set status='in_review' where id=$1 returning status`, [C_CATEGORY_HOLD]))).rejects.toThrow(/invalid_status_transition/);
  });
  it('an instructor may replace a pending proposal with an existing approved category and continue to review', async () => {
    const rows = await as(db, { sub: INSTR_A }, async (x) => {
      await x(`update courses set status='category_pending' where id=$1`, [C_CATEGORY_HOLD]);
      await x(`update courses set category_id=$1, category_request_id=null where id=$2`, [EXISTING_CATEGORY, C_CATEGORY_HOLD]);
      return x(`update courses set status='in_review' where id=$1 returning status, category_id`, [C_CATEGORY_HOLD]);
    });
    expect(rows).toEqual([{ status: 'in_review', category_id: EXISTING_CATEGORY }]);
  });
  it('instructors cannot publish; they can submit for review', async () => {
    await expect(as(db, { sub: INSTR_A }, (x) => x(`update courses set status='published' where id=$1`, [C_DRAFT_A]))).rejects.toThrow(/invalid_status_transition/);
    const r = await as(db, { sub: INSTR_A }, (x) => x(`update courses set status='in_review' where id=$1 returning status`, [C_DRAFT_A]));
    expect(r).toEqual([{ status: 'in_review' }]);
  });
  it('instructors cannot forge published_at / rejection_reason', async () => {
    const r = await as(db, { sub: INSTR_A }, (x) => x(`update courses set published_at=now(), rejection_reason='x' where id=$1 returning published_at, rejection_reason`, [C_DRAFT_A]));
    expect(r).toEqual([{ published_at: null, rejection_reason: null }]);
  });
  it('admin publication permission is enforced by role and permission, not by a second-factor claim', async () => {
    const result = await as(db, { sub: ADMIN }, (x) => x(`update courses set status='published' where id=$1 returning status, published_at is not null as stamped`, [C_DRAFT_A]));
    expect(result).toEqual([{ status: 'published', stamped: true }]);
  });
});

describe('entitlements and lesson access', () => {
  it('anonymous users cannot access any lesson, not even previews (login required)', async () => {
    expect(await as(db, null, (x) => x(`select public.can_access_lesson($1) as ok`, [L_PREVIEW]))).toEqual([{ ok: false }]);
  });
  it('un-enrolled student: preview yes, locked lesson no', async () => {
    const r = await as(db, { sub: STU1 }, (x) => x(`select public.can_access_lesson($1) as p, public.can_access_lesson($2) as l`, [L_PREVIEW, L_LOCKED]));
    expect(r).toEqual([{ p: true, l: false }]);
  });
  it('draft course lessons are not accessible even if flagged as preview', async () => {
    expect(await as(db, { sub: STU1 }, (x) => x(`select public.can_access_lesson($1) as ok`, [L_DRAFT]))).toEqual([{ ok: false }]);
  });
  it('free enrollment grants access; paid course cannot be self-enrolled', async () => {
    const r = await as(db, { sub: STU1 }, async (x) => {
      await x(`select enroll_free_course($1)`, [C_FREE_A]);
      await x(`select enroll_free_course($1)`, [C_FREE_A]); // idempotent
      return x(`select public.can_access_lesson($1) as ok, (select count(*)::int from entitlements where user_id=$2) as n`, [L_LOCKED, STU1]);
    }, { commit: true });
    expect(r).toEqual([{ ok: true, n: 1 }]);
    await expect(as(db, { sub: STU1 }, (x) => x(`select enroll_free_course($1)`, [C_PAID_B]))).rejects.toThrow(/course_not_free_or_unavailable/);
  });
  it('clients cannot insert entitlements or enrollments directly', async () => {
    await expect(as(db, { sub: STU1 }, (x) => x(`insert into entitlements (user_id, course_id, source) values ($1,$2,'admin_grant')`, [STU1, C_PAID_B]))).rejects.toThrow(/permission denied/);
    await expect(as(db, { sub: STU1 }, (x) => x(`insert into enrollments (user_id, course_id) values ($1,$2)`, [STU1, C_PAID_B]))).rejects.toThrow(/permission denied/);
  });
  it('expired, revoked and future entitlements do not grant access; lifetime survives a price change', async () => {
    await asService(db, async (x) => {
      await x(`insert into entitlements (user_id, course_id, source, starts_at, expires_at) values ($1,$2,'purchase', now() - interval '10 days', now() - interval '1 day')`, [STU2, C_PAID_B]);
    });
    const lessonB = id(310), secB = id(210);
    await q(`insert into sections (id, course_id, title) values ($1,$2,'S')`, [secB, C_PAID_B]);
    await q(`insert into lessons (id, section_id, title) values ($1,$2,'L')`, [lessonB, secB]);
    expect(await as(db, { sub: STU2 }, (x) => x(`select public.can_access_lesson($1) as ok`, [lessonB]))).toEqual([{ ok: false }]);
    // grant lifetime, then revoke
    await asService(db, async (x) => {
      await x(`insert into entitlements (id, user_id, course_id, source) values ($1,$2,$3,'purchase')`, [id(900), STU2, C_PAID_B]);
    });
    expect(await as(db, { sub: STU2 }, (x) => x(`select public.can_access_lesson($1) as ok`, [lessonB]))).toEqual([{ ok: true }]);
    await q(`update courses set access_type='free' where id=$1`, [C_PAID_B]);   // pricing change must not revoke
    await q(`update courses set access_type='paid' where id=$1`, [C_PAID_B]);
    expect(await as(db, { sub: STU2 }, (x) => x(`select public.can_access_lesson($1) as ok`, [lessonB]))).toEqual([{ ok: true }]);
    await q(`update entitlements set status='revoked', revoked_at=now(), revoked_reason='refund' where id=$1`, [id(900)]);
    expect(await as(db, { sub: STU2 }, (x) => x(`select public.can_access_lesson($1) as ok`, [lessonB]))).toEqual([{ ok: false }]);
  });
  it('suspended accounts lose access immediately', async () => {
    await q(`update profiles set status='suspended' where id=$1`, [STU1]);
    expect(await as(db, { sub: STU1 }, (x) => x(`select public.can_access_lesson($1) as ok`, [L_LOCKED]))).toEqual([{ ok: false }]);
    await q(`update profiles set status='active' where id=$1`, [STU1]);
  });
  it('suspended courses stop serving students; archived courses keep serving enrolled students', async () => {
    await q(`update courses set status='suspended' where id=$1`, [C_FREE_A]);
    expect(await as(db, { sub: STU1 }, (x) => x(`select public.can_access_lesson($1) as ok`, [L_LOCKED]))).toEqual([{ ok: false }]);
    await q(`update courses set status='archived' where id=$1`, [C_FREE_A]);
    expect(await as(db, { sub: STU1 }, (x) => x(`select public.can_access_lesson($1) as ok`, [L_LOCKED]))).toEqual([{ ok: true }]);
    await q(`update courses set status='published' where id=$1`, [C_FREE_A]);
  });
  it('instructors can access their own unpublished lessons; other instructors cannot', async () => {
    expect(await as(db, { sub: INSTR_A }, (x) => x(`select public.can_access_lesson($1) as ok`, [L_LOCKED]))).toEqual([{ ok: true }]);
    expect(await as(db, { sub: INSTR_B }, (x) => x(`select public.can_access_lesson($1) as ok`, [L_LOCKED]))).toEqual([{ ok: false }]);
  });
});

describe('progress, resources, quizzes, assignments', () => {
  it('progress writes require lesson access', async () => {
    await expect(as(db, { sub: STU2 }, (x) => x(`insert into lesson_progress (user_id, lesson_id, position_seconds) values ($1,$2,5)`, [STU2, L_LOCKED]))).rejects.toThrow(/row-level security/);
    const r = await as(db, { sub: STU1 }, async (x) => {
      await x(`insert into lesson_progress (user_id, lesson_id, position_seconds) values ($1,$2,5)`, [STU1, L_LOCKED]);
      return x(`select course_id, position_seconds from lesson_progress where user_id=$1`, [STU1]);
    });
    expect(r).toEqual([{ course_id: C_FREE_A, position_seconds: 5 }]);
  });
  it('students cannot write progress for another user', async () => {
    await expect(as(db, { sub: STU1 }, (x) => x(`insert into lesson_progress (user_id, lesson_id) values ($1,$2)`, [STU2, L_PREVIEW]))).rejects.toThrow(/row-level security/);
  });
  it('object_key columns are not selectable by clients', async () => {
    await expect(as(db, { sub: STU1 }, (x) => x(`select object_key from lesson_resources`))).rejects.toThrow(/permission denied/);
    await expect(as(db, { sub: STU1 }, (x) => x(`select * from lesson_resources`))).rejects.toThrow(/permission denied/);
    expect((await as(db, { sub: STU1 }, (x) => x(`select id, title from lesson_resources`))).length).toBe(1);
    expect((await as(db, { sub: STU2 }, (x) => x(`select id, title from lesson_resources`))).length).toBe(0);
    await expect(as(db, { sub: STU1 }, (x) => x(`select * from lesson_videos`))).resolves.toEqual([]);
  });
  it('students never see answer keys; grading happens server-side', async () => {
    expect(await as(db, { sub: STU1 }, (x) => x(`select * from question_keys`))).toEqual([]);
    expect((await as(db, { sub: STU1 }, (x) => x(`select id from questions`))).length).toBe(2);
    expect((await as(db, { sub: STU2 }, (x) => x(`select id from questions`))).length).toBe(0);
    const r = await as(db, { sub: STU1 }, (x) => x<{ r: { score_percent: number; passed: boolean } }>(`select submit_quiz_attempt($1, $2::jsonb) as r`, [QUIZ, JSON.stringify({ [Q1]: 'b', [Q2]: 'b' })]));
    expect(r[0].r.score_percent).toBe(50);
    expect(r[0].r.passed).toBe(true);
    await expect(as(db, { sub: STU2 }, (x) => x(`select submit_quiz_attempt($1, '{}'::jsonb)`, [QUIZ]))).rejects.toThrow(/forbidden/);
  });
  it('submissions: own only, locked after grading, grading restricted to course managers', async () => {
    await asService(db, async (x) => {
      await x(`insert into submissions (id, assignment_id, user_id, content) values ($1,$2,$3,'my essay')`, [id(600), ASSIGN, STU1]);
    });
    expect((await as(db, { sub: STU2 }, (x) => x(`select id from submissions`))).length).toBe(0);
    await expect(as(db, { sub: INSTR_B }, (x) => x(`select grade_submission($1, 90, 'nice')`, [id(600)]))).rejects.toThrow(/forbidden/);
    await as(db, { sub: INSTR_A }, (x) => x(`select grade_submission($1, 90, 'nice')`, [id(600)]));
    await q(`update submissions set score=90 where id=$1`, [id(600)]);
    const edited = await as(db, { sub: STU1 }, (x) => x(`update submissions set content='changed' where id=$1 returning id`, [id(600)]));
    expect(edited.length).toBe(0);
    await expect(as(db, { sub: INSTR_A }, (x) => x(`select grade_submission($1, 5000, '')`, [id(600)]))).rejects.toThrow(/score_out_of_range/);
  });
});

describe('certificates', () => {
  it('requires all lessons complete, then issues a verifiable code', async () => {
    await expect(as(db, { sub: STU1 }, (x) => x(`select issue_certificate($1)`, [C_FREE_A]))).rejects.toThrow(/course_not_completed/);
    await q(`insert into lesson_progress (user_id, lesson_id, course_id, completed) values ($1,$2,$3,true), ($1,$4,$3,true)`, [STU1, L_PREVIEW, C_FREE_A, L_LOCKED]);
    const code = await as(db, { sub: STU1 }, async (x) => (await x<{ c: string }>(`select issue_certificate($1) as c`, [C_FREE_A]))[0].c, { commit: true });
    expect(code).toMatch(/^[0-9A-F]{4}(-[0-9A-F]{4}){3}$/);
    const v = await as(db, null, (x) => x<{ v: { holder_name: string } }>(`select verify_certificate($1) as v`, [code.toLowerCase()]));
    expect(v[0].v.holder_name).toBe('User s1');
    expect((await as(db, null, (x) => x(`select verify_certificate('NOPE')  as v`)))[0]).toEqual({ v: null });
  });
});

describe('audit, settings, payments, internals', () => {
  it('clients cannot write or read audit logs unless permitted; rows are immutable', async () => {
    await q(`insert into audit_logs (action) values ('test.event')`);
    await expect(as(db, { sub: STU1 }, (x) => x(`insert into audit_logs (action) values ('forged')`))).rejects.toThrow(/permission denied/);
    expect(await as(db, { sub: STU1 }, (x) => x(`select * from audit_logs`))).toEqual([]);
    expect((await as(db, { sub: ADMIN }, (x) => x(`select * from audit_logs`))).length).toBeGreaterThan(0);
    await expect(q(`update audit_logs set action='tampered'`)).rejects.toThrow(/immutable/);
  });
  it('payment tables are not writable or readable by clients', async () => {
    await expect(as(db, { sub: STU1 }, (x) => x(`select * from payment_events`))).rejects.toThrow(/permission denied/);
    await expect(as(db, { sub: STU1 }, (x) => x(`insert into orders (user_id, total_cents) values ($1, 0)`, [STU1]))).rejects.toThrow(/permission denied/);
  });
  it('payment events are idempotent on (provider, event_id)', async () => {
    await q(`insert into payment_events (provider, event_id, type, payload) values ('x','evt_1','paid','{}')`);
    await expect(q(`insert into payment_events (provider, event_id, type, payload) values ('x','evt_1','paid','{}')`)).rejects.toThrow(/duplicate key/);
  });
  it('rate_limit_hit is service-role only and enforces the window', async () => {
    await expect(as(db, { sub: STU1 }, (x) => x(`select rate_limit_hit('k', 60, 2)`))).rejects.toThrow(/permission denied/);
    const hits: boolean[] = [];
    for (let i = 0; i < 4; i++) {
      await asService(db, async (x) => { hits.push((await x<{ r: boolean }>(`select rate_limit_hit('k1', 60, 3) as r`))[0].r); });
    }
    expect(hits).toEqual([true, true, true, false]);
  });
  it('internal tables are invisible to clients', async () => {
    await expect(as(db, { sub: STU1 }, (x) => x(`select * from playback_sessions`))).rejects.toThrow(/permission denied/);
    await expect(as(db, { sub: STU1 }, (x) => x(`select * from rate_limits`))).rejects.toThrow(/permission denied/);
    expect(await as(db, { sub: STU1 }, (x) => x(`select * from platform_settings`))).toEqual([]);
  });
  it('catalog view respects RLS and exposes whitelisted instructor info only', async () => {
    const rows = await as(db, null, (x) => x<{ slug: string; owner_name: string }>(`select slug, owner_name from course_catalog order by slug`));
    expect(rows.map((r) => r.slug)).toEqual(['free-a', 'paid-b']);
    expect(rows[0].owner_name).toBe('User a');
  });
});

describe('admin helper functions (migration 0005)', () => {
  it('email lookups are service-role only', async () => {
    await expect(as(db, { sub: STU1 }, (x) => x(`select find_user_id_by_email('admin@example.test')`))).rejects.toThrow(/permission denied/);
    await expect(as(db, null, (x) => x(`select * from user_emails(array[$1]::uuid[])`, [STU1]))).rejects.toThrow(/permission denied/);
    const rows = await asService(db, async (x) => { const r = await x<{ id: string }>(`select find_user_id_by_email(' ADMIN@example.test ') as id`); expect(r[0].id).toBe(ADMIN); });
    expect(rows).toBeUndefined();
  });
  it('entitlement expiry sweep only touches lapsed rows', async () => {
    await q(`insert into entitlements (id, user_id, course_id, source, starts_at, expires_at) values ($1,$2,$3,'promo', now() - interval '3 days', now() - interval '1 day')`, [id(901), STU1, C_PAID_B]);
    await asService(db, async (x) => { const n = (await x<{ n: number }>(`select expire_entitlements() as n`))[0].n; expect(n).toBeGreaterThanOrEqual(1); });
    expect((await q(`select status from entitlements where id=$1`, [id(901)])).rows).toEqual([{ status: 'expired' }]);
  });
  it('a suspended instructor loses management rights immediately', async () => {
    await q(`update instructor_profiles set status='suspended' where user_id=$1`, [INSTR_A]);
    expect(await as(db, { sub: INSTR_A }, (x) => x(`select public.can_manage_course($1) as ok`, [C_FREE_A]))).toEqual([{ ok: false }]);
    await q(`update instructor_profiles set status='active' where user_id=$1`, [INSTR_A]);
  });
});

describe('learning experience (migration 0006)', () => {
  let D1 = '';
  it('landing-page fields are editable only by the course owner', async () => {
    const ok = await as(db, { sub: INSTR_A }, (x) => x(`update courses set outcomes = array['Build X','Ship Y'], requirements = array['Laptop'] where id=$1 returning cardinality(outcomes) as n`, [C_FREE_A]));
    expect(ok).toEqual([{ n: 2 }]);
    expect((await as(db, { sub: INSTR_B }, (x) => x(`update courses set outcomes = array['hijack'] where id=$1 returning id`, [C_FREE_A]))).length).toBe(0);
    await expect(as(db, { sub: INSTR_A }, (x) => x(`update courses set outcomes = (select array_agg('x'::text) from generate_series(1,13)) where id=$1`, [C_FREE_A]))).rejects.toThrow(/check constraint/);
  });
  it('enrolled students can ask questions; outsiders cannot; nobody can post as someone else', async () => {
    await expect(as(db, { sub: STU2 }, (x) => x(`insert into discussions (course_id, user_id, title, body) values ($1,$2,'How?','Please help')`, [C_FREE_A, STU2]))).rejects.toThrow(/row-level security/);
    await expect(as(db, { sub: STU1 }, (x) => x(`insert into discussions (course_id, user_id, title, body) values ($1,$2,'Spoof','x')`, [C_FREE_A, STU2]))).rejects.toThrow(/row-level security/);
    await expect(as(db, { sub: STU1 }, (x) => x(`insert into discussions (course_id, lesson_id, user_id, title, body) values ($1,$2,$3,'Cross','x')`, [C_FREE_A, id(310), STU1]))).rejects.toThrow(/row-level security/); // lesson of another course
    await as(db, { sub: STU1 }, (x) => x(`insert into discussions (course_id, lesson_id, user_id, title, body) values ($1,$2,$3,'How do I start?','Stuck on lesson 1')`, [C_FREE_A, L_LOCKED, STU1]), { commit: true });
    D1 = ((await q(`select id from discussions limit 1`)).rows[0] as { id: string }).id;
  });
  it('Q&A visibility: course members and its instructor only', async () => {
    expect((await as(db, { sub: STU1 }, (x) => x(`select id from discussions`))).length).toBe(1);
    expect((await as(db, { sub: INSTR_A }, (x) => x(`select id from discussions`))).length).toBe(1);
    expect((await as(db, { sub: STU2 }, (x) => x(`select id from discussions`))).length).toBe(0);
    expect((await as(db, { sub: INSTR_B }, (x) => x(`select id from discussions`))).length).toBe(0);
    expect((await as(db, null, (x) => x(`select id from discussions`).catch(() => []))).length).toBe(0);
  });
  it('replies: instructor can answer, outsider cannot, course_id is derived server-side', async () => {
    await expect(as(db, { sub: STU2 }, (x) => x(`insert into discussion_replies (discussion_id, user_id, body) values ($1,$2,'hi')`, [D1, STU2]))).rejects.toThrow(/row-level security/);
    await expect(as(db, { sub: INSTR_B }, (x) => x(`insert into discussion_replies (discussion_id, user_id, body) values ($1,$2,'hi')`, [D1, INSTR_B]))).rejects.toThrow(/row-level security/);
    const r = await as(db, { sub: INSTR_A }, async (x) => { await x(`insert into discussion_replies (discussion_id, user_id, body) values ($1,$2,'Start with the intro video')`, [D1, INSTR_A]); return x(`select course_id from discussion_replies`); });
    expect(r).toEqual([{ course_id: C_FREE_A }]);
  });
  it('only the author or a course manager can resolve or delete a question', async () => {
    expect((await as(db, { sub: STU2 }, (x) => x(`update discussions set is_resolved = true where id=$1 returning id`, [D1]))).length).toBe(0);
    expect((await as(db, { sub: INSTR_A }, (x) => x(`update discussions set is_resolved = true where id=$1 returning id`, [D1]))).length).toBe(1);
    await expect(as(db, { sub: STU1 }, (x) => x(`update discussions set body = 'edited' where id=$1`, [D1]))).rejects.toThrow(/permission denied/);
    expect((await as(db, { sub: INSTR_B }, (x) => x(`delete from discussions where id=$1 returning id`, [D1]))).length).toBe(0);
  });
  it('notes are private to their author and require lesson access', async () => {
    await expect(as(db, { sub: STU2 }, (x) => x(`insert into lesson_notes (user_id, lesson_id, body) values ($1,$2,'n')`, [STU2, L_LOCKED]))).rejects.toThrow(/row-level security/);
    await as(db, { sub: STU1 }, (x) => x(`insert into lesson_notes (user_id, lesson_id, position_seconds, body) values ($1,$2,42,'remember this')`, [STU1, L_LOCKED]), { commit: true });
    expect((await as(db, { sub: STU1 }, (x) => x(`select course_id, position_seconds from lesson_notes`)))).toEqual([{ course_id: C_FREE_A, position_seconds: 42 }]);
    expect((await as(db, { sub: INSTR_A }, (x) => x(`select id from lesson_notes`))).length).toBe(0);
    expect((await as(db, { sub: STU2 }, (x) => x(`select id from lesson_notes`))).length).toBe(0);
  });
  it('announcements: managers write, enrolled students read, outsiders see nothing', async () => {
    await expect(as(db, { sub: STU1 }, (x) => x(`insert into announcements (course_id, author_id, title, body) values ($1,$2,'t','b')`, [C_FREE_A, STU1]))).rejects.toThrow(/row-level security/);
    await expect(as(db, { sub: INSTR_B }, (x) => x(`insert into announcements (course_id, author_id, title, body) values ($1,$2,'t','b')`, [C_FREE_A, INSTR_B]))).rejects.toThrow(/row-level security/);
    await as(db, { sub: INSTR_A }, (x) => x(`insert into announcements (course_id, author_id, title, body) values ($1,$2,'Welcome','Glad you joined')`, [C_FREE_A, INSTR_A]), { commit: true });
    expect((await as(db, { sub: STU1 }, (x) => x(`select title from announcements`)))).toEqual([{ title: 'Welcome' }]);
    expect((await as(db, { sub: STU2 }, (x) => x(`select title from announcements`))).length).toBe(0);
  });
  it('catalog exposes published courses with safe aggregates only', async () => {
    const rows = await as(db, null, (x) => x<{ slug: string; student_count: number; lesson_count: number }>(`select slug, student_count, lesson_count from course_catalog where slug='free-a'`));
    expect(rows.length).toBe(1);
    expect(Number(rows[0].student_count)).toBeGreaterThanOrEqual(1);
    await q(`insert into courses (slug, title, status, created_by) values ('hidden-draft','Hidden draft','draft',$1)`, [INSTR_A]);
    expect((await as(db, null, (x) => x(`select 1 from course_catalog where slug='hidden-draft'`))).length).toBe(0);
  });
});

