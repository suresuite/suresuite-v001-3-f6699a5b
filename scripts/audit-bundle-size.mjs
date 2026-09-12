#!/usr/bin/env node
// Bundle-size guard — keeps the Phase 1 load-performance work from decaying.
//
// Run:  npm run build && node scripts/audit-bundle-size.mjs
//       node scripts/audit-bundle-size.mjs --all              (ignore the baseline)
//       node scripts/audit-bundle-size.mjs --update-baseline  (re-record it)
// CI:   .github/workflows/bundle-audit.yml; exits 1 on any growth above baseline.
//
// WHY THIS EXISTS
// Before Phase 1 the app shipped every route, three.js and mapbox-gl in one
// eager bundle: `src/App.tsx` imported all 25 pages at module scope, so a phone
// opening /auth downloaded and parsed a WebGL globe it would never render.
// Code-splitting fixed that once. Nothing stopped it coming back — one
// top-level `import` in the wrong file silently re-merges a lazy chunk into the
// entry graph, and no reviewer can see that in a diff.
//
// This script can. It measures the INITIAL graph — the entry chunk plus
// everything statically reachable from it — which is exactly the bytes a user
// waits for before first paint. A lazy chunk growing is not a regression; a
// lazy chunk becoming reachable from the entry is, and only the graph shows it.
//
// WHAT IT MEASURES
// Gzip bytes, because that is what crosses the network. Sizes come from
// `dist/.vite/manifest.json`, so the import graph is Vite's own, not a guess
// parsed out of filenames.
//
// WHAT IT DELIBERATELY DOES NOT SEE
// Not CSS, not images, not runtime cost. JS is the dominant and the regressing
// term here, and a gate that measures six things is a gate people learn to
// re-record. Execution time on a mid-tier phone is the other half of this and
// it needs a real device — see docs/mobile-ui-spec.md §7.
//
// THE BASELINE
// `bundle-size-baseline.json` records gzip bytes per tracked key. The audit
// fails only ABOVE baseline + TOLERANCE, so an unrelated dependency bump does
// not fail an unrelated PR, and the number can never drift upward unnoticed.
// Ratchet it DOWN by improving the split and re-running with --update-baseline.
// Never re-record to admit a regression.

import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { gzipSync } from 'node:zlib';

const ROOT = process.cwd();
const DIST = join(ROOT, 'dist');
const MANIFEST = join(DIST, '.vite', 'manifest.json');
const BASELINE = join(ROOT, 'scripts', 'bundle-size-baseline.json');

const ARGV = new Set(process.argv.slice(2));
const IGNORE_BASELINE = ARGV.has('--all');
const UPDATE_BASELINE = ARGV.has('--update-baseline');

// Growth under this is noise — a dependency patch, a changed string. Above it
// is someone's import. 5% or 2 kB, whichever is larger, per tracked key.
const TOLERANCE_PCT = 0.05;
const TOLERANCE_MIN_BYTES = 2048;

// A lazy chunk bigger than this is worth a look even though it is off the
// critical path: it is one `import` away from being on it.
const FAT_CHUNK_GZIP = 300 * 1024;

if (!existsSync(MANIFEST)) {
  console.error(
    `\nNo build manifest at ${relative(ROOT, MANIFEST)}.\n` +
    `Run \`npm run build\` first — this audit measures dist/, not source.\n`,
  );
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));

const gzipOf = (file) => {
  const abs = join(DIST, file);
  if (!existsSync(abs) || !statSync(abs).isFile()) return 0;
  return gzipSync(readFileSync(abs)).length;
};

/** Entry chunk plus every chunk statically reachable from it — the bytes that
 *  block first paint. `imports` is static; `dynamicImports` is deliberately NOT
 *  followed, because that is the whole point of a lazy route. */
