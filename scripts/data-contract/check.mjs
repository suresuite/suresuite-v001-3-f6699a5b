#!/usr/bin/env node
// The data-contract gate (Phase 1 / WP 1.4).
//
//   npm run contract:check
//
// ONE command that reproduces everything CI asserts about the data layer, so a
// contributor does not have to reconstruct the job from a workflow file. It runs
// the gates WP 1.1–1.3 built, then WP 1.4's own five rules:
//
//   R1  every table is either described by a sidecar or listed in coverage.yaml
//   R2  every coverage.yaml entry names a table that exists and has no sidecar
//   R3  the generated contract and pages match what the sources generate
//   R4  no table the code reads is missing its migration, and none is ALTERed
//       without being created
//   R5  a tier-2 table whose only uniqueness is a surrogate key — WARN (WP 2.4)
//   R6  every file:line in PLAN.md §4 resolves and is in bounds
//   R7  §16 is append-only — no drift-log entry may vanish from history, AND
//       every work package marked done in §7–§13 has a §16 entry
//   R8  no open defect and no unmet invariant is owned by a FINISHED package
//   R9  `governance.audited` matches the audit triggers the migrations create
//
// WHY R1 IS THE ONE THAT MATTERS. "Every column of the twelve tables is
// described" is a fact about twelve tables; it says nothing about the seventy
// third. R1 makes the schema itself the checklist: a table added to a migration
// must be described or explicitly deferred with a named work package, and there
// is no third option. That is the rule that would have caught `approved_users` —
// the AUTHENTICATION table — existing in no migration at all.
//
// WHY R4 FIRES ON approved_users. Before this package the introspector reported
// three orphans: tables the code reads that no migration creates. WP 1.4
// reconciled all three (a CREATE TABLE for `approved_users`, a real migration
// for `risk_data`, deletion of the dead `product_code_map` branch), so R4 is
// green — and `git revert` of any one of those three turns it red again. The
// rule is proved by the case, not asserted next to it.

import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { load } from "js-yaml";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const INTROSPECTED = join(ROOT, "build", "schema.introspected.json");
const COVERAGE = join(HERE, "coverage.yaml");
const PLAN = join(ROOT, "docs", "PLAN.md");

const PLAN_SECTIONS = /\n## (7|8|9|10|11|12|13)\. /;

const failures = [];
const warnings = [];
const fail = (rule, msg) => failures.push(`${rule}  ${msg}`);
const warn = (rule, msg) => warnings.push(`${rule}  ${msg}`);

// ───────────────────────────────────────────────────── stage 1: the sub-gates
//
// Run as child processes rather than imported, so each keeps its own exit code
// and its own output. WP 1.3's handoff asked for exactly this: one command that
// runs all four plus the drift comparison, so there is one name to put in CI and
// in CONTRIBUTING.

const SUBGATES = [
  ["introspect.mjs", ["--check"], "the introspected schema matches the migrations"],
  ["validate-sidecars.mjs", [], "the sidecars validate against the schema"],
  ["gen-unit-sql.mjs", ["--check"], "the SQL unit table matches grading.ts"],
  // D33 — the capability catalog is seeded across nine migrations and mirrored
  // in TypeScript. Nothing checked the two agreed until this line.
  ["gen-capabilities.mjs", ["--check"], "the capability catalog matches the migrations"],
  ["verify-introspection.mjs", [], "WP 1.1's exit checks"],
  ["generate.mjs", ["--check"], "the contract and its pages match their sources"],
];

console.log("── data contract ──────────────────────────────────────────────\n");
for (const [script, args, what] of SUBGATES) {
  const r = spawnSync(process.execPath, [join(HERE, script), ...args], { encoding: "utf8" });
  const label = `${script} ${args.join(" ")}`.trim();
  if (r.status === 0) {
    console.log(`  ✓ ${what}`);
  } else {
    console.log(`  ✗ ${what}`);
    const out = `${r.stdout ?? ""}${r.stderr ?? ""}`.trim();
    for (const line of out.split("\n")) console.log(`      ${line}`);
    fail("sub-gate", `${label} exited ${r.status}`);
  }
}
console.log("");

