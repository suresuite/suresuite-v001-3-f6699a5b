/**
 * The shared graph layer — Phase 8 / WP 8.3 / §4 D127.
 *
 * One vocabulary, one palette, one set of encodings, one subgraph engine and one
 * focus walk, for every page that draws a supply network. Before this module there
 * were eight node-type classifiers and five palettes across four pages, a map
 * component, one SQL function and the engine, and they disagreed by construction.
 *
 * `useGraphNodes` is deliberately NOT re-exported here. It imports the Supabase
 * client, which reads `localStorage` at module scope — so a barrel that carried it
 * would make `@/lib/graph` un-importable from any non-DOM context, including a plain
 * vitest run. Found by importing the barrel from a test. Import the hook by path:
 * `import { useGraphNodes } from '@/lib/graph/useGraphNodes'`.
 *
 * Two gates keep it that way: `oneClassifier.test.ts` (no classifier outside this
 * folder) and `onePalette.test.ts` (no colour literal in a network page). Both are
 * RATCHETS — they carry the list of pages not yet migrated, the list may shrink and
 * may never grow, and one name fewer than the baseline also fails.
 */
export * from './types';
export * from './palette';
export * from './encoding';
export * from './subgraph';
export * from './focus';
export * from './echelon';
export * from './productGraph';
