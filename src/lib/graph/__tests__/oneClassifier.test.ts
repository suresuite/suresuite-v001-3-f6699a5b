/**
 * EIGHT BECAME ONE, AND THIS IS WHAT STOPS ONE BECOMING NINE.
 * Phase 8 / WP 8.3 / §4 D127.
 *
 * A node's type was authored eight times — once in SQL, four times across the
 * network pages, once in the map component, once in the engine — and the eight
 * disagreed by construction, because none of them READ a type: they each inferred
 * one at render time, from a different signal. WP 8.1 authored the answer once, in
 * `node_list.echelon`. WP 8.3 gives the pages one module to read it through.
 *
 * WHY THIS IS A RATCHET AND NOT AN ASSERTION OF ZERO. Deleting a page's classifier
 * before the column it would read is populated for every project in production is a
 * change nobody can verify — and D88 is what shipping the unverifiable half looks
 * like. So the list below is the state on the day the gate landed. It may SHRINK.
 * It may never grow, and a count LOWER than the baseline fails too, because a
 * baseline that silently absorbs a deletion stops describing anything (this is the
 * same rule `scripts/typecheck-baseline.json` runs on, for the same reason).
 *
 * To migrate a page: delete its classifier, read `echelon` from `node_list`, and
 * remove its line here. The diff is then one line of gate for one classifier gone,
 * which is what makes progress countable rather than described (§4 D90's lesson).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * A classifier is a function that decides what a node IS from something other
 * than `echelon`. Matched on the DECLARATION, not on a call, so a page that keeps
 * calling a shared helper does not count and a page that grows its own does.
 */
const CLASSIFIER_DECL =
  /^\s*(?:export\s+)?(?:function|const)\s+(getNodeTypeFromLevel|getDisplayNodeType|buildGroupClassification|getTierFromDepth|getLocationGroup|classifyNodeType|nodeTypeFor|inferNodeType)\b/;

/** The state on the day this gate landed. One name per classifier still in place. */
const BASELINE: Record<string, string[]> = {
  'src/pages/ProductLevelNetwork.tsx': ['buildGroupClassification', 'getLocationGroup'],
  'src/pages/ProcessLevelNetwork.tsx': ['getNodeTypeFromLevel', 'getDisplayNodeType'],
  'src/pages/FirmLevelNetwork.tsx': ['getTierFromDepth'],
  'src/pages/InteractiveNetworkSpace.tsx': ['getNodeTypeFromLevel'],
};

/** Files that must never declare one at all — including this module's own folder. */
const FORBIDDEN_EVERYWHERE = ['src/components/MapView.tsx'];

function declaredIn(path: string): string[] {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return [];
  }
  const found: string[] = [];
  for (const line of text.split('\n')) {
    const m = line.match(CLASSIFIER_DECL);
    if (m) found.push(m[1]);
  }
  return found.sort();
}

describe('one classifier — the ratchet that stops eight becoming nine', () => {
  for (const [path, expected] of Object.entries(BASELINE)) {
    it(`${path} declares no MORE classifiers than its baseline`, () => {
      const actual = declaredIn(path);
      const added = actual.filter((n) => !expected.includes(n));
      expect(
        added,
        `${path} declares a node-type classifier that is not in this gate's baseline. ` +
          `A node's type is authored once, in \`node_list.echelon\` (WP 8.1) — read it, ` +
          `do not infer it. §4 D127 is what eight of these cost: the same node resolves ` +
          `to four different types on four screens, and §15 measured 65 nodes on one ` +
          `project where it actually happens.`,
      ).toEqual([]);
    });

    it(`${path} — the baseline is not stale`, () => {
      const actual = declaredIn(path);
      const removed = expected.filter((n) => !actual.includes(n));
      expect(
        removed,
        `${path} no longer declares ${removed.join(', ')} — which is GOOD, and the ` +
          `baseline in oneClassifier.test.ts must shrink to match in the same commit. ` +
          `A baseline that silently absorbs a deletion stops describing anything.`,
      ).toEqual([]);
    });
  }

  for (const path of FORBIDDEN_EVERYWHERE) {
    it(`${path} declares no classifier at all`, () => {
      expect(declaredIn(path)).toEqual([]);
    });
  }

  it('the graph layer itself declares none — it reads `echelon`, it does not derive it', () => {
    for (const f of ['types.ts', 'palette.ts', 'encoding.ts', 'subgraph.ts', 'focus.ts']) {
      expect(declaredIn(`src/lib/graph/${f}`), `src/lib/graph/${f}`).toEqual([]);
    }
  });

  it('the gate can fail — proved on a synthetic line rather than asserted', () => {
    // A gate nobody has seen fail is a gate that might match nothing at all.
    expect('function getNodeTypeFromLevel(level: number) {'.match(CLASSIFIER_DECL)?.[1]).toBe(
      'getNodeTypeFromLevel',
    );
    expect('  const getTierFromDepth = (d: number) => d'.match(CLASSIFIER_DECL)?.[1]).toBe(
      'getTierFromDepth',
    );
    // …and that it does not fire on a CALL, only on a declaration.
    expect('const t = getNodeTypeFromLevel(3, "bom", "from");'.match(CLASSIFIER_DECL)).toBeNull();
  });

  it('the baseline totals the eight D127 counts, minus the two that are not in src/', () => {
    // SQL's `classify_node_echelon` and the engine's master-table read are the other
    // two of the eight. Six are in `src/`, and this is the number that must fall.
    const total = Object.values(BASELINE).reduce((a, names) => a + names.length, 0);
    expect(total).toBe(6);
  });
});
