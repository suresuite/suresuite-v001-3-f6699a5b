#!/usr/bin/env node
// verify-repo.mjs — does the repo match the agreed mobile design?
//
//   cd <repo root> && node path/to/verify-repo.mjs --book path/to/handoff
//
// No dependencies. Reads the repo's own source and the handoff book, and prints
// a pass/fail gate list plus an exit code (0 = all gates pass).
//
// What this can and cannot prove:
//   CAN   — every literal replacement from FINAL.md landed; the iPhone meta tag
//           is present; the adaptive-text baseline has not regressed; #F8D448
//           appears only where the design system sanctions it; no emoji; one
//           breakpoint; agreed copy strings exist in the source.
//   CANNOT — that a screen LOOKS like the demo, or that safe-area insets work on
//           a physical iPhone. Those are layers 2 and 3 in VERIFY.md. A green run
//           here means "nothing we agreed is missing from the code", not
//           "the design is correct".

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const argv = process.argv.slice(2);
const bookDir = (() => {
  const i = argv.indexOf('--book');
  return i >= 0 ? argv[i + 1] : 'handoff';
})();
const showAll = argv.includes('--all');
const REPO = process.cwd();

const read = (p) => { try { return readFileSync(join(REPO, p), 'utf8'); } catch { return null; } };
const readBook = (p) => { try { return readFileSync(join(bookDir, p), 'utf8'); } catch { return null; } };

function walk(dir, out = []) {
  const abs = join(REPO, dir);
  if (!existsSync(abs)) return out;
  for (const name of readdirSync(abs)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const rel = join(dir, name);
    const st = statSync(join(REPO, rel));
    if (st.isDirectory()) walk(rel, out);
    else if (/\.(tsx?|jsx?|css|html)$/.test(name)) out.push(rel);
  }
  return out;
}
const SRC = walk('src').concat(existsSync(join(REPO, 'index.html')) ? ['index.html'] : []);
const fileCache = new Map();
const body = (p) => {
  if (!fileCache.has(p)) fileCache.set(p, read(p) ?? '');
  return fileCache.get(p);
};

const gates = [];
const gate = (id, title, fn) => {
  let res;
  try { res = fn(); } catch (e) { res = { pass: false, detail: ['threw: ' + e.message] }; }
  gates.push({ id, title, ...res });
};

// ── A · the literal replacements from FINAL.md §2.5 / §2.6.1 / §2.6.2 ────────
// Each entry is a string that MUST NO LONGER EXIST once the fix has landed.
// Presence = the fix is outstanding. These are exact strings from the codebase,
// not paraphrases, so a hit is unambiguous.
const OUTSTANDING = [
  ['§2.5 A', 'src/components/policies/PolicySetupBar.tsx',
    'flex w-[192px] shrink-0 flex-col justify-center gap-[3px] pr-2.5',
    'flex w-full min-w-0 flex-col justify-center gap-[3px] pb-2 md:w-[192px] md:shrink-0 md:pb-0 md:pr-2.5'],
  ['§2.5 A', 'src/components/policies/RunValidateStage.tsx',
    'flex w-[192px] shrink-0 flex-col justify-center gap-[3px] pr-2.5',
    'flex w-full min-w-0 flex-col justify-center gap-[3px] pb-2 md:w-[192px] md:shrink-0 md:pb-0 md:pr-2.5'],
  ['§2.6.1', 'src/pages/SimulationLab.tsx',
    '<aside className="w-64 shrink-0">',
    '<aside className="w-full min-w-0 md:w-64 md:shrink-0">'],
  ['§2.6.1', 'src/components/sim/StageRail.tsx',
    'export const RAIL_LABEL_COL = "w-[220px] shrink-0"',
    'export const RAIL_LABEL_COL = "w-full min-w-0 md:w-[220px] md:shrink-0"'],
  ['§2.6.2', 'src/components/policies/ParameterSheet.tsx',
    'className="w-[392px] overflow-y-auto sm:max-w-[392px]"',
    'className="w-full overflow-y-auto sm:w-[392px] sm:max-w-[392px]"'],
  ['§2.6.2', 'src/components/policies/FocusedStage.tsx',
    'className="w-[340px]"',
    'className="w-[min(340px,calc(100vw-1.5rem))]"'],
];

