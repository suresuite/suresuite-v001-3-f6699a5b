/**
 * ONE PALETTE — Phase 8 / WP 8.3 / §4 D112.
 *
 * Five palettes drew the same supply chain in four pages and a map component, and
 * they agreed on nothing: the same firm was green on one screen, blue on another,
 * brown on a third, and a deliberately different HSL on the map. A user reasonably
 * concluded the screens were about different things.
 *
 * Colour encodes CATEGORY, the category is the echelon, and `src/lib/graph/palette.ts`
 * holds one colour per echelon. This gate is the ratchet that gets the pages there:
 * it counts colour LITERALS per file, the counts may fall and may never rise, and a
 * count lower than the baseline fails too so the baseline cannot go stale.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ECHELONS } from '../types';
import { ECHELON_COLOR, ECHELON_LABEL, colorForEchelon, labelForEchelon } from '../palette';

/** A colour written into a component: a hex literal or an `hsl(...)` call. */
const COLOR_LITERAL = /#[0-9a-fA-F]{3,8}\b|hsl\(/g;

/** Counted on the day the gate landed. Each must fall to 0 as its page migrates. */
const BASELINE: Record<string, number> = {
  'src/pages/ProductLevelNetwork.tsx': 11,
  'src/pages/ProcessLevelNetwork.tsx': 32,
  'src/pages/FirmLevelNetwork.tsx': 13,
  'src/pages/InteractiveNetworkSpace.tsx': 16,
  'src/components/MapView.tsx': 18,
};

function countColors(path: string): number {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return 0;
  }
  return (text.match(COLOR_LITERAL) ?? []).length;
}

describe('one palette — the ratchet', () => {
  for (const [path, expected] of Object.entries(BASELINE)) {
    it(`${path} holds no MORE colour literals than its baseline (${expected})`, () => {
      const actual = countColors(path);
      expect(
        actual,
        `${path} holds ${actual} colour literal(s), baseline ${expected}. Colour encodes ` +
          `the echelon and there is one palette: import \`colorForEchelon\` from ` +
          `\`@/lib/graph\`. §4 D112 is what five palettes cost.`,
      ).toBeLessThanOrEqual(expected);
    });

    it(`${path} — the baseline is not stale`, () => {
      const actual = countColors(path);
      expect(
        actual,
        `${path} is down to ${actual} colour literal(s) from a baseline of ${expected}. ` +
          `Good — now lower the baseline in onePalette.test.ts in the same commit.`,
      ).toBe(expected);
    });
  }

  it('the palette covers every echelon, with no gaps and no extras', () => {
    expect(Object.keys(ECHELON_COLOR).sort()).toEqual([...ECHELONS].sort());
    expect(Object.keys(ECHELON_LABEL).sort()).toEqual([...ECHELONS].sort());
  });

  it('every echelon gets a DISTINCT colour — a palette with a collision is one short', () => {
    const values = Object.values(ECHELON_COLOR);
    expect(new Set(values).size).toBe(values.length);
  });

  it('an unknown role renders as unknown and is never defaulted to a category (T1)', () => {
    // `ProductLevelNetwork` defaults an unrecognised node to Supplier today. That is
    // a value displayed for data that does not carry it, and it is the single most
    // common way this area misleads a reader.
    expect(colorForEchelon(null)).toBe(ECHELON_COLOR.unknown);
    expect(colorForEchelon(null)).not.toBe(ECHELON_COLOR.supplier);
    expect(labelForEchelon(null)).toBe('Unknown');
  });

  it('no label is an engine name or a level number', () => {
    for (const label of Object.values(ECHELON_LABEL)) {
      expect(label).not.toMatch(/level|tier|\d/i);
    }
  });

  it('the gate can fail — proved rather than asserted', () => {
    expect(('const c = "#ff0000";'.match(COLOR_LITERAL) ?? []).length).toBe(1);
    expect(('background: hsl(48, 96%, 50%)'.match(COLOR_LITERAL) ?? []).length).toBe(1);
    expect(('const c = colorForEchelon(n.echelon);'.match(COLOR_LITERAL) ?? []).length).toBe(0);
  });
});
