#!/usr/bin/env node
// Adaptive-UI guard — enforces the mechanical rules in docs/mobile-ui-spec.md.
//
// Run:  node scripts/audit-adaptive-ui.mjs
//       node scripts/audit-adaptive-ui.mjs --all              (ignore the baseline)
//       node scripts/audit-adaptive-ui.mjs --update-baseline  (re-record it)
// CI:   .github/workflows/ui-audit.yml; exits 1 on any violation above baseline.
//
// WHY THIS EXISTS
// Every rule below was written down first and then broken anyway. A static
// audit found three whole classes of defect that review had passed: emoji in
// product copy, `shrink-0` on unbounded text (including a project name, which
// is user data and therefore arbitrarily long), and sub-44px touch targets.
//
// Rules in a document get forgotten. This script does not.
//
// SCOPE
// It checks only what can be checked statically and unambiguously. It does
// NOT check contrast, reading order, or whether a short label is still
// unambiguous — those need eyes. It is a floor, not a substitute for §7.
//
// WHAT IT DELIBERATELY DOES NOT SEE
// Every rule here is about what the product RENDERS. So the source is passed
// through a string-aware comment stripper first, and the emoji rule skips
// `console.*` lines. Without that, the audit fires on a comment describing a
// rule, on `--shadow-lg:` in index.css, and on 152 debug logs — and an audit
// that cries wolf is one people learn to skip. Narrowing a rule to its actual
// subject is not loosening it. Loosening it would be widening MARKETING or
// weakening a pattern to make a real hit go away; do neither.
//
// THE BASELINE
// This lands on a codebase with a backlog. `adaptive-ui-baseline.json` records
// the known count per file per rule; the audit fails only on anything ABOVE
// it, so the gate is green on arrival and can never go backwards. Fixing a
// file and re-recording ratchets it down. Never re-record to admit a new hit.

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative, extname } from 'node:path';

const ROOT = process.cwd();
const SRC = join(ROOT, 'src');
const BASELINE = join(ROOT, 'scripts', 'adaptive-ui-baseline.json');
const EXT = new Set(['.tsx', '.ts', '.css']);

const ARGV = new Set(process.argv.slice(2));
const IGNORE_BASELINE = ARGV.has('--all');
const UPDATE_BASELINE = ARGV.has('--update-baseline');

// Landing, /auth and the fixed footer are the sanctioned homes for black
// bands, gradients and marketing-scale type (audit C6, guide §3.2).
const MARKETING = /src[\\/](pages[\\/](Landing|Auth|About)|components[\\/](AuthHeroStrip|Footer|NetworkVisualization3D))/;

/**
 * Blank out comments, preserving every byte offset and line break so reported
 * line numbers stay true. String-aware: a `//` inside a quoted string or after
 * a `:` (a URL) is not a comment. `css` files have no line comments.
 */
function stripComments(src, { lineComments }) {
  const out = src.split('');
  let i = 0;
  const n = src.length;
  const blank = (from, to) => {
    for (let k = from; k < to; k++) if (out[k] !== '\n') out[k] = ' ';
  };
  while (i < n) {
    const c = src[i];
    if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      i++;
      while (i < n) {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === quote) { i++; break; }
        i++;
      }
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end === -1 ? n : end + 2;
      blank(i, stop);
      i = stop;
      continue;
    }
    if (lineComments && c === '/' && src[i + 1] === '/' && src[i - 1] !== ':') {
      let end = src.indexOf('\n', i);
      if (end === -1) end = n;
      blank(i, end);
      i = end;
      continue;
    }
    i++;
  }
  return out.join('');
}

const files = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (EXT.has(extname(p))) files.push(p);
  }
})(SRC);

const violations = [];
const report = (file, line, rule, sec, detail) =>
  violations.push({ file: relative(ROOT, file).split('\\').join('/'), line, rule, sec, detail });

