/**
 * F-28 (audit 2026-09-22) — every edge function states its trust model.
 *
 * `get-mapbox-token` had no `[functions.*]` block in `supabase/config.toml`, so it
 * inherited the CLI default rather than a decision — the gap `config.toml`'s own
 * D105 comment names for two other functions. Three were undeclared. A default is
 * not a decision, and the next reader cannot tell them apart.
 */
import { readdirSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const FN_DIR = 'supabase/functions';
const config = readFileSync('supabase/config.toml', 'utf8');

const functions = readdirSync(FN_DIR, { withFileTypes: true })
  .filter((d) => d.isDirectory() && !d.name.startsWith('_') && existsSync(join(FN_DIR, d.name, 'index.ts')))
  .map((d) => d.name);

describe('F-28 — every edge function declares verify_jwt', () => {
  it('finds the functions (not vacuous)', () => {
    expect(functions.length).toBeGreaterThan(10);
    expect(functions).toContain('get-mapbox-token');
  });

  it.each(functions)('%s has a [functions.*] block with an explicit verify_jwt', (fn) => {
    const block = new RegExp(`^\\[functions\\.${fn.replace(/-/g, '\\-')}\\]\\s*\\n(?:#.*\\n)*verify_jwt\\s*=\\s*(true|false)`, 'm');
    expect(config).toMatch(block);
  });
});
