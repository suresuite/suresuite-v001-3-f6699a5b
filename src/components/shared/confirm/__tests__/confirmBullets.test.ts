/**
 * CONFIRMSHEET — the bullets are the existing confirm text, and no native
 * `confirm()` is left to bypass the sheet (mobile redesign handoff §2.3).
 *
 * The sheet may not add a claim: every bullet must be a sentence of the
 * message the desktop shows. The dot colour is derived from the sentence, so
 * it is pinned here against the app's real messages rather than examples.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/integrations/supabase/client', () => ({ supabase: {} }));
import { deletionConfirmMessage, deletionConfirmTitle } from '@/lib/projects/projectDeletion';
import { reuseConfirmRequest, reusePromptText } from '@/lib/sim/dispatch';
import { bulletTone, confirmBullets } from '../confirmBullets';

describe('confirmBullets', () => {
  it('drops the leading question the title restates, and splits the rest by sentence', () => {
    const lead = 'Delete project "Lyon Inc. Plant"?';
    const b = confirmBullets(`${lead} All its data will be removed. This cannot be undone.`, { lead });
    expect(b).toEqual([
      { text: 'All its data will be removed.', tone: 'red' },
      { text: 'This cannot be undone.', tone: 'red' },
    ]);
  });

  it('a name with a full stop in the question does not split it', () => {
    const lead = 'Remove Sofia from Contoso Inc. GmbH?';
    const b = confirmBullets(`${lead} They stop seeing its projects. Project memberships are kept.`, { lead });
    expect(b.map((x) => x.text)).toEqual(['They stop seeing its projects.', 'Project memberships are kept.']);
    expect(b.every((x) => x.tone === 'amber')).toBe(true);
  });

  it('project deletion: red for what is deleted, amber for what is kept or detached', () => {
    const name = 'Acme EU';
    const b = confirmBullets(deletionConfirmMessage(name), { lead: deletionConfirmTitle(name) });
    expect(b[0]).toEqual({ text: 'This cannot be undone.', tone: 'red' });
    expect(b.find((x) => x.text.startsWith('Deleted:'))?.tone).toBe('red');
    expect(b.find((x) => x.text.startsWith('Kept:'))?.tone).toBe('amber');
    expect(b.find((x) => x.text.startsWith('Detached, not deleted:'))?.tone).toBe('amber');
    // Nothing invented: every bullet is a substring of the desktop message.
    for (const x of b) expect(deletionConfirmMessage(name)).toContain(x.text);
  });

  it('the reuse prompt: neutral dots, and the OK / Cancel legend renamed to the buttons', () => {
    const c = { ended_at: null, rep_count_done: 10, code_version: '0.2.8' };
    const req = reuseConfirmRequest(c);
    expect(req.message).toBe(reusePromptText(c));
    expect(req.dismissible).toBe(false);
    const b = confirmBullets(req.message, {
      lead: req.title,
      neutral: true,
      actionLabel: req.actionLabel,
      cancelLabel: req.cancelLabel,
    });
    expect(b.every((x) => x.tone === 'neutral')).toBe(true);
    expect(b.map((x) => x.text)).toEqual([
      'Identical results already exist from earlier (10 replication(s), engine 0.2.8).',
      'Reuse results — reuse the stored results (no recompute).',
      'Re-run — re-run the simulation from scratch.',
    ]);
  });

  it('tones', () => {
    expect(bulletTone('This action cannot be undone.')).toBe('red');
    expect(bulletTone('It is their default organization; they will have none until another is set.')).toBe('amber');
    expect(bulletTone('It is their active organization, so they move to their default, Contoso.')).toBe('amber');
  });
});

describe('no native confirm() is left on a path a phone can reach', () => {
  function sourceFiles(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const p = join(dir, e.name);
      if (e.isDirectory()) return e.name === '__tests__' ? [] : sourceFiles(p);
      return /\.tsx?$/.test(e.name) ? [p] : [];
    });
  }

  it('every confirmation goes through useConfirm()', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles('src')) {
      // The provider's desktop branch is the one call that is meant to be native.
      if (file.endsWith(join('confirm', 'ConfirmProvider.tsx')) || file.endsWith(join('confirm', 'useConfirm.ts'))) continue;
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
          if (/\bwindow\.confirm\(|(?<![.\w])confirm\((?!\{|reuseConfirmRequest)/.test(line)) offenders.push(`${file}:${i + 1}`);
        });
    }
    expect(offenders).toEqual([]);
  });
});