for (const file of files) {
  const raw = readFileSync(file, 'utf8');
  const isCss = extname(file) === '.css';
  const src = stripComments(raw, { lineComments: !isCss });
  const lines = src.split('\n');
  const isMarketing = MARKETING.test(file);

  lines.forEach((text, i) => {
    const ln = i + 1;

    // ── §3.5 Emoji. The product's own audit files an emoji in an alert body
    // as a defect. Functional Unicode marks are fine and are allowlisted.
    // Debug logging is not product copy, so `console.*` is out of subject.
    // Monochrome functional marks, not emoji — §6 permits these by kind, and
    // its list is illustrative. A tick and a cross in a completeness column
    // are the same family as the arrows; a coloured ✅ is not. The ceiling and
    // floor brackets are mathematical notation in the policy formulas.
    const ALLOWED_MARKS = /[▲▼›▸▾≈⚠→←·—✕↑↓✓✗○●◦⌈⌉⌊⌋]/g;
    if (!/\bconsole\s*\./.test(text)) {
      const stripped = text.replace(ALLOWED_MARKS, '');
      const emoji = stripped.match(
        // 2300-23FF and 2600-26FF are in the net because the product had a
        // clock and a scales glyph the narrower ranges walked straight past.
        /[\u{1F300}-\u{1FAFF}\u{1F900}-\u{1F9FF}\u{2300}-\u{23FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}]/gu,
      );
      if (emoji) report(file, ln, 'Emoji', '3.5', [...new Set(emoji)].join(' '));
    }

    // ── §2.3 Bare 1fr. `min-width:auto` floors the track at its widest
    // child, which is what turns a "responsive" grid into a sideways scroll.
    const gridCols = /grid-cols-\[([^\]]+)\]|gridTemplateColumns:\s*['"`]([^'"`]+)/.exec(text);
    if (gridCols) {
      const v = gridCols[1] || gridCols[2] || '';
      if (/\b1fr\b/.test(v) && !/minmax\(/.test(v)) {
        report(file, ln, 'Bare 1fr in grid — use minmax(0,1fr)', '2.3', v.slice(0, 60));
      }
    }

    // ── §2.5 shrink-0 on text. Only flagged when the same element carries a
    // JSX interpolation, which is the unbounded case: a project name, a user
    // query, a filename. Static button labels are legitimately shrink-0.
    //
    // Two things are not that. An interpolation that is a PROP is not content:
    // `${SMALL_TXT}` inside a className template is a class fragment, and
    // key/ref/value are attributes — the element may hold nothing but an icon.
    // (Template literals go first, so a nested ${...} cannot end the prop
    // match early.) And §2.5 permits shrink-0 on "fixed-width chrome" in as
    // many words, so an explicit w-* on the same element is the rule being
    // followed, not broken.
    const withoutProps = text
      .replace(/`[^`]*`/g, '')
      .replace(/\b(?:key|ref|value)=\{[^}]*\}/g, '');
    const fixedWidth = /\bw-(?:\d|\[)/.test(text);
    if (/\bshrink-0\b/.test(text) && /\{[a-zA-Z_$][\w$.?[\]']*\}/.test(withoutProps) && !fixedWidth) {
      const looksLikeIcon = /className="[^"]*\bh-\d|<[A-Z]\w+\s|Icon|Chevron|aria-hidden/.test(text);
      if (!looksLikeIcon) {
        report(file, ln, 'shrink-0 on interpolated (unbounded) text', '2.5', text.trim().slice(0, 70));
      }
    }

    // ── §2.4 Touch targets. h-8/h-9 is CORRECT at md+ (audit C3), so only
    // flag a small height that is not released or paired with a md: override.
    const small = /\b(?:min-)?h-(?:8|9|10)\b/.exec(text);
    if (small && !isMarketing) {
      const hasMobileFloor = /\b(?:min-)?h-11\b|min-h-\[44|md:h-(?:8|9|10)\b/.test(text);
      if (!hasMobileFloor) {
        report(file, ln, `${small[0]} with no 44px mobile floor`, '2.4',
          'add h-11 md:' + small[0] + ', or min-h-11 md:min-h-0');
      }
    }

    // ── §3.3 Numbers must never be shortened to fit.
    if (/\b\w*(?:value|count|total|cost|rate|qty|amount)\w*\s*\.slice\(0,\s*\d+\)/i.test(text)) {
      report(file, ln, 'Possible truncated numeric value', '3.3', text.trim().slice(0, 70));
    }
    if (/toFixed\(0\)|Math\.round/.test(text) && /display|label|render/i.test(text)) {
      report(file, ln, 'Possible rounded display number', '3.3', text.trim().slice(0, 70));
    }

    // ── §6 Second breakpoint. `sm:` is allowed ONLY for the label swap.
    // Matched as a Tailwind variant proper: preceded by a string or call
    // boundary, and followed immediately by the utility with no space. That
    // is what separates `lg:hidden` from the custom property `--shadow-lg:`
    // and from shadcn's size map key `lg: "h-12 …"`, neither of which is a
    // breakpoint at all.
    const bp = !isCss && /(?:^|[\s"'`({[])(lg|xl|2xl):(?=[a-z[-])/.exec(text);
    if (bp && !isMarketing) {
      report(file, ln, `Second breakpoint "${bp[1]}:" — the product has one (md)`, '6', text.trim().slice(0, 60));
    }

    // ── §6 Radii stop at 8px in app surfaces.
    const radius = /\brounded-(xl|2xl|3xl)\b/.exec(text);
    if (radius && !isMarketing && !/GettingStarted/.test(file)) {
      report(file, ln, `rounded-${radius[1]} — app radii stop at 8px (rounded-lg)`, '6', text.trim().slice(0, 60));
    }

    // ── C6 bg-black / text-white outside the sanctioned surfaces.
    if (/\b(bg-black|text-white)\b/.test(text) && !isMarketing) {
      report(file, ln, 'bg-black/text-white outside landing, /auth and Footer', 'C6', text.trim().slice(0, 60));
    }

    // ── §6 Filled default badges.
    if (/<Badge(?![^>]*variant)/.test(text)) {
      report(file, ln, 'Badge with no variant — filled default is not the language', 'C8',
        'use secondary | outline | destructive');
    }

    // ── §2.6 Bottom-pinned chrome must keep the safe-area inset. Unprefixed
    // `bottom-0` only: an element that is `top-0` on mobile and `sm:bottom-0`
    // above it is not sitting on the home indicator.
    if (/\bfixed\b/.test(text) && /(?:^|[\s"'`({[])bottom-0\b/.test(text) && !/safe-area-inset-bottom/.test(src)) {
      report(file, ln, 'Bottom-pinned element without safe-area-inset-bottom', '2.6', text.trim().slice(0, 60));
    }
  });

  // ── §2.7 A horizontally scrollable table should freeze its first column,
  // otherwise the row loses its identity as soon as you scroll.
  if (/overflow-x-auto/.test(src) && /<table/.test(src) && !/sticky\s+left-0/.test(src)) {
    report(file, 0, 'Scrollable table with no frozen identifying column', '2.7',
      'add `sticky left-0 z-[1] bg-…` to the first th/td');
  }
}

// ── Baseline ──────────────────────────────────────────────────────────────
// Keyed by file + section, counted. Line numbers are deliberately NOT part of
// the key: editing a file above a known hit must not fail the build.
const key = (v) => `${v.file}::${v.sec}`;
const tally = (list) => list.reduce((a, v) => ((a[key(v)] = (a[key(v)] || 0) + 1), a), {});

if (UPDATE_BASELINE) {
  const counts = tally(violations);
  writeFileSync(BASELINE, JSON.stringify({
    note: 'Known adaptive-UI backlog. The audit fails only ABOVE these counts. '
        + 'Ratchet down by fixing a file and re-running with --update-baseline; '
        + 'never re-record to admit a new violation.',
    generated: new Date().toISOString().slice(0, 10),
    total: violations.length,
    counts,
  }, null, 2) + '\n');
  console.log(`baseline recorded — ${violations.length} known violation(s) in ${Object.keys(counts).length} file/section pairs`);
  process.exit(0);
}

const baseline = !IGNORE_BASELINE && existsSync(BASELINE)
  ? JSON.parse(readFileSync(BASELINE, 'utf8')).counts || {}
  : {};

const seen = {};
const fresh = [];
for (const v of violations) {
  const k = key(v);
  seen[k] = (seen[k] || 0) + 1;
  if (seen[k] > (baseline[k] || 0)) fresh.push(v);
}

// ── Report ────────────────────────────────────────────────────────────────
const show = IGNORE_BASELINE ? violations : fresh;
const backlog = violations.length - fresh.length;

const bySection = show.reduce((acc, v) => {
  (acc[v.sec] ||= []).push(v);
  return acc;
}, {});

if (!show.length) {
  console.log(`✓ adaptive-UI audit clean — ${files.length} files, 0 new violation(s)`);
  if (backlog) console.log(`  ${backlog} known violation(s) still in the baseline — see ${relative(ROOT, BASELINE)}`);
  process.exit(0);
}

console.log(`\nAdaptive-UI audit — ${show.length} violation(s) in ${files.length} files`);
if (backlog) console.log(`(${backlog} further known violation(s) held in the baseline)`);
console.log('');
for (const sec of Object.keys(bySection).sort()) {
  console.log(`§${sec}  (${bySection[sec].length})`);
  for (const v of bySection[sec]) {
    console.log(`  ${v.file}${v.line ? ':' + v.line : ''}`);
    console.log(`    ${v.rule}`);
    if (v.detail) console.log(`    → ${v.detail}`);
  }
  console.log('');
}
console.log('Rules: docs/mobile-ui-spec.md. Every one of these was written down');
console.log('before it was broken — fix the code, not the audit.\n');
process.exit(1);
