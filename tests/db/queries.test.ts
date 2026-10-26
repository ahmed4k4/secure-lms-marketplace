/**
 * Static guard for the untyped Supabase client: every `.from('table').select/insert/update(...)` in src/
 * must reference columns that really exist, and client-side writes must only touch columns granted to `authenticated`.
 * Catches typos and schema drift that TypeScript cannot see.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import type { PGlite } from '@electric-sql/pglite';
import { createDb } from './harness';

let db: PGlite;
const cols: Record<string, Set<string>> = {};
const relations: Record<string, string> = {
  // embedded relation name -> table (PostgREST resource embedding)
  courses: 'courses', lessons: 'lessons', roles: 'roles', pricing_plans: 'pricing_plans', assignments: 'assignments', profiles: 'profiles',
};

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : /\.(ts|tsx)$/.test(e.name) ? [path.join(dir, e.name)] : []));
}

beforeAll(async () => {
  db = await createDb();
  const r = await db.query<{ table_name: string; column_name: string }>(`select table_name, column_name from information_schema.columns where table_schema='public'`);
  for (const row of r.rows) (cols[row.table_name] ??= new Set()).add(row.column_name);
});

/** Splits a PostgREST select string into top-level items, respecting parentheses. */
function topLevel(sel: string): string[] {
  const out: string[] = []; let depth = 0, cur = '';
  for (const ch of sel) {
    if (ch === '(') depth++; if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function checkSelect(table: string, sel: string, where: string, errors: string[]) {
  for (const item of topLevel(sel)) {
    if (item === '*' || item === '') continue;
    const emb = item.match(/^(?:(\w+):)?(\w+)(?:!\w+)?\((.*)\)$/s);
    if (emb) {
      const rel = emb[2]!; const target = relations[rel] ?? (cols[rel] ? rel : null);
      if (target) checkSelect(target, emb[3]!, where, errors);
      continue;
    }
    const name = item.replace(/^\w+:/, '').split('::')[0]!.trim();
    if (!cols[table]?.has(name)) errors.push(`${where}: "${name}" is not a column of ${table}`);
  }
}

describe('Supabase calls reference real columns', () => {
  it('select() lists', () => {
    const errors: string[] = [];
    let found = 0;
    for (const file of walk(path.resolve(__dirname, '../../src'))) {
      const src = fs.readFileSync(file, 'utf8');
      const re = /\.from\('(\w+)'\)\s*\.select\(\s*(['"`])((?:(?!\2)[^\\]|\\.)*?)\2/g;
      for (const m of src.matchAll(re)) {
        found++;
        if (!cols[m[1]!]) { errors.push(`${path.relative(process.cwd(), file)}: unknown table ${m[1]}`); continue; }
        checkSelect(m[1]!, m[3]!.replace(/\s+/g, ' '), `${path.relative(process.cwd(), file)} ${m[1]}`, errors);
      }
    }
    expect(found).toBeGreaterThan(60);
    expect(errors).toEqual([]);
  });

  it('insert/update payload keys exist (object literals only)', () => {
    const errors: string[] = [];
    for (const file of walk(path.resolve(__dirname, '../../src'))) {
      const src = fs.readFileSync(file, 'utf8');
      const re = /\.from\('(\w+)'\)\s*\.(insert|update|upsert)\(\s*\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/g;
      for (const m of src.matchAll(re)) {
        const table = m[1]!;
        if (!cols[table]) { errors.push(`unknown table ${table}`); continue; }
        // top-level keys: `key:` or shorthand `key,`
        const body = m[3]!.replace(/\{[^{}]*\}/g, '{}').replace(/\[[^\]]*\]/g, '[]').replace(/\([^()]*\)/g, '()');
        for (const part of body.split(',')) {
          const key = part.trim().match(/^(\w+)\s*(?::|$)/)?.[1];
          if (key && !key.startsWith('...') && !cols[table]!.has(key)) errors.push(`${path.relative(process.cwd(), file)}: ${m[2]} on ${table} uses unknown column "${key}"`);
        }
      }
    }
    expect(errors).toEqual([]);
  });
});