function initialGraph(entryKey) {
  const seen = new Set();
  const walk = (key) => {
    if (seen.has(key)) return;
    seen.add(key);
    for (const dep of manifest[key]?.imports ?? []) walk(dep);
  };
  walk(entryKey);
  return [...seen];
}

const entryKey = Object.keys(manifest).find((k) => manifest[k].isEntry);
if (!entryKey) {
  console.error('\nNo entry chunk in the manifest — cannot determine the initial graph.\n');
  process.exit(1);
}

const initialKeys = initialGraph(entryKey);
const initialFiles = initialKeys.map((k) => manifest[k].file);
const initialBytes = initialFiles.reduce((sum, f) => sum + gzipOf(f), 0);

// Every emitted JS chunk, for the total and for the fat-chunk note.
const allChunks = Object.values(manifest)
  .filter((c) => c.file?.endsWith('.js'))
  .map((c) => ({ file: c.file, gzip: gzipOf(c.file) }));
const totalBytes = allChunks.reduce((sum, c) => sum + c.gzip, 0);

// Two keys, both about the shape of the split rather than the size of any one
// file: what a first visit costs, and whether the whole app is growing.
const measured = {
  'initial-graph': initialBytes,
  'total-js': totalBytes,
};

const kb = (n) => `${(n / 1024).toFixed(1)} kB`;

if (UPDATE_BASELINE) {
  writeFileSync(BASELINE, JSON.stringify({
    note: 'Gzip bytes. `initial-graph` is the entry chunk plus its static imports — '
        + 'what a first visit downloads before paint. The audit fails only ABOVE '
        + 'these numbers plus tolerance. Ratchet down by improving the split and '
        + 're-running with --update-baseline; never re-record to admit a regression.',
    generated: new Date().toISOString().slice(0, 10),
    tolerance: `${TOLERANCE_PCT * 100}% or ${TOLERANCE_MIN_BYTES} bytes, whichever is larger`,
    sizes: measured,
  }, null, 2) + '\n');
  console.log('baseline recorded —');
  for (const [k, v] of Object.entries(measured)) console.log(`  ${k}  ${kb(v)}`);
  process.exit(0);
}

const baseline = !IGNORE_BASELINE && existsSync(BASELINE)
  ? JSON.parse(readFileSync(BASELINE, 'utf8')).sizes || {}
  : {};

const failures = [];
for (const [k, now] of Object.entries(measured)) {
  const was = baseline[k];
  if (was === undefined) continue;
  const allowed = was + Math.max(was * TOLERANCE_PCT, TOLERANCE_MIN_BYTES);
  if (now > allowed) failures.push({ key: k, now, was, allowed });
}

// ── Report ────────────────────────────────────────────────────────────────
console.log(`\nBundle size — ${allChunks.length} JS chunk(s)`);
console.log(`  initial graph   ${kb(initialBytes)}  (${initialKeys.length} chunk(s), gzip)`);
console.log(`  total JS        ${kb(totalBytes)}  (gzip)`);

const fat = allChunks.filter((c) => c.gzip >= FAT_CHUNK_GZIP).sort((a, b) => b.gzip - a.gzip);
if (fat.length) {
  console.log('\n  Largest chunks — off the critical path, but one import away from it:');
  for (const c of fat) console.log(`    ${kb(c.gzip).padStart(9)}  ${c.file}`);
}

if (!failures.length) {
  console.log(`\n✓ bundle audit clean — nothing above ${relative(ROOT, BASELINE)}\n`);
  process.exit(0);
}

console.log('');
for (const f of failures) {
  console.log(`✗ ${f.key} grew to ${kb(f.now)} — baseline ${kb(f.was)}, ceiling ${kb(f.allowed)}`);
}
console.log('');
console.log('If this is the initial graph, something now imports at module scope what');
console.log('used to be lazy. Find it before re-recording: a static `import` of a page,');
console.log('of MapView, or of NetworkVisualization3D will do it. Re-record only when');
console.log('the growth is deliberate and understood.\n');
process.exit(1);
