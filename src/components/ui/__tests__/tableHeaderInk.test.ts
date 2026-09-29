/**
 * TABLE HEADER INK — the column labels must stay readable.
 *
 * `TableHeader` paints an ink block and `TableHead` sets its labels white. A caller
 * that passes a light background to the header (`bg-background`, `bg-white`, …)
 * keeps the white text and loses the ink, so every column label renders white on
 * white. That is how /project-manager's data viewer and the upload wizard's
 * previews lost their headers. This gate refuses the override anywhere in `src/`.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const LIGHT_BG = /\bbg-(background|white|card|muted|popover|secondary)\b/;
const HEADER_TAG = /<TableHeader\b[^>]*>/g;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return e.name === 'node_modules' ? [] : sourceFiles(p);
    return /\.tsx$/.test(e.name) ? [p] : [];
  });
}

describe('TableHeader keeps its ink background', () => {
  it('no caller overrides the header with a light background', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles('src')) {
      const text = readFileSync(file, 'utf8');
      for (const m of text.matchAll(HEADER_TAG)) {
        if (LIGHT_BG.test(m[0])) {
          const line = text.slice(0, m.index).split('\n').length;
          offenders.push(`${file}:${line}  ${m[0].trim()}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
