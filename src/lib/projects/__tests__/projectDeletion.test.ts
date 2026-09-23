/**
 * F-27 (audit 2026-09-22) — one delete confirmation, stating the scope.
 *
 * "Delete project X and all of its data?" was written out at three call sites in
 * two components and said nothing about what survives a deletion: the account's
 * usage logs are kept by decision (D117) and chat threads and uploaded files are
 * detached rather than deleted. The scope is read from the derived
 * `PROJECT_DELETION`, the same numbers the manual publishes.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PROJECT_DELETION } from '@/components/docs/generated/policy.generated';
import { deletionConfirmMessage } from '../projectDeletion';

describe('F-27 — one confirmation, stating the scope', () => {
  const msg = deletionConfirmMessage('Acme EU');

  it('names the project and says it cannot be undone', () => {
    expect(msg).toContain('"Acme EU"');
    expect(msg).toMatch(/cannot be undone/i);
  });

  it('states what is deleted, kept and detached — from the derived scope', () => {
    const deleted =
      PROJECT_DELETION.projectScoped - PROJECT_DELETION.neither.length - PROJECT_DELETION.detached.length;
    expect(msg).toContain(`${deleted} tables`);
    expect(msg).toMatch(/policy decisions/i);
    expect(msg).toMatch(/simulation runs/i);
    for (const t of PROJECT_DELETION.neither) expect(msg).toContain(t);
    expect(msg).toMatch(/chat threads/i);
    expect(msg).toMatch(/uploaded files/i);
  });

  it('no component writes its own delete-confirmation literal', () => {
    for (const f of ['src/pages/DataManager.tsx', 'src/components/ProjectCard.tsx']) {
      const src = readFileSync(f, 'utf8');
      expect(src, f).not.toMatch(/confirm\(`Delete project/);
      expect(src, f).toMatch(/confirmProjectDeletion\(/);
    }
  });
});
