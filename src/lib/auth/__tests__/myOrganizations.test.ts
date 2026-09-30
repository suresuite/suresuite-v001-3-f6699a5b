/**
 * D210 — the organization switch. Two facts here are authored elsewhere and cannot be
 * imported: the refusals `switch_my_organization` raises (the migration) and the keys
 * under which the app remembers a selected project (`useGlobalProject`, `DataManager`).
 * This compares them, so a renamed token or key fails here rather than in a user's
 * session.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

// The client reads browser storage when it loads; nothing here calls it.
vi.mock('@/integrations/supabase/client', () => ({ supabase: {} }));

import { PROJECT_SELECTION_KEYS, forgetProjectSelection, switchRefusal } from '../myOrganizations';

const root = path.resolve(__dirname, '../../../..');
const read = (rel: string) => readFileSync(path.join(root, rel), 'utf8');
const sql = read('supabase/migrations/20260930000004_account_in_several_organizations.sql');

function switchBody(): string {
  const m = /FUNCTION public\.switch_my_organization\([\s\S]*?\$\$;/.exec(sql);
  if (!m) throw new Error('switch_my_organization not found in the migration');
  return m[0];
}

describe('switch_my_organization refusals', () => {
  it('parses every token the function raises', () => {
    const body = switchBody();
    for (const token of ['not_a_member', 'org_access_ended', 'account_inactive']) {
      expect(body).toContain(`'${token}`);
    }
  });

  it('turns a token into the sentence after it', () => {
    expect(switchRefusal('not_a_member: this account does not belong to that organization'))
      .toBe('This account does not belong to that organization');
    expect(switchRefusal('org_access_ended: the access period for Acme ended on 2026-10-01 00:00 UTC — renew it'))
      .toBe('The access period for Acme ended on 2026-10-01 00:00 UTC — renew it');
    expect(switchRefusal('account_inactive')).toBe('This account is not active.');
  });

  it('keeps any other error as it came', () => {
    expect(switchRefusal('network down')).toBe('network down');
    expect(switchRefusal(undefined)).toBe('Could not switch organization.');
  });
});

describe('the project selection a switch forgets', () => {
  it('names the keys the app actually writes', () => {
    const written = [
      read('src/hooks/useGlobalProject.tsx'),
      read('src/pages/DataManager.tsx'),
    ].join('\n');
    for (const key of PROJECT_SELECTION_KEYS) expect(written).toContain(`'${key}'`);
  });

  it('removes them', () => {
    const store = new Map<string, string>(PROJECT_SELECTION_KEYS.map((k) => [k, 'x']));
    store.set('unrelated', 'kept');
    const original = globalThis.localStorage;
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: { removeItem: (k: string) => store.delete(k) },
    });
    try {
      forgetProjectSelection();
    } finally {
      Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: original });
    }
    expect([...store.keys()]).toEqual(['unrelated']);
  });
});