if (!existsSync(INTROSPECTED)) {
  console.error("build/schema.introspected.json is missing — run `npm run contract:introspect` first.");
  process.exit(1);
}
const schema = JSON.parse(readFileSync(INTROSPECTED, "utf8"));
const tables = new Map(schema.tables.map((t) => [t.name, t]));

// ───────────────────────────────────────────── R1/R2: nothing is undescribed

const sidecars = new Map();
for (const f of readdirSync(join(ROOT, "supabase", "contract")).filter((f) => f.endsWith(".contract.yaml"))) {
  sidecars.set(f.replace(".contract.yaml", ""), `supabase/contract/${f}`);
}

const coverage = load(readFileSync(COVERAGE, "utf8"));
const deferred = new Map();
for (const group of coverage.deferred ?? []) {
  if (!group.wp || !group.why) fail("R2", `a coverage.yaml group has no wp or no why: ${JSON.stringify(group.tables)}`);
  for (const t of group.tables ?? []) {
    if (deferred.has(t)) fail("R2", `coverage.yaml defers "${t}" twice (WP ${deferred.get(t)} and WP ${group.wp})`);
    deferred.set(t, group.wp);
  }
}

for (const name of tables.keys()) {
  const described = sidecars.has(name);
  const isDeferred = deferred.has(name);
  if (described && isDeferred) {
    fail("R1", `"${name}" has a sidecar AND a coverage.yaml deferral — pick one`);
  } else if (!described && !isDeferred) {
    fail(
      "R1",
      `"${name}" is in the schema, has no sidecar, and is not deferred in coverage.yaml.\n` +
      `        Author supabase/contract/${name}.contract.yaml, or add it to coverage.yaml under the\n` +
      `        work package that will. A table nobody has decided about is how the data layer drifts.`,
    );
  }
}
for (const [name, wp] of deferred) {
  if (!tables.has(name)) fail("R2", `coverage.yaml defers "${name}" (WP ${wp}), which exists in no migration`);
}

// ───────────────────────────────── R4: orphans and phantoms (both must be empty)

for (const o of schema.orphans) {
  fail(
    "R4",
    `"${o.table}" is read by code but created by no migration — ${o.referenced_at.slice(0, 3).join(", ")}` +
    `${o.referenced_at.length > 3 ? ` (+${o.referenced_at.length - 3} more)` : ""}.\n` +
    `        Add the migration or delete the read. A fresh database built from supabase/migrations/\n` +
    `        alone does not have this table, so every one of those call sites fails there.`,
  );
}
for (const p of schema.phantom_tables) {
  fail("R4", `"${p.table}" is ALTERed, indexed or policied by ${p.referenced_by.length} statements and created by none`);
}

// ─────────────────────── R5: natural keys — WARN until WP 3.3 lands them (D5)

// TODO(2026-09-15, WP 2.4): flip this to a failure. WP 3.3 adds the natural-key
// constraints and the upsert that makes them survivable; WP 2.4 generates the RLS
// and key tests from the contract and is where the warning becomes a gate. Until
// 3.3 has landed, failing here would only mean every run of the gate is red for a
// reason no one in this phase is allowed to fix — which is how `npm run lint`
// became unreadable (PLAN.md §16, the WP 1.1 precondition entry).
const surrogateOnly = (t) =>
  t.natural_key_unique.length > 0 &&
  t.natural_key_unique.every((k) => k.columns.length === 1 && k.columns[0] === "id");

