/**
 * D206 — the avatar palette is authored in two places a reader cannot import from each
 * other: the CHECK on `approved_users.avatar_color` and `AVATAR_COLORS`. A token the
 * page offers and the database refuses fails on save; one the database allows and the
 * page cannot render silently shows the default. This compares the two lists.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { AVATAR_COLORS, DEFAULT_AVATAR_CLASS, avatarClass } from '../avatarColors';

const MIGRATION = path.resolve(
  __dirname, '../../../supabase/migrations/20260929000003_account_self_service_names_its_user.sql');

function checkTokens(): string[] {
  const sql = readFileSync(MIGRATION, 'utf8');
  const m = /avatar_color IN \(([^)]*)\)/.exec(sql);
  if (!m) throw new Error('no `avatar_color IN (...)` CHECK found in the migration');
  return [...m[1].matchAll(/'([^']+)'/g)].map((t) => t[1]);
}

describe('avatar palette', () => {
  it('offers exactly the tokens the database accepts', () => {
    expect(Object.keys(AVATAR_COLORS).sort()).toEqual(checkTokens().sort());
  });

  it('renders every token with its own fill and falls back for anything else', () => {
    for (const [token, { className }] of Object.entries(AVATAR_COLORS)) {
      expect(avatarClass(token)).toBe(className);
      expect(className).toMatch(new RegExp(`\\bbg-${token}-600\\b`));
    }
    expect(avatarClass(null)).toBe(DEFAULT_AVATAR_CLASS);
    expect(avatarClass('#ff0000')).toBe(DEFAULT_AVATAR_CLASS);
    expect(avatarClass('toString')).toBe(DEFAULT_AVATAR_CLASS);
  });
});
