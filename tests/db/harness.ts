import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import path from 'node:path';

/** Minimal emulation of what Supabase provides before our migrations run. */
const SUPABASE_STUBS = `
create schema auth;
create table auth.users (id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb not null default '{}'::jsonb);
create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
create function auth.uid() returns uuid language sql stable as $$ select nullif(auth.jwt() ->> 'sub', '')::uuid $$;
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
grant usage on schema public, auth to anon, authenticated, service_role;
grant execute on function auth.jwt(), auth.uid() to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
`;

export async function createDb() {
  const db = new PGlite();
  await db.exec(SUPABASE_STUBS);
  const dir = path.resolve(__dirname, '../../supabase/migrations');
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    try {
      await db.exec(fs.readFileSync(path.join(dir, f), 'utf8'));
    } catch (e) {
      throw new Error(`Migration ${f} failed: ${(e as Error).message}`);
    }
  }
  return db;
}

export type Q = <T = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<T[]>;

/** Runs fn inside a transaction as the given JWT identity (or anon), then rolls back. */
export async function as<T>(
  db: PGlite,
  who: { sub: string } | null,
  fn: (q: Q) => Promise<T>,
  opts: { commit?: boolean } = {},
): Promise<T> {
  await db.exec('begin');
  let ok = false;
  try {
    const claims = who ? JSON.stringify({ sub: who.sub, role: 'authenticated' }) : '';
    await db.query(`select set_config('request.jwt.claims', $1, true)`, [claims]);
    await db.exec(`set local role ${who ? 'authenticated' : 'anon'}`);
    const out = await fn(async (sql, params) => (await db.query(sql, params)).rows as never);
    ok = true;
    return out;
  } finally {
    if (ok && opts.commit) {
      await db.exec('reset role');
      await db.exec('commit');
    } else {
      await db.exec('rollback');
    }
  }
}

/** Same but persists (used for arranging data as the service role). */
export async function asService(db: PGlite, fn: (q: Q) => Promise<void>) {
  await db.exec('begin');
  try {
    await db.exec('set local role service_role');
    await fn(async (sql, params) => (await db.query(sql, params)).rows as never);
    await db.exec('commit');
  } catch (e) {
    await db.exec('rollback');
    throw e;
  }
}