for (const [name, path] of [...sidecars].sort()) {
  const doc = load(readFileSync(join(ROOT, path), "utf8"));
  if (doc.tier !== "2") continue;
  const t = tables.get(name);
  if (!t) continue; // R1/validate already reported it
  if (t.natural_key_unique.length === 0) {
    warn("R5", `"${name}" is tier 2 and has NO uniqueness at all — not even a primary key`);
  } else if (surrogateOnly(t)) {
    warn(
      "R5",
      `"${name}" is tier 2 and its only uniqueness is the surrogate \`id\` (D5). ` +
      `The grain implies ${doc.natural_key_intended ? `\`${doc.natural_key_intended.join(" + ")}\`` : "a key the sidecar has not stated"}; ` +
      "re-uploading the same file duplicates every row.",
    );
  }
}

// ───────────────────── R6: PLAN.md §4 is the only authority — so it must resolve

const SKIP_DIR = /node_modules|\.git|\/dist\b|__pycache__|\.venv|\/build\/|docs\/archive/;
function walk(dir, out = []) {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (SKIP_DIR.test(p)) continue;
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(relative(ROOT, p));
  }
  return out;
}
const repoFiles = walk(ROOT);
const resolveCitation = (cited) => {
  const exact = repoFiles.filter((f) => f === cited || f.endsWith("/" + cited));
  if (exact.length) return exact;
  // §4 elides migration timestamps (`item_master.sql` for
  // `20260614000001_item_master.sql`), which is right — the timestamp is noise
  // to a reader and the suffix is unique.
  const base = cited.split("/").pop();
  return repoFiles.filter((f) => f.split("/").pop().endsWith(base));
};

const planLines = readFileSync(PLAN, "utf8").split("\n");
const secStart = planLines.findIndex((l) => l.startsWith("## 4. Confirmed defects"));
const secEnd = planLines.findIndex((l) => l.startsWith("## 5. The transparency standard"));
if (secStart < 0 || secEnd < 0) fail("R6", "PLAN.md §4 could not be located — the section headings moved");

const CITATION = /([\w./-]+\.(?:ts|tsx|py|sql))\s*:\s*(\d+(?:[-,]\d+)*)/g;
const PATHISH = /[\w./-]+\.(?:ts|tsx|py|sql)/;
// Words too common to anchor anything. A token that means "a value" cannot
// distinguish one line from another.
const STOP = new Set([
  "null", "true", "false", "default", "data", "type", "name", "value", "this",
  "from", "with", "that", "only", "then", "when", "where", "text", "uuid",
  "numeric", "select", "insert", "table", "json", "case", "else",
]);

const anchor = { inRange: 0, elsewhere: [], none: 0, shared: 0, historical: 0 };
for (let i = secStart; i >= 0 && i < secEnd; i++) {
  const row = planLines[i];
  const cites = [...row.matchAll(CITATION)];
  if (!cites.length) continue;
  const spans = [...row.matchAll(/`([^`]+)`/g)].map((x) => x[1]).filter((s) => !PATHISH.test(s) && !s.includes("/"));
  const tokens = new Set();
  for (const s of spans) {
    for (const t of s.split(/[^A-Za-z0-9_]+/)) {
      if (t.length >= 4 && /[A-Za-z]/.test(t) && !/^\d/.test(t) && !STOP.has(t.toLowerCase())) tokens.add(t);
    }
  }

  for (const m of cites) {
    const at = `PLAN.md:${i + 1}`;
    const candidates = resolveCitation(m[1]);
    if (candidates.length === 0) {
      fail("R6", `${at} cites \`${m[0]}\` — no such file in the repo`);
      continue;
    }
    if (candidates.length > 1) {
      fail("R6", `${at} cites \`${m[0]}\`, which matches ${candidates.length} files (${candidates.join(", ")}) — qualify the path`);
      continue;
    }
    const file = candidates[0];
    const src = readFileSync(join(ROOT, file), "utf8").split("\n");
    const nums = m[2].split(/[-,]/).map(Number);
    const lo = Math.min(...nums), hi = Math.max(...nums);
    if (lo < 1 || hi > src.length) {
      fail("R6", `${at} cites \`${m[0]}\` but ${file} has ${src.length} lines — the citation is stale`);
      continue;
    }

    // The anchor check below is REPORTED, never enforced, and the reason is
    // measured rather than assumed: §4's rows attach their prose to the DEFECT,
    // not to each citation, so a row with three citations has one pool of tokens
    // between them and a row describing a line by its behaviour ("`resolveField`'s
    // `> 0` test") anchors on a token that legitimately sits seven lines above.
    // Both produce false positives, and a gate that cries wolf is the gate people
    // learn to ignore — which is what `npm run lint` became here.
    // Making it enforceable needs per-citation anchors in §4; PLAN.md §9 WP 2.4
    // owns that, and this report is the backlog it works from.
    if (/\bwas\b[^|]*$/.test(row.slice(0, m.index))) { anchor.historical++; continue; }
    if (cites.length > 1) { anchor.shared++; continue; }
    const whole = src.join("\n");
    const base = file.split("/").pop().replace(/\.(ts|tsx|py|sql)$/, "");
    const usable = [...tokens]
      .filter((t) => !base.includes(t) && !t.includes(base))
      .map((t) => ({ t, n: whole.split(t).length - 1 }))
      .filter((a) => a.n >= 1 && a.n <= 8);
    if (!usable.length) { anchor.none++; continue; }
    const range = src.slice(lo - 1, hi).join("\n");
    if (usable.some((a) => range.includes(a.t))) { anchor.inRange++; continue; }
    anchor.elsewhere.push(
      `${at} \`${m[0]}\` → ${file}:${lo}-${hi}; ` +
      usable.map((a) => `\`${a.t}\` is at :${src.findIndex((l) => l.includes(a.t)) + 1}`).join(", "),
    );
  }
}

// ─────────────────────────── R7: §16 is append-only (WP 2.4, assigned by §9)
//
// §16 has lost entries to a silent `git merge` TWICE in one phase: `5c7129f`
// dropped two, and the merge during WP 1.4 dropped the PHASE BOUNDARY entry
// itself. Neither produced a conflict, because both sides had appended at the
// same place and the ort strategy simply kept one. The drift log is the document
// whose entire purpose is to be the thing that does not get lost, and nothing was
// checking.
//
// The rule is what §16's own preamble already says: never delete an entry; a
// superseded finding is struck through with a pointer to the entry that replaced
// it. So every `### WP …` / `### PHASE …` heading that appears in §16 in ANY
// ancestor commit must still appear in §16 at HEAD.
//
// WHY HEADINGS AND NOT CONTENT. An entry gets edited — outcomes recorded, numbers
// corrected — and that is normal and good. What must not happen is a whole entry
// silently ceasing to exist. The heading is the identity of the entry, so
// comparing the SET of headings catches the loss without forbidding the edits.
//
// AND WHY ONLY THE PART BEFORE THE FIRST `·`. Entries are written with a
// placeholder commit — `### WP 1.3 — … · 2026-09-15 · \`<this commit>\`` — and the
// real SHA is filled in afterwards, so the full heading legitimately CHANGES. The
// first version of this rule compared whole headings and reported five such
// corrections as losses, which is a gate that cries wolf and therefore gets
// ignored. The identity is the work-package name and title; the date and commit
// that follow are metadata about the same entry.
//
// A shallow clone cannot see ancestors, so the rule SKIPS rather than fails
// there and says so: a gate that fails for want of history teaches people to
// ignore it. CI checks out with full history for exactly this reason.

const PLAN_PATH = "docs/PLAN.md";
const section16 = (text) => {
  const a = text.indexOf("\n## 16.");
  const b = text.indexOf("\n## 17.");
  return a < 0 ? "" : text.slice(a, b < 0 ? undefined : b);
};
/** The stable identity of an entry: its name, without the trailing date/commit. */
const entryKey = (heading) =>
  heading
    .replace(/^###\s*/, "")
    .split("·")[0]           // drop "· 2026-09-15 · `sha`"
    .replace(/~~/g, "")      // a struck-through retirement is still the same entry
    .replace(/\s+/g, " ")
    .trim();

const entryHeadings = (text) =>
  section16(text)
    .split("\n")
    .filter((l) => /^### /.test(l))
    .map((l) => l.trim());

const git = (...args) => spawnSync("git", args, { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

{
  const shallow = git("rev-parse", "--is-shallow-repository").stdout?.trim();
  const revs = git("rev-list", "HEAD", "--", PLAN_PATH).stdout?.trim();
  if (shallow === "true") {
    console.log("  R7  §16 append-only — SKIPPED: shallow clone, no ancestors to compare");
  } else if (!revs) {
    console.log("  R7  §16 append-only — SKIPPED: no history for docs/PLAN.md");
  } else {
    const headHeadings = entryHeadings(readFileSync(join(ROOT, PLAN_PATH), "utf8"));
    const head = new Set(headHeadings.map(entryKey));
    const commits = revs.split("\n").filter(Boolean);
    const lost = new Map();   // entry key -> the last commit that still had it
    for (const sha of commits) {
      const past = git("show", `${sha}:${PLAN_PATH}`).stdout;
      if (!past) continue;
      for (const h of entryHeadings(past)) {
        const key = entryKey(h);
        if (!key || head.has(key)) continue;
        if (!lost.has(key)) lost.set(key, sha.slice(0, 7));
      }
    }
    if (lost.size) {
      for (const [h, sha] of lost) {
        fail("R7", `§16 lost an entry: "${h}" was present at ${sha} and is not in HEAD. ` +
                   "Restore it — §16 is append-only; a superseded entry is struck through " +
                   "with a pointer, never deleted.");
      }
    } else {
      console.log(`  R7  §16 append-only · ${head.size} entries, ${commits.length} revisions checked`);
    }
  }
}

// ─────────── R7 rule 2: a package marked done in §7–§13 has a §16 entry
//
// §9 assigned R7 as TWO rules and WP 2.4 shipped one. The half that shipped is
// built on `git log`, and §9 said in advance why that half is not enough: history
// cannot show the absence of a document nobody ever committed. "PHASE 2
// READINESS" was never written, and the append-only rule is structurally
// incapable of noticing — it cost WP 2.1 and WP 5.2a a search each before anyone
// concluded it had simply never existed.
//
// This is the other half, and it needs no history at all: the roadmap's own ✅
// markers are the checklist. A package marked done in §7–§13 with no `### WP`
// heading in §16 is a package that skipped its drift-log entry, which is what
// "a package without a §16 entry is not finished" has to mean to be enforceable.
//
// IDENTITY IS THE SAME `entryKey` THE APPEND-ONLY HALF USES — the name before the
// first `·` — so the two rules cannot disagree about what counts as an entry.

{
  const planText = readFileSync(PLAN, "utf8");
  const roadmapStart = planText.search(PLAN_SECTIONS);
  const roadmapEnd = planText.indexOf("\n## 14.");
  const roadmap = roadmapStart < 0 ? "" : planText.slice(roadmapStart, roadmapEnd < 0 ? undefined : roadmapEnd);

  // "### WP 2.3 — Data-plane audit ✅ *(D15 — done …)*" → "WP 2.3 — Data-plane audit"
  const donePackages = roadmap
    .split("\n")
    .filter((l) => /^### WP /.test(l) && l.includes("✅"))
    .map((l) => l.replace(/^###\s*/, "").split("✅")[0].replace(/\s+/g, " ").trim());

  // A §16 heading carries the package NAME ("WP 2.3 — The data-plane audit");
  // the roadmap heading carries the name and usually a different title, so the
  // WP NUMBER is the identity the two spellings share.
  //
  // THE NUMBER ALONE IS NOT ENOUGH. §16 also holds "WP 2.3 precondition — …",
  // "WP 2.1 follow-up — …" and "WP 2.4 base merge — …", and a number-only match
  // let any of those stand in for the completion entry: deleting
  // "### WP 2.3 — The data-plane audit" left the rule silent because the
  // precondition entry still carried "2.3". A package's own entry is the one
  // whose number is followed immediately by the em dash.
  const loggedNumbers = new Set(
    entryHeadings(planText)
      .map(entryKey)
      .map((k) => k.match(/^WP\s+([0-9]+\.[0-9]+[a-z]?)\s+—/i)?.[1])
      .filter(Boolean),
  );

  const missing = [];
  for (const pkg of donePackages) {
    const num = pkg.match(/^WP\s+([0-9]+\.[0-9]+[a-z]?)/i)?.[1];
    if (num && !loggedNumbers.has(num)) missing.push(pkg);
  }
  if (missing.length) {
    for (const pkg of missing) {
      fail("R7", `§7–§13 marks "${pkg}" done (✅) and §16 has no entry for it. ` +
                 "A package without a §16 entry is not finished — write the entry, or drop the ✅.");
    }
  } else {
    console.log(`  R7  every done package has a §16 entry · ${donePackages.length} checked`);
  }
}

// ───────────── R8: nothing open may be owned by a package that has finished
//
// THE FAILURE THIS CATCHES HAS NO SYMPTOM. A defect assigned to WP 2.4 while
// WP 2.4 is open is work scheduled; the same row after WP 2.4 ships ✅ is work
// nobody will ever do again, and it reads identically. The Phase 2→3 assessment
// found five of them at once — D29, D30, D31, D33, D35 all pointed at WP 2.4,
// which had closed — plus three rows of CLAUDE.md's invariant table still saying
// "not yet — WP 2.1 / 2.2 / 2.3" for packages that had all shipped.
//
// Both are the same shape: a pointer to an owner who has gone home. The rule is
// to read the roadmap's ✅ markers and refuse any OPEN row that points at one.

{
  const planText = readFileSync(PLAN, "utf8");
  const roadmapStart = planText.search(PLAN_SECTIONS);
  const roadmapEnd = planText.indexOf("\n## 14.");
  const roadmap = roadmapStart < 0 ? "" : planText.slice(roadmapStart, roadmapEnd < 0 ? undefined : roadmapEnd);

  const donePackages = new Set(
    roadmap
      .split("\n")
      .filter((l) => /^### WP /.test(l) && l.includes("✅"))
      .map((l) => l.match(/^### WP\s+([0-9]+\.[0-9]+[a-z]?)/i)?.[1])
      .filter(Boolean),
  );

  // §4's rows: the LAST cell is "Closed by". A row carrying ✅ is closed and may
  // name any package; a row without one is open and may not name a finished one.
  const s4start = planText.indexOf("\n## 4. ");
  const s4end = planText.indexOf("\n### 4.1 ");
  const section4 = s4start < 0 ? "" : planText.slice(s4start, s4end < 0 ? undefined : s4end);
  let orphaned = 0;
  for (const line of section4.split("\n")) {
    if (!/^\|\s*\*{0,2}D[0-9]+/.test(line)) continue;
    const cells = line.split("|").map((c) => c.trim());
    const id = cells[1].replace(/\*/g, "");
    const closedBy = cells[cells.length - 2] ?? "";
    if (closedBy.includes("✅")) continue;                 // already closed
    for (const num of closedBy.match(/WP\s*([0-9]+\.[0-9]+[a-z]?)/gi) ?? []) {
      const n = num.replace(/WP\s*/i, "");
      if (donePackages.has(n)) {
        orphaned += 1;
        fail("R8", `§4 ${id} is OPEN and its "Closed by" names WP ${n}, which §7–§13 marks ✅ done. ` +
                   "An open defect owned by a finished package has no owner — reassign it to a package " +
                   "that has not run, or close the row.");
      }
    }
  }

  // CLAUDE.md's invariant table says where each gate is enforced "today". A row
  // still reading "not yet — WP N.M" for a shipped package is the same defect in
  // the document a new session reads FIRST.
  const claudeMd = join(ROOT, "CLAUDE.md");
  if (existsSync(claudeMd)) {
    for (const line of readFileSync(claudeMd, "utf8").split("\n")) {
      if (!/^\|\s*`[a-z-]+`\s*\|/.test(line)) continue;
      const cells = line.split("|").map((c) => c.trim());
      const gate = cells[1];
      const enforcedBy = cells[cells.length - 2] ?? "";
      if (!/not yet/i.test(enforcedBy)) continue;
      for (const num of enforcedBy.match(/WP\s*([0-9]+\.[0-9]+[a-z]?)/gi) ?? []) {
        const n = num.replace(/WP\s*/i, "");
        if (donePackages.has(n)) {
          orphaned += 1;
          fail("R8", `CLAUDE.md's ${gate} row says "not yet — WP ${n}", and §7–§13 marks WP ${n} ✅ done. ` +
                     "Either the package shipped the gate and the row is stale, or it did not and the ✅ is wrong.");
        }
      }
    }
  }
  if (!orphaned) console.log(`  R8  no open defect or unmet invariant is owned by a finished package`);
}

// ───────── R9: `governance.audited` is a FACT, and facts have one source (I1)
//
// WHAT WENT WRONG WITHOUT IT. WP 2.3 created three audit triggers on each of
// twelve tier-2/3/4 tables. Not one of the twelve sidecars changed, so all
// twelve still declared `audited: false` — and because the generated pages
// render that field, `docs/data/tables/inbound_logistics.md` published "Tier
// transitions audited: **no** — invariant `audit-actor` is not met here yet"
// about a table that had been audited since the migration deployed. A published
// falsehood, which is a §5 T1 breach, generated and CI-gated (T5) so it would
// have stayed true-looking indefinitely.
//
// It could drift because `audited` had NO SOURCE. `introspect.mjs` has
// `CREATE TRIGGER` on its ignore list — correctly; it builds a column schema —
// so the contract had no representation of a trigger at all and the boolean was
// maintained by hand. `live-sql.mjs` now replays triggers the way it already
// replays policies, and this rule compares the two. That is `single-source`
// (I1) applied to the field that records `audit-actor` (G4).

// TWO MECHANISMS, NOT ONE. The first version of this rule counted only the
// trigger, and it immediately called `organizations` a false claim —
// `audited: true` there is TRUE, by the other route: every mutation goes through
// `admin_create_organization` / `admin_update_organization` /
// `admin_set_org_status`, each of which closes with `log_admin_action`. A rule
// that forces a true statement to be recorded as false is the defect it exists
// to prevent, so the trigger is a FLOOR (a trigger means the flag must be true)
// and an RPC-audited table satisfies it by NAMING the function in its note —
// which must exist in the migrations and must actually call an audit emitter.

{
  const { auditedTables, liveDefinitions } = await import("./live-sql.mjs");
  const live = auditedTables();
  const emitters = new Map(
    [...liveDefinitions().functions]
      .filter(([, f]) => /\b(log_admin_action|log_data_action)\s*\(/i.test(f.sql))
      .map(([name]) => [name, true]),
  );
  let drift = 0;
  for (const [name, path] of sidecars) {
    // `sidecars` maps a table name to its PATH, not to parsed YAML — the first
    // version of this rule read `.governance` off the string and found every
    // table undeclared, which happens to be the answer it expected.
    const sc = load(readFileSync(join(ROOT, path), "utf8"));
    const declared = sc.governance?.audited === true;
    const triggered = live.has(name);

    if (triggered && !declared) {
      drift += 1;
      fail("R9", `"${name}" has ${live.get(name).length} live audit trigger(s) (${live.get(name).join(", ")}) ` +
                 `and its sidecar says \`audited: false\`. The generated page publishes that as ` +
                 `"Tier transitions audited: no" — set it true and regenerate.`);
      continue;
    }
    if (!declared || triggered) continue;

    // Declared true with no trigger: the note must name the auditing function.
    const named = [...String(sc.governance?.note ?? "").matchAll(/`([a-z_][a-z0-9_]*)`/gi)]
      .map((m) => m[1])
      .filter((n) => emitters.has(n));
    if (!named.length) {
      drift += 1;
      fail("R9", `"${name}" declares \`audited: true\`, has no \`audit_tier_write\` trigger, and its ` +
                 "governance note names no function that calls `log_admin_action` or `log_data_action`. " +
                 "A claim of accountability that nothing implements is worse than none — name the " +
                 "auditing RPC in the note, or set the flag false.");
    }
  }
  if (!drift) {
    console.log(`  R9  \`governance.audited\` matches the migrations · ${live.size} table(s) audited by trigger, ` +
                `${emitters.size} function(s) that emit an audit row`);
  }
}

// ──────────────────────────────────────────────────────────────────── report

const covered = [...sidecars.keys()].length;
console.log(`  R1  ${covered} tables described · ${deferred.size} deferred with a named work package · ${tables.size} in the schema`);
console.log(`  R4  ${schema.orphans.length} orphans · ${schema.phantom_tables.length} phantom tables`);
console.log(
  `  R6  §4 citations: ${anchor.inRange} anchored in range · ${anchor.elsewhere.length} anchored elsewhere · ` +
  `${anchor.none} with no usable anchor · ${anchor.shared} sharing a row · ${anchor.historical} historical ("was …")`,
);
if (anchor.elsewhere.length) {
  console.log(`\n  §4 citations whose own token sits on a different line — REPORTED, not enforced (WP 2.4):`);
  for (const e of anchor.elsewhere) console.log(`    · ${e}`);
}
if (warnings.length) {
  console.log(`\n  ${warnings.length} warning(s):`);
  for (const w of warnings) console.log(`    ⚠ ${w}`);
}

if (failures.length) {
  console.error(`\n✗ ${failures.length} failure(s):\n`);
  for (const f of failures) console.error(`  ✗ ${f}`);
  console.error(
    "\nDo not weaken a rule to make it pass. If a rule cannot pass, say so in PLAN.md §16\n" +
    "and leave the rule alone — a gate that has been relaxed to go green measures nothing.",
  );
  process.exit(1);
}
console.log(`\n✓ the data contract holds${warnings.length ? ` (${warnings.length} warning(s) above)` : ""}`);