gate('A', 'FINAL.md literal replacements have landed', () => {
  const open = [];
  for (const [ref, file, oldStr, newStr] of OUTSTANDING) {
    const src = body(file);
    if (!src) { open.push(`${file} — FILE MISSING (moved? update this script)`); continue; }
    if (src.includes(oldStr)) open.push(`${ref} ${file}\n        found:   ${oldStr}\n        replace: ${newStr}`);
  }
  return { pass: open.length === 0, detail: open, count: `${OUTSTANDING.length - open.length}/${OUTSTANDING.length} landed` };
});

// ── B · the iPhone defect ────────────────────────────────────────────────────
gate('B', 'viewport-fit=cover on the viewport meta', () => {
  const html = body('index.html');
  const meta = (html.match(/<meta[^>]+name=["']viewport["'][^>]*>/i) || [])[0] || '';
  if (!meta) return { pass: false, detail: ['no viewport meta tag in index.html'] };
  const ok = /viewport-fit\s*=\s*cover/i.test(meta);
  return {
    pass: ok,
    detail: ok ? [] : ['viewport meta present but missing viewport-fit=cover:\n        ' + meta.trim()],
    count: ok ? 'present' : 'MISSING',
  };
});

// ── C · adaptive-text baseline has not regressed ─────────────────────────────
gate('C', 'adaptive-text baseline not regressed', () => {
  const raw = read('scripts/adaptive-ui-baseline.json');
  if (!raw) return { pass: false, detail: ['scripts/adaptive-ui-baseline.json not found'] };
  const b = JSON.parse(raw);
  const AGREED_CEILING = 7; // the count at the 2026-09-06 sync; ratchet DOWN only
  const total = b.total ?? Object.values(b.counts || {}).reduce((a, c) => a + c, 0);
  const over = total > AGREED_CEILING;
  const priority = Object.keys(b.counts || {}).filter((k) => /::3\.3$/.test(k));
  return {
    pass: !over,
    detail: over
      ? [`baseline total ${total} exceeds the agreed ceiling ${AGREED_CEILING} — a violation was admitted, not fixed`]
      : priority.length
        ? priority.map((k) => `still open (priority 1 — a figure is being shortened to fit): ${k}`)
        : [],
    count: `${total} baselined (ceiling ${AGREED_CEILING})`,
    warnOnly: !over && priority.length > 0,
  };
});

// ── D · #F8D448 only where the design system sanctions it ────────────────────
// §3.9: exactly four uses. Anything outside this allowlist is drift.
const YELLOW_ALLOW = [
  ['src/components/admin/adminUi.tsx', 'use 1 — TEMPLATE_BTN'],
  ['src/pages/DeveloperApi.tsx', 'use 1 — TEMPLATE_BTN'],
  ['src/pages/GettingStarted.tsx', 'use 2 — Quick Start step markers'],
  ['src/pages/admin/AdminDashboard.tsx', 'use 3 — emphasis rule'],
  ['src/components/intelligence/piUi.tsx', 'use 4 — LAYER.accent'],
];
gate('D', '#F8D448 confined to its four sanctioned uses', () => {
  const bad = [];
  for (const f of SRC) {
    if (!/F8D448/i.test(body(f))) continue;
    const allowed = YELLOW_ALLOW.find(([p]) => f === p || f.endsWith(p));
    if (!allowed) {
      const lines = body(f).split('\n')
        .map((l, i) => [i + 1, l])
        .filter(([, l]) => /F8D448/i.test(l));
      lines.forEach(([n, l]) => bad.push(`${f}:${n} — not a sanctioned use\n        ${l.trim().slice(0, 120)}`));
    }
  }
  // The prototype has two yellow defects that must NOT be ported in.
  const stepDot = SRC.filter((f) => /STEP_DOT/.test(body(f)) && /awaiting_approval:\s*['"]#F8D448/i.test(body(f)));
  stepDot.forEach((f) => bad.push(`${f} — STEP_DOT.awaiting_approval uses the yellow as a STATUS colour (§3.9: "never a status"). Use #e0930b.`));
  return { pass: bad.length === 0, detail: bad, count: bad.length ? `${bad.length} off-book use(s)` : 'clean' };
});

// ── E · no emoji ─────────────────────────────────────────────────────────────
// §3.5 is about what the product RENDERS, so this gate is scoped to its actual
// subject, matching the rule the repo already enforces in
// scripts/audit-adaptive-ui.mjs (which is in CI as ui-audit.yml):
//
//   · `console.*` lines are debug logging, not product copy — out of subject.
//   · Monochrome functional marks are permitted by kind (§6). A tick in a
//     completeness column is the same family as an arrow; a coloured ✅ is not.
//     The ceiling/floor brackets are notation in the policy formulas.
//   · Comment lines are not rendered.
//
// Read naively this gate reported 221 hits on a repo whose own §3.5 audit is
// clean: 168 debug logs, 41 functional marks, 12 comments. That is the failure
// mode the repo's audit header warns about — "an audit that cries wolf is one
// people learn to skip". Narrowing a rule to its subject is not loosening it;
// loosening it would be dropping a range or exempting a rendered string.
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F000}-\u{1F0FF}]/u;
const ALLOWED_MARKS = /[▲▼›▸▾≈⚠→←·—✕↑↓✓✗○●◦⌈⌉⌊⌋]/g;
const COMMENT_LINE = /^\s*(\/\/|\/?\*|\{\/\*)/;
gate('E', 'no emoji in rendered copy', () => {
  const hits = [];
  for (const f of SRC) {
    body(f).split('\n').forEach((l, i) => {
      if (/\bconsole\s*\./.test(l) || COMMENT_LINE.test(l)) return;
      if (EMOJI.test(l.replace(ALLOWED_MARKS, ''))) hits.push(`${f}:${i + 1} — ${l.trim().slice(0, 100)}`);
    });
  }
  return { pass: hits.length === 0, detail: hits, count: hits.length ? `${hits.length} hit(s)` : 'clean' };
});

// ── F · one breakpoint ───────────────────────────────────────────────────────
// CLAUDE.md: "The product's single breakpoint is 768px. Do not introduce a
// second one." sm:/lg:/xl: on a purely cosmetic property is tolerable; on a
// layout-structural property it means a second breakpoint exists in practice.
gate('F', 'no second structural breakpoint', () => {
  const STRUCTURAL = /\b(sm|lg|xl|2xl):(hidden|block|flex|grid|w-|flex-col|flex-row|absolute|fixed|static|grid-cols-)/;
  const hits = [];
  for (const f of SRC) {
    body(f).split('\n').forEach((l, i) => {
      const m = l.match(STRUCTURAL);
      if (m) hits.push(`${f}:${i + 1} — ${m[0]}   ${l.trim().slice(0, 90)}`);
    });
  }
  // ParameterSheet's sm:w-[392px] is the agreed fix for §2.6.2 — expected.
  const expected = hits.filter((h) => /ParameterSheet|AuthHeroStrip|AdminUserAccess|Landing\.tsx/.test(h));
  const unexpected = hits.filter((h) => !expected.includes(h));
  return {
    pass: true,
    warnOnly: true,
    detail: unexpected.length
      ? [`${unexpected.length} structural non-md breakpoint(s) — review each:`, ...unexpected.slice(0, 25)]
      : [],
    count: `${hits.length} total, ${expected.length} agreed, ${unexpected.length} to review`,
  };
});

// ── G · per-surface acceptance: the agreed detail is IN THE CODE ────────────
// This is the gate that makes the book binding instead of advisory.
//
// Each entry in PAGES.md declares a scope in its `accept:` line:
//   accept: verify <file[,file...]>  mapped to real files, NOT yet enforced.
//                                    Prints the missing strings as a triage
//                                    worklist. Warns; never fails.
//   accept: built <file[,file...]>   triaged and enforced — missing strings FAIL
//                                    the build. This is the deliberate act.
//   accept: pending <why>            no repo interior yet — reported only.
//   accept: none <why>               deliberately not shipping.
//
// Why two stages: the copy decks were extracted from the prototype, so a repo
// screen can legitimately differ (composed labels, split JSX text, or a deck
// string that was prototype-only invention). Marking everything enforced on day
// one would make the build red immediately, and a red build gets switched off.
// So: run it, triage each surface's list, THEN flip verify -> built. Once flipped,
// nobody can quietly drop the agreed detail — the build reads the book.
gate('G', 'per-surface acceptance (agreed copy is in the code)', () => {
  const md = readBook('PAGES.md');
  if (!md) return { pass: false, detail: [`PAGES.md not found under ${bookDir} — pass --book <dir>`], count: 'CANNOT VERIFY' };

  const entries = md.split(/\n## /).slice(1);
  const surfaces = [];
  for (const chunk of entries) {
    const head = chunk.split('\n')[0].trim();
    const accept = (chunk.match(/^accept:\s*(.+)$/m) || [])[1];
    if (!accept) continue;
    const deck = chunk.split('### Copy on this screen')[1];
    const strings = deck
      ? deck.split(/\n### |\n---/)[0].split('\n').filter((l) => /^- /.test(l))
          .map((l) => l.replace(/^- /, '').replace(/\\\|/g, '|').trim())
      : [];
    // Only strings a literal search can fairly resolve: long enough to be
    // distinctive, real prose, not a bare number or a composed count.
    const checkable = strings.filter((s) =>
      s.length >= 12 && /[a-z]{3}/.test(s) && !/^\d/.test(s) && !/\{|\}|<[a-z]/.test(s));
    surfaces.push({ head, accept: accept.trim(), checkable });
  }

  if (!surfaces.length) {
    return {
      pass: false,
      count: 'NO accept: LINES',
      detail: [
        'No entry in PAGES.md declares an accept: line, so nothing is enforceable.',
        'Add one under each entry\'s status: line. See handoff/VERIFY.md §"Making it binding".',
      ],
    };
  }

  const fails = [], notes = [];
  let builtCount = 0, verifyCount = 0, pendingCount = 0, noneCount = 0;

  for (const s of surfaces) {
    if (/^none/.test(s.accept)) { noneCount++; continue; }
    if (/^pending/.test(s.accept)) {
      pendingCount++;
      notes.push(`pending — ${s.head}  (${s.checkable.length} agreed strings, not yet enforced)`);
      continue;
    }
    const m = s.accept.match(/^(built|verify)\s+(.+)$/);
    if (!m) { fails.push(`${s.head} — unrecognised accept: "${s.accept}" (want: built|verify <files> | pending | none)`); continue; }
    const enforced = m[1] === 'built';
    if (enforced) builtCount++; else verifyCount++;
    const files = m[2].split(',').map((f) => f.trim()).filter(Boolean);
    const sink = enforced ? fails : notes;
    const missingFiles = files.filter((f) => !existsSync(join(REPO, f)));
    if (missingFiles.length) {
      sink.push(`${s.head} — these files do not exist: ${missingFiles.join(', ')}`);
      continue;
    }
    const hay = files.map((f) => body(f)).join('\n');
    const missing = s.checkable.filter((str) => !hay.includes(str));
    if (missing.length) {
      sink.push(`${enforced ? 'FAIL' : 'triage'} — ${s.head}: ${missing.length}/${s.checkable.length} agreed strings absent from ${files.join(', ')}`);
      missing.slice(0, showAll ? 999 : 8).forEach((str) => sink.push(`          · ${str}`));
      if (!showAll && missing.length > 8) sink.push(`          … ${missing.length - 8} more (rerun with --all)`);
    } else if (!enforced) {
      notes.push(`clean — ${s.head}: all ${s.checkable.length} agreed strings present. Flip accept: verify -> built to enforce.`);
    }
  }

  return {
    pass: fails.length === 0,
    detail: fails.length ? fails : notes,
    warnOnly: fails.length === 0 && notes.length > 0,
    count: `${builtCount} enforced · ${verifyCount} in triage · ${pendingCount} pending · ${noneCount} not shipping`,
  };
});

// ── H · every app page is mounted in the mobile shell ───────────────────────
// The failure this exists to prevent: GettingStarted.tsx rendered <Navbar>
// directly instead of going through PageLayout, so the /app home route had the
// desktop sidebar at every width and NO bottom tab bar, drawer or safe-area
// reservation. The shell was correct and simply not mounted on the first screen
// a user sees. No copy check or class check can see this — only "is this page
// wrapped in the layout that owns the mobile chrome".
//
// PUBLIC_PAGES render deliberately without app chrome. Everything else under
// src/pages must be shelled — either by importing PageLayout/AdminLayout
// itself, or by being mounted inside a <PageLayout> route in App.tsx (which is
// how the /help subtree works). The route case is VERIFIED against App.tsx, not
// trusted to a list, and a page that is shelled by its route must NOT also wrap
// itself — that would nest two shells.
const PUBLIC_PAGES = [
  'src/pages/Landing.tsx',          // marketing, no sidebar by design
  'src/pages/Auth.tsx',             // sign-in
  'src/pages/OrbitMrpCallback.tsx', // OAuth redirect target, no chrome
  // About is public: it is linked from Landing for signed-out visitors and
  // carries Landing's own top bar (logo -> "/", Log in, Get started) at every
  // width, so a phone user reaching it from the drawer is not stranded. Move it
  // OUT of this list if it ever loses that header.
  'src/pages/About.tsx',
];
gate('H', 'every app page is mounted in the mobile shell', () => {
  const norm = (p) => p.split(/[\\/]/).join('/');
  const pages = SRC.filter((f) => /^src[\\/]pages[\\/].*\.tsx$/.test(f));
  if (!pages.length) {
    return { pass: true, warnOnly: true, detail: ['no src/pages/*.tsx found — is this the repo root?'], count: 'skipped' };
  }

  // Components a PARENT route shells for its children — the /help subtree:
  //
  //   <Route path="/help" element={<PageLayout …><DocsLayout/></PageLayout>}>
  //     <Route index element={<HelpPage slug="overview"/>} />   <- shelled
  //   </Route>
  //
  // so the children are exactly what sits between the element's </PageLayout>
  // and that route's </Route>. A PageLayout route with no nested children
  // contributes nothing, which is what we want.
  const app = body('src/App.tsx');
  const routeShelled = new Set();
  for (const m of app.matchAll(/<\/PageLayout>/g)) {
    const rest = app.slice(m.index + m[0].length);
    const end = rest.indexOf('</Route>');
    if (end < 0) continue;
    for (const c of rest.slice(0, end).matchAll(/<([A-Z][A-Za-z0-9_]*)[\s/>]/g)) routeShelled.add(c[1]);
  }

  const bad = [], ok = [];
  for (const f of pages) {
    const src = body(f);
    const rel = norm(f);
    const isPublic = PUBLIC_PAGES.includes(rel);
    const component = rel.split('/').pop().replace(/\.tsx$/, '');
    // A page that renders the desktop sidebar itself is wrong even if it also
    // imports PageLayout — the sidebar must come from the layout, behind md:.
    if (/<Navbar[\s/>]/.test(src)) {
      bad.push(`${rel} — renders <Navbar> directly. The sidebar must come from PageLayout (which hides it below md); a page that mounts it itself shows the desktop sidebar on every phone.`);
      continue;
    }
    const hasLayout = /\b(PageLayout|AdminLayout)\b/.test(src);
    const byRoute = routeShelled.has(component) && !isPublic;
    if (byRoute && hasLayout) {
      bad.push(`${rel} — App.tsx already mounts <${component}> inside a <PageLayout> route AND the page wraps itself. Two shells nest two tab bars and two credit bars; drop one.`);
      continue;
    }
    if (isPublic || hasLayout || byRoute) { ok.push(rel); continue; }
    bad.push(`${rel} — imports neither PageLayout nor AdminLayout and is not mounted inside a <PageLayout> route, so it renders with no tab bar, no drawer and no safe-area reservation. A user who lands here on a phone has no navigation at all.`);
  }
  return {
    pass: bad.length === 0,
    detail: bad,
    count: `${ok.length}/${pages.length} pages shelled`,
  };
});

// ── report ───────────────────────────────────────────────────────────────────
const W = 74;
console.log('');
console.log('SuReSuite mobile — repo conformance');
console.log('repo: ' + REPO);
console.log('book: ' + bookDir);
console.log('─'.repeat(W));

let failed = 0, warned = 0;
for (const g of gates) {
  const hard = !g.pass;
  const soft = g.pass && g.warnOnly && g.detail.length;
  if (hard) failed++;
  if (soft) warned++;
  const mark = hard ? 'FAIL' : soft ? 'WARN' : ' OK ';
  console.log(`[${mark}] ${g.id} · ${g.title}` + (g.count ? `  —  ${g.count}` : ''));
  if (g.detail.length) g.detail.forEach((d) => console.log('       ' + d));
}
console.log('─'.repeat(W));
console.log(`${gates.length - failed - warned} ok · ${warned} to review · ${failed} failing`);
console.log('');
console.log('Gates A-F are the code contract. G is the design contract. H is the');
console.log('shell contract: an unshelled page has no navigation at all on a phone.');
console.log('');
console.log('Gate G in triage: each "triage" line is a worklist for one surface.');
console.log('Work it down, then flip that entry\'s accept: verify -> built in PAGES.md.');
console.log('From then on the build fails if the agreed detail goes missing.');
console.log('');
console.log('None of them can tell you the screen LOOKS right — run layer 2 (visual');
console.log('parity) and layer 3 (device) from VERIFY.md before calling a surface done.');
console.log('');
process.exit(failed ? 1 : 0);
