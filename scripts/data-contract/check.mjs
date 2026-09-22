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
//   R5  a tier-2 table whose only uniqueness is a surrogate key — FAIL (WP 3.3)
//   R6  every file:line in PLAN.md §4 resolves and is in bounds
//   R7  §16 is append-only — no drift-log entry may vanish from history, AND
//       every work package marked done in §7–§13 has a §16 entry
//   R8  no open defect, unmet invariant, table deferral or undeployed edge function is
//       owned by a FINISHED package,
//       a FINISHED PHASE, or a package the plan does not contain (WP 3.4)
//   R9  `governance.audited` matches the audit triggers the migrations create
//   R10 §17's sequencing table agrees with §7–§13's ✅ markers (WP 3.3)
//   R11 every DEFERRED table says whether it is audited, and is right (D54, WP 4.2)
//   R12 every §5.1 lineage row resolves to a real page and a real read, and every
//       page in src/pages is accounted for (WP 5.2e)
//   R13 an IMPLEMENTED policy's declared data requirement is described by the
//       contract AND reaches a display surface (D94, D112, WP 6.2)
//   R14 no dynamic RLS statement resolves to zero known tables (D51, WP 6.2)
//   R15 a sidecar's prose may not deny a reader its own `surfaces` block confirms
//       (D58, D101's shape inside one file, WP 6.2)
//   R16 every §4 D-number is unique, and §4 has no duplicated row (D122's merge, WP 6.3)
//   R17 every edge function is DEPLOYED or deferred with a named owner (D123, WP 6.3)
//   R18 a `computed_by` names a writer that is CALLED, or declares why not (D118, WP 6.2)
//   R19 §4, §16 and §17 each have exactly ONE heading (D146's merge, WP 8.0)
//   R20 no two migration files share a version (D151's deploy, this package)
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
const GENERATED = join(ROOT, "build", "data-contract.generated.json");

const PLAN_SECTIONS = /\n## (7|8|9|10|11|12|13)\. /;

// THE ROADMAP IS NOT ONE CONTIGUOUS SLICE ANY MORE, and reading it as one is how
// a whole phase would sit outside every rule that reads ✅ markers.
//
// Phases 0–6 are §7–§13, ending where §14's deferred work begins. Phase 8 is §18,
// which is AFTER §16 and §17 — it had to be, because a phase inserted between §13
// and §14 would renumber §15 and §16, and this document is cited by section number
// from the sidecars, from CLAUDE.md and from eleven hundred places in itself.
//
// So the roadmap is two ranges, joined. R7 rule 2 (every done package has a §16
// entry), R8 (nothing open is owned by a finished package) and R10 (§17 agrees
// with the roadmap) all read THIS, so a Phase 8 package marked ✅ is held to
// exactly what a Phase 3 package is held to. A gate whose scope stops at the
// section a phase happens to live in is a gate that a new section walks around.
const ROADMAP_RANGES = [
  [PLAN_SECTIONS, "\n## 14."],
  [/\n## 18\. /, null],
];
function roadmapText(planText) {
  const parts = [];
  for (const [startRe, endMarker] of ROADMAP_RANGES) {
    const a = planText.search(startRe);
    if (a < 0) continue;
    const b = endMarker ? planText.indexOf(endMarker, a) : -1;
    parts.push(planText.slice(a, b < 0 ? undefined : b));
  }
  return parts.join("\n");
}

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
const deferredAudited = new Map();
for (const group of coverage.deferred ?? []) {
  if (!group.wp || !group.why) fail("R2", `a coverage.yaml group has no wp or no why: ${JSON.stringify(group.tables)}`);
  for (const [t, v] of Object.entries(group.audited ?? {})) deferredAudited.set(t, v);
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

// FLIPPED FROM `warn` TO `fail` BY WP 3.3, in the same commit as the seven
// unique indexes it asserts (`20260916000018`). The plan had split those two
// halves — WP 2.4 to flip, WP 3.3 to make the flip survivable — and that split is
// unexecutable in either order: WP 2.4 was told not to flip before the
// constraints existed, so it shipped without flipping, and the flip then belonged
// to a closed package (§16 · Phase 2→3). Landing them together is the only
// ordering in which neither half can outlive the other.
//
// NO TABLE IS EXCLUDED. §10 allowed `multi_tier_supply_chain` to be left out
// honestly — D58 records that nothing reads or writes it — and it is in anyway,
// because §15 counts 0 rows in it and an index on an empty table costs one
// statement, while an exclusion would be a permanent hole in this rule carried
// for a table WP 6.2 may drop. If a later package DOES need an exception, it
// belongs here, named, with its reason — not in a comment beside a sidecar and
// not in a drift-log entry that the gate cannot read.
//
// WHAT THIS RULE STILL CANNOT SEE, stated so it is not mistaken for more than it
// is: it checks that a non-surrogate unique key EXISTS, not that it is the key
// the grain implies, and not that the index treats NULLs the way the key needs
// (`natural_key_intended` is a list of columns; WP 3.3 found that a list of
// columns is not a specification of a constraint — see §4 D5). The columns are
// compared against `natural_key_intended` below, and the NULL rule is asserted
// where it can only be asserted, against a running database in
// `supabase/rehearsal/080`.
const surrogateOnly = (t) =>
  t.natural_key_unique.length > 0 &&
  t.natural_key_unique.every((k) => k.columns.length === 1 && k.columns[0] === "id");

for (const [name, path] of [...sidecars].sort()) {
  const doc = load(readFileSync(join(ROOT, path), "utf8"));
  if (doc.tier !== "2") continue;
  const t = tables.get(name);
  if (!t) continue; // R1/validate already reported it
  if (t.natural_key_unique.length === 0) {
    fail("R5", `"${name}" is tier 2 and has NO uniqueness at all — not even a primary key`);
    continue;
  }
  if (surrogateOnly(t)) {
    fail(
      "R5",
      `"${name}" is tier 2 and its only uniqueness is the surrogate \`id\` (D5). ` +
      `The grain implies ${doc.natural_key_intended ? `\`${doc.natural_key_intended.join(" + ")}\`` : "a key the sidecar has not stated"}; ` +
      "re-uploading the same file duplicates every row. Add the unique index, or " +
      "correct `natural_key_intended` if the grain is not what the sidecar says.",
    );
    continue;
  }
  // The key EXISTS. Now: is it the one the sidecar says the grain implies?
  // Without this half the rule is satisfied by any composite unique index, and a
  // key landed on the wrong columns would pass the gate that exists to land it.
  if (doc.natural_key_intended) {
    const intended = [...doc.natural_key_intended].sort().join(", ");
    const actual = t.natural_key_unique
      .filter((k) => !(k.columns.length === 1 && k.columns[0] === "id"))
      .map((k) => [...k.columns].sort().join(", "));
    if (!actual.includes(intended)) {
      fail(
        "R5",
        `"${name}" has a non-surrogate unique key, but not the one its sidecar says the grain implies. ` +
        `\`natural_key_intended\` is \`${intended}\`; the database has ${actual.map((a) => `\`${a}\``).join(", ")}. ` +
        "One of the two is wrong and the sidecar is the place to settle it.",
      );
    }
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

// §16 IS NOT CONTIGUOUS, AND THIS FUNCTION USED TO BELIEVE IT WAS — D124.
//
// The first version sliced from `## 16.` to `## 17.`, which is correct only while
// every drift-log entry is written before §17. Entries have been appended PAST it
// for months: **37 of 69 were visible and 32 were not**, among them every entry of
// this session. So R7's append-only half was protecting 37 entries, and R7's second
// half — "a package marked done has a §16 entry" — was answering about 37 while
// §7–§13 marks 23 packages done. A gate cannot notice an entry it cannot see, so
// this was two rules quietly scoped to the older half of the log.
//
// **The fix is ordering-INDEPENDENT on purpose.** Physically moving §17 to the end
// of the file also works — a parallel branch did exactly that — but it is six
// thousand lines of diff and it holds only until the next author appends past
// whatever is last. This reads §16 as everything from its own heading onward MINUS
// every later top-level section, and a later section runs from its `## N.` heading
// to whichever comes first: the next `## ` heading, the next `### ` heading (a
// drift entry appended past it — §17 has no sub-headings of its own), or EOF.
// Verified against BOTH document shapes: 69 entries with §17 in the middle, 69 with
// §17 moved to the end, and §17's own table excluded either way.
//
// ── AND A PHASE SECTION IS EXCLUDED WHOLE, WHICH THE `###` RULE ALONE CANNOT DO
//    (WP 8.0, §4 D146's merge).
//
// The rule above stops a later section at its first `### ` heading, on the stated
// assumption that such a section "has no sub-headings of its own" — true of §17,
// whose body is one table. It is NOT true of a PHASE section: §7–§13 and §18 each
// carry a `### WP N.M — …` heading per package, and those are ROADMAP headings, not
// drift-log entries. With §18 at the end of the document the older rule read its six
// package headings as six §16 entries, and R7's append-only half then reported a
// LOSS every time one of their titles was edited — a gate crying wolf about the one
// section it should never have been looking at.
//
// So a later section runs to the next `## ` heading when it is a phase section, and
// to the next `## ` OR `### ` otherwise. Both halves keep their reason: an entry
// appended past §17 is still recovered, and a phase's packages are never entries.
//
// Rejected: filtering entry headings on the `·` that carries their date. It is a
// real discriminator for 82 of the 90 headings in scope and it drops
// `### PHASE 3 → 4 HANDOFF`, a genuine entry with no date — so it would trade a
// false positive for a silent false negative on exactly the kind of entry that
// matters most.
const section16 = (text) => {
  const a = text.indexOf("\n## 16.");
  if (a < 0) return "";
  let rest = text.slice(a);
  for (;;) {
    const m = /\n## \d+\./.exec(rest.slice(1));
    if (!m) break;
    const start = m.index + 1;
    const after = rest.slice(start + 1);
    const heading = /^[^\n]*/.exec(after)[0];
    const isPhase = /^## \d+\.\s+Phase\b/.test(heading);
    const end = isPhase ? /\n(?=## )/.exec(after) : /\n(?=## |### )/.exec(after);
    rest = rest.slice(0, start) + (end ? after.slice(end.index) : "");
  }
  return rest;
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
  const roadmap = roadmapText(planText);

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
    console.log(
      `  R7  every done package has a §16 entry · ${donePackages.length} checked · ` +
      `${entryHeadings(readFileSync(PLAN, "utf8")).length} §16 entries in scope (D124)`,
    );
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
  const roadmap = roadmapText(planText);

  const headings = roadmap.split("\n").filter((l) => /^### WP /.test(l));
  const donePackages = new Set(
    headings
      .filter((l) => l.includes("✅"))
      .map((l) => l.match(/^### WP\s+([0-9]+\.[0-9]+[a-z]?)/i)?.[1])
      .filter(Boolean),
  );

  // A PACKAGE THAT EXISTS AT ALL, anywhere in the plan — §7–§13's roadmap plus
  // §14's deferred work. An owner the document does not contain is the same
  // failure as an owner who has gone home, arriving by a typo instead of by a
  // shipment, and nothing looked for it.
  //
  // From BOTH places the plan names a package, which R10 had to learn the same
  // way: a package has a `### WP N.M` heading, and a SUB-package of WP 5.2 has
  // a row in that package's own table (`| **5.2b** | …`) and no heading. This
  // rule's first run reported D21's owner WP 5.2b as a package the plan does
  // not contain — the RULE being wrong rather than the document, and a gate
  // that cries wolf gets relaxed rather than fixed.
  const knownPackages = new Set(
    [
      ...planText.split("\n")
        .filter((l) => /^### WP /.test(l))
        .map((l) => l.match(/^### WP\s+([0-9]+\.[0-9]+[a-z]?)/i)?.[1]),
      ...planText.split("\n")
        .filter((l) => /^\|\s*\*\*[0-9]+\.[0-9]+[a-z]?\*\*/.test(l))
        .map((l) => l.match(/^\|\s*\*\*([0-9]+\.[0-9]+[a-z]?)\*\*/)?.[1]),
    ].filter(Boolean),
  );

  // AND PHASE-LEVEL OWNERS, which is D41's shape in the blind spot of the gate
  // built to prevent D41. §4 D28's "Closed by" cell read `Phase 3` — its own
  // text says closing it "needs an auth model, which is a Phase 3 package" —
  // and no such package was ever written. The moment WP 3.4 shipped, D28 was
  // owned by a FINISHED PHASE, which is exactly the thing this rule exists to
  // refuse, and the rule could not see it because its regex matches `WP N.M`.
  //
  // A phase is finished when every package the roadmap lists for it is ✅. That
  // is derived from the same ✅ markers rather than from §17's prose, so it
  // cannot disagree with the rest of this rule (R10 is what keeps §17 honest).
  const byPhase = new Map();
  for (const l of headings) {
    const n = l.match(/^### WP\s+([0-9]+)\.[0-9]+[a-z]?/i)?.[1];
    if (!n) continue;
    if (!byPhase.has(n)) byPhase.set(n, []);
    byPhase.get(n).push(l.includes("✅"));
  }
  const donePhases = new Set(
    [...byPhase.entries()].filter(([, marks]) => marks.length > 0 && marks.every(Boolean)).map(([n]) => n),
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
      } else if (!knownPackages.has(n)) {
        orphaned += 1;
        fail("R8", `§4 ${id} is OPEN and its "Closed by" names WP ${n}, which this plan does not ` +
                   "contain. An owner the document does not have is not an owner — add the package, " +
                   "or name one that exists.");
      }
    }
    // A PHASE is an owner only while the phase still has a package left to run —
    // and only when the cell names NO package at all. A cell that names one has
    // an owner; the `Phase N` in it is prose (D36's cell cites "§16 · Phase 3's
    // last package" and is owned by WP 4.1), and reading that as a second owner
    // is the gate crying wolf, which gets it relaxed rather than fixed.
    const namesAPackage = (closedBy.match(/WP\s*[0-9]+\.[0-9]+[a-z]?/gi) ?? []).length > 0;
    for (const ph of namesAPackage ? [] : closedBy.match(/Phase\s*([0-9]+)/gi) ?? []) {
      const n = ph.replace(/Phase\s*/i, "");
      if (donePhases.has(n)) {
        orphaned += 1;
        fail("R8", `§4 ${id} is OPEN and its "Closed by" names Phase ${n}, every package of which ` +
                   "§7–§13 marks ✅ done. A phase is a weaker owner than a package and it stops being " +
                   "one entirely when the phase ends — name the package that will do the work.");
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
  // AND coverage.yaml's deferrals, which are the third document making the same
  // kind of promise. WP 3.1 is where this half was written, because WP 3.1 is
  // the package a deferral named: five tables waited under it since WP 1.4, and
  // the moment it ships ✅ any that are still deferred under it are deferred to
  // nobody. `coverage.yaml` says a deferral "names a work package that already
  // exists in PLAN.md" — the file's own words — and a package that has FINISHED
  // exists in exactly the way an owner who has gone home exists.
  for (const [table, wp] of deferred) {
    if (donePackages.has(wp)) {
      orphaned += 1;
      fail("R8", `coverage.yaml defers "${table}" to WP ${wp}, which §7–§13 marks ✅ done. ` +
                 "Write the sidecar, or move the deferral to a package that has not run. " +
                 "A table waiting on a finished package is a table nobody has decided about.");
    }
  }

  // AND THE SAME RULE FOR AN UNDEPLOYED FUNCTION — WP 6.3, and the gap was mine.
  //
  // R17 gave `functions_not_deployed` the shape `table-covered` has: a function is
  // deployed or deferred to a named package. It did NOT give it R8's half, so a
  // function could be deferred to a package that had already shipped — a function
  // nobody has decided about, which is the same defect one row down, and this
  // package created the register that made it possible. `ingest-file` was deferred
  // to WP 6.3 by WP 6.3, which is precisely the state R8 exists to refuse; WP 6.5
  // was written so the deferral has an owner that has not run.
  for (const row of coverage.functions_not_deployed ?? []) {
    const wp = String(row.wp ?? "");
    if (donePackages.has(wp)) {
      orphaned += 1;
      fail("R8", `coverage.yaml defers the edge function "${row.fn}" to WP ${wp}, which §7–§13 ` +
                 "marks ✅ done. Deploy it, or move the deferral to a package that has not run — " +
                 "an undeployed function waiting on a finished package is code nobody has decided " +
                 "about, and its absence from production is invisible (§4 D123).");
    } else if (wp && !knownPackages.has(wp)) {
      orphaned += 1;
      fail("R8", `coverage.yaml defers the edge function "${row.fn}" to WP ${wp}, which the plan ` +
                 "does not contain. Name a package that exists, or write one.");
    }
  }

  if (!orphaned)
    console.log(
      `  R8  no open defect or unmet invariant is owned by a finished package · ` +
        `${donePackages.size} done, ${donePhases.size} finished phase(s), ${knownPackages.size} named`,
    );
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

// ───────── R11: a DEFERRAL must SAY whether the table is audited (D54, WP 4.2)
//
// WHAT WENT WRONG WITHOUT IT. `dataPlaneAudit.test.ts` requires the three
// `audit_tier_write` triggers on every tier-2/3/4 table IN THE CONTRACT. That
// qualifier is load-bearing and it was invisible: a table deferred in
// coverage.yaml is outside the contract, therefore outside the rule, therefore
// its writes are unattributable and NOTHING anywhere says so. `tier2_suppliers`,
// `tier3_suppliers` and `multi_tier_supply_chain` sat in that gap from WP 2.3
// until WP 3.2 described them — and describing them is what turned the audit gate
// red, in the same session. The gap closed for those three by accident of
// somebody choosing to document them, not because a rule noticed.
//
// So the coverage list was DECIDING which tables are audited, by omission, and
// nobody chose that. This rule takes the decision away from the omission:
//
//   1. every deferred table must appear in its group's `audited:` map — a
//      missing entry is the silence D54 is about; and
//   2. the declared value must match the triggers the migrations actually
//      create, read from the same `auditedTables()` R9 uses. A deferral that
//      claims `audited: true` about a table with no trigger is the published
//      falsehood R9 exists to prevent, arriving through the other door.
//
// IT IS NOT A GATE ON BEING AUDITED, and it must not become one: 42 of 42
// deferred tables are unaudited today, so requiring `true` would be red on
// arrival and unlandable — the same reasoning that made WP 4.1's writer list a
// RATCHET rather than a gate. The rule requires the SENTENCE, not the trigger.
// `false` now has to be typed by a person, next to the work package that owns
// fixing it, and the count is printed on every run so it cannot quietly grow.

{
  const { auditedTables } = await import("./live-sql.mjs");
  const liveAudited = auditedTables();
  const undeclared = [];
  let wrong = 0;
  let unaudited = 0;

  for (const [table, wp] of deferred) {
    if (!deferredAudited.has(table)) { undeclared.push(`${table} (WP ${wp})`); continue; }
    const declared = deferredAudited.get(table) === true;
    const actual = liveAudited.has(table);
    if (declared !== actual) {
      wrong++;
      fail("R11", `coverage.yaml defers "${table}" (WP ${wp}) declaring \`audited: ${declared}\`, ` +
                  `but the migrations ${actual ? "DO" : "do NOT"} create its \`audit_tier_write\` triggers. ` +
                  "A deferral's audit claim is a fact about the schema and facts have one source (I1).");
    }
    if (!actual) unaudited++;
  }

  if (undeclared.length) {
    fail("R11", `${undeclared.length} deferred table(s) do not say whether they are audited: ` +
                `${undeclared.slice(0, 8).join(", ")}${undeclared.length > 8 ? ", …" : ""}.\n` +
                "        Add the table to its group's `audited:` map in coverage.yaml. A deferred\n" +
                "        tier-2/3/4 table with no audit trigger is an unattributable write path, and\n" +
                "        leaving the question unanswered is how it stays one (D54).");
  }

  if (!undeclared.length && !wrong) {
    console.log(`  R11 every deferral says whether it is audited · ${deferred.size} deferred · ` +
                `${unaudited} of them UNAUDITED, each owned by a named package (D54)`);
  }
}

// ───────────────── R10: §17 is the table a reader consults FIRST, so check it
//
// WHY THIS RULE EXISTS, and it is D41's shape in the one place it does the most
// damage. R7 rule 2 gates §16 entries against §7–§13's ✅ markers, so a package
// cannot be marked done without a drift-log entry. NOTHING checked §17. It went
// on saying "WP 3.2 is next" after WP 3.2 shipped — not from carelessness but
// because a status cell no gate reads is a status cell that decays, and this one
// is the first thing a cold session looks at. A sequencing table that is wrong
// about what is done is worse than no sequencing table: it is confidently wrong
// in the place a reader trusts most.
//
// WHAT IT CAN AND CANNOT CHECK. The status cells are prose, and a rule that tried
// to parse prose would be a rule that fails on a rewrite. So it checks the two
// claims that are UNAMBIGUOUS and were both wrong at once:
//
//   1. "WP N.M is next" may not name a package §7–§13 marks ✅.
//   2. "N.M ✅" in §17 may not name a package §7–§13 does NOT mark ✅ — §17 may
//      lag reality, but it may never claim more than the roadmap does.
//
// It deliberately does NOT require §17 to mention every done package: a phase row
// summarises, and forcing it to enumerate would turn a reader's table into a
// changelog. Rule 1 is what catches the staleness that actually happened.

{
  const planText = readFileSync(PLAN, "utf8");
  const seqStart = planText.indexOf("\n## 17. Sequencing");
  if (seqStart < 0) {
    fail("R10", "PLAN.md §17 could not be located — the section heading moved");
  } else {
    const roadmap = roadmapText(planText);
    const seq = planText.slice(seqStart);

    // Packages §7–§13 marks done, by number — from BOTH places the roadmap marks
    // one. A package has a `### WP N.M … ✅` heading; a SUB-package of WP 5.2 has
    // a row in that package's own table (`| **5.2a** ✅ | …`) and no heading of
    // its own. Reading only the headings made this rule's first run report 5.2a
    // and 5.2h as claims §7–§13 does not support, which was the RULE being wrong
    // rather than the document — and is worth the comment, because a gate that
    // cries wolf gets relaxed rather than fixed.
    const done = new Set([
      ...roadmap.split("\n")
        .filter((l) => /^### WP /.test(l) && l.includes("✅"))
        .map((l) => l.match(/^### WP\s+([0-9]+\.[0-9]+[a-z]?)/i)?.[1]),
      ...roadmap.split("\n")
        .filter((l) => /^\|\s*\*\*[0-9]+\.[0-9]+[a-z]?\*\*\s*✅/.test(l))
        .map((l) => l.match(/^\|\s*\*\*([0-9]+\.[0-9]+[a-z]?)\*\*/)?.[1]),
    ].filter(Boolean));

    // 1 — "WP N.M is next" on a package that has shipped.
    for (const m of seq.matchAll(/WP\s+([0-9]+\.[0-9]+[a-z]?)\s+is next/gi)) {
      if (done.has(m[1])) {
        fail("R10", `§17 says "WP ${m[1]} is next" and §7–§13 marks it ✅. ` +
                    "The sequencing table is the first thing a reader consults; " +
                    "point it at the package that IS next.");
      }
    }

    // 2 — §17 claiming a package done that the roadmap does not.
    for (const m of seq.matchAll(/\b([0-9]+\.[0-9]+[a-z]?)\s*✅/g)) {
      if (!done.has(m[1])) {
        fail("R10", `§17 marks "${m[1]}" ✅ and §7–§13 does not. ` +
                    "§17 may lag the roadmap; it may never claim more than it.");
      }
    }

    // 3 — §17's PROSE, which nothing checked. WP 6.2.
    //
    // Rules 1 and 2 ask whether §17's ✅ claims are supported by §7–§13. Neither asks
    // whether its SENTENCES are: the phase-5 row says "PHASE COMPLETE" while
    // `### WP 5.2 — The manual (§6.3)` carries no ✅ on its own heading, its ten
    // sub-packages carrying it instead. That single omission makes two rules dormant
    // for that package at once — R7 stops demanding a closing §16 entry for it, and R8
    // stops seeing what is deferred there (17 tables, plus §4 D102 and D104).
    //
    // A WARNING and not a failure, deliberately. The fix is either a ✅ plus a closing
    // entry or a correction to §17, and both belong to that package rather than to
    // whoever next runs `contract:check`. A gate that fails the build over somebody
    // else's bookkeeping gets relaxed; a line printed on every run does not go away.
    // The first cell may carry its own ✅ (`| 5 ✅ |`), which the first draft's regex
    // refused — and Phase 5 is the one case this check exists for.
    for (const m of seq.matchAll(/^\|\s*(\d+)\s*[✅\s]*\|[^\n]*?PHASE COMPLETE/gim)) {
      const ph = m[1];
      const unmarked = roadmap
        .split("\n")
        .filter((l) => new RegExp(`^### WP\\s+${ph}\\.[0-9]+[a-z]?\\s`).test(l) && !l.includes("✅"))
        .map((l) => l.match(/^### WP\s+([0-9]+\.[0-9]+[a-z]?)/)?.[1])
        .filter(Boolean);
      if (unmarked.length === 0) continue;
      const waiting = [...deferred.entries()].filter(([, wp]) => unmarked.includes(String(wp))).length;
      // ONLY when the omission is hiding something. Several phases mark their ✅ in
      // §17's range cell rather than on each heading, and a warning that fired for
      // every one of them would be noise about a formatting habit. It fires when
      // tables are waiting on an unmarked package, which is the case it is for.
      if (waiting === 0) continue;
      warn("R10",
        `§17 says Phase ${ph} is COMPLETE and §7–§13 leaves ${unmarked.join(", ")} unmarked. That ` +
        "makes R7 stop asking for a closing §16 entry and R8 stop seeing what is deferred there — " +
        `${waiting} table(s) today. Mark it with its entry, or correct §17.`);
    }

    if (!failures.some((f) => f.startsWith("R10"))) {
      console.log(`  R10 §17 agrees with §7–§13 · ${done.size} done package(s) cross-checked`);
    }
  }
}

// ───────── R19: A SECTION SLICE KEYS ON THE FIRST HEADING, SO THERE IS ONE
//
// FOUND BY THE SAME MERGE R16 WAS, AND IT IS THE HALF R16 DOES NOT COVER (§4 D146).
//
// One branch had moved `## 17. Sequencing` to the end of the document so that §16
// would run to it; the other had edited §17 in place. Both were right on their own,
// the lines never collided, and the merge produced a PLAN.md with TWO
// `## 17. Sequencing` headings.
//
// `section16()` slices from `## 16.` to the FIRST `## 17.`, and §4's own slice does
// the same between `## 4.` and `## 4.1`. So twenty-two drift-log entries fell
// outside §16 — which is D139 reopened four commits after it was closed, by a merge
// rather than by an edit. R7's append-only half could not see them, and R7's second
// half would have accepted a done package whose entry landed out there.
//
// R16 makes a defect's identity unique. This makes a SECTION's identity unique, for
// the same reason: everything that reads this document reads it by slicing on a
// heading, and a slice that keys on the first of two is a slice that silently drops
// everything after the second.
{
  const planText = readFileSync(PLAN, "utf8");
  const singletons = ["## 4. ", "## 16. ", "## 17. Sequencing"];
  let duplicated = 0;
  for (const heading of singletons) {
    const count = planText.split("\n").filter((l) => l.startsWith(heading.trimEnd())).length;
    if (count !== 1) {
      duplicated += 1;
      fail("R19", `PLAN.md has ${count} "${heading.trimEnd()}" heading(s) and must have exactly 1. ` +
                  "`section16()` and §4's own slice key on the FIRST occurrence, so a duplicate " +
                  "silently drops everything between the second one and the end of the section — " +
                  "which is how a merge reopened §4 D139 (see §4 D146).");
    }
  }
  if (!duplicated)
    console.log(`  R19 §4, §16 and §17 each have exactly one heading · ${singletons.length} checked`);
}

// ───────── R20: A MIGRATION VERSION IS A PRIMARY KEY, SO TWO FILES MAY NOT SHARE ONE
//
// FOUND BY A PRODUCTION DEPLOY FAILING, NOT BY A GATE (§4 D151).
//
// `supabase_migrations.schema_migrations` is keyed on `version` alone — the name
// after the version is not part of the key and is never compared. `main` carried
// FOUR files under TWO versions, one of each pair already applied in production, and
// the CLI's pending set (local versions minus remote versions) left the other copy
// looking pending. It ran that file's statements and died on the bookkeeping INSERT
// with a duplicate-key error, rolling the transaction back and taking the two
// migrations queued behind it with it.
//
// This is D146's collision in a PRIMARY KEY rather than in prose: a reader can
// resolve two meanings for one D-number, and a database cannot resolve two meanings
// for one version. `contract:rehearse` cannot see it in ANY of its three modes,
// because all three apply a branch's migrations by FILE and never go through
// `schema_migrations` — so the one gate that executes migrations is blind to it by
// construction, which is why the rule has to be static.
{
  const MIGRATIONS = join(ROOT, "supabase", "migrations");
  const byVersion = new Map();
  for (const f of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()) {
    const version = (f.match(/^(\d+)/) || [])[1];
    if (!version) {
      fail("R20", `migration "${f}" has no leading numeric version. The Supabase CLI keys ` +
                  "`schema_migrations` on that number; a file without one cannot be applied.");
      continue;
    }
    if (!byVersion.has(version)) byVersion.set(version, []);
    byVersion.get(version).push(f);
  }
  let collisions = 0;
  for (const [version, files] of byVersion) {
    if (files.length < 2) continue;
    collisions += 1;
    fail("R20", `migration version ${version} is used by ${files.length} files: ${files.join(", ")}. ` +
                "`schema_migrations` is keyed on the version alone, so the deploy applies one of " +
                "them and then aborts on a duplicate key — taking every migration queued behind it " +
                "with it (§4 D151). Renumber the file that has NOT been applied in production, and " +
                "keep the relative order of any migration that depends on it.");
  }
  if (!collisions)
    console.log(`  R20 migration versions are unique · ${byVersion.size} version(s) across ${[...byVersion.values()].flat().length} file(s)`);
}

// ──────────────────────────────────────────────────────────────────── report

const covered = [...sidecars.keys()].length;
// ───────── R17: AN EDGE FUNCTION IS DEPLOYED, OR DEFERRED WITH A REASON
//
// §4 D123: TWELVE OF EIGHTEEN edge functions were absent from
// `.github/workflows/supabase-functions.yml`. Their code shipped to `main`, CI went
// green, and they never reached production — and the workflow's history showed
// SUCCESS on the very commits that shipped them, because `supabase/functions/_shared/**`
// IS a path trigger: a change there fires the workflow, it deploys the functions it
// names, and reports success. An edge function bundles its imports at publish time,
// so the unnamed ones kept running the `_shared/` of whenever they were last pushed
// by hand. **Every signal said it had landed.**
//
// WP 4.3's dual-write is the headline case: shipped, green, recorded as done, and
// absent from production for two packages. `ingest-file` is the worse one — WP 3.2's
// entire deliverable, which §2.1's `ingestion-contract` (I7) row described as "a live
// second source" on the strength of `rehearsal/070`. That rehearsal proves the
// DATABASE path and says nothing about whether the function reaching it is published.
//
// Slice 15 named this gate and did not write it: "the same shape as `table-covered`,
// where a table is either described or deferred to a named package — and it would
// have caught this on the day WP 4.3 merged." This is it. A function is deployed or
// it is in `coverage.yaml`'s `functions_not_deployed` with an owner and a reason.
// There is no third option, which is what R1 took away from tables.
{
  const fnDir = join(ROOT, "supabase", "functions");
  const wfPath = join(ROOT, ".github", "workflows", "supabase-functions.yml");
  if (!existsSync(fnDir) || !existsSync(wfPath)) {
    fail("R17", "supabase/functions or the deploy workflow is missing — cannot check deployment coverage");
  } else {
    const wf = readFileSync(wfPath, "utf8");
    const deployed = new Set(
      [...wf.matchAll(/functions deploy ([a-z0-9-]+)/g)].map((m) => m[1]),
    );
    // The PATH TRIGGER matters as much as the deploy step: a function deployed by a
    // step whose path is not watched only redeploys when something else changes it.
    // That is how `_shared/**` made the history read as success.
    const watched = new Set(
      [...wf.matchAll(/supabase\/functions\/([a-z0-9-]+)\/\*\*/g)].map((m) => m[1]),
    );
    // THE THIRD CLAUSE, AND IT COST SEVEN CONSECUTIVE PRODUCTION DEPLOYS (D165).
    // A deploy STEP is not a deploy. `combine-project`'s step was added without the
    // `env:` block every one of its neighbours carries, so `supabase functions
    // deploy` exited 1 with "Access token not provided" on every push to `main`
    // since 2026-09-19 — and because the job runs `bash -e`, the step AFTER it never
    // ran either. R17 counted the step and reported the function deployed, which is
    // D123's own lesson arriving one level up: the gate read the intention to deploy
    // rather than the ability to.
    const deployStepMissingToken = [];
    for (const step of wf.split(/\n      - name: /).slice(1)) {
      const m = step.match(/functions deploy ([a-z0-9-]+)/);
      if (!m) continue;
      // The step ends where the next one begins; `split` already gave us exactly that.
      if (!/SUPABASE_ACCESS_TOKEN/.test(step)) deployStepMissingToken.push(m[1]);
    }
    for (const fn of deployStepMissingToken) {
      fail("R17",
        `${fn}'s deploy step carries no SUPABASE_ACCESS_TOKEN, so \`supabase functions ` +
        "deploy` exits 1 with \"Access token not provided\" and — under `bash -e` — takes " +
        "every later step in the job with it. The function never reaches production and " +
        "the workflow is red on every push (§4 D165). Add the `env:` block its neighbours have.");
    }

    const present = readdirSync(fnDir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith("_"))
      .map((d) => d.name)
      .sort();

    const deferredFns = new Map();
    for (const row of coverage.functions_not_deployed ?? []) {
      if (!row.fn || !row.wp || !row.why) {
        fail("R17", `a functions_not_deployed row is missing fn, wp or why: ${JSON.stringify(row)}`);
        continue;
      }
      deferredFns.set(row.fn, row);
    }

    for (const fn of present) {
      if (deployed.has(fn)) {
        if (!watched.has(fn)) {
          fail("R17",
            `${fn} has a deploy step and NO path trigger — it redeploys only when some ` +
            "other watched path changes. That is how `_shared/**` made this workflow's " +
            "history read as success while the functions it did not name went stale (D123). " +
            `Add 'supabase/functions/${fn}/**' to the push paths.`);
        }
        if (deferredFns.has(fn)) {
          fail("R17",
            `${fn} is deployed AND listed in functions_not_deployed — pick one. A stale ` +
            "deferral records work that is already done, which is the defect R8 exists for.");
        }
        continue;
      }
      const row = deferredFns.get(fn);
      if (!row) {
        fail("R17",
          `${fn} exists in supabase/functions/ and the deploy workflow never publishes it, ` +
          "so its code reaches `main` and never production — and CI goes green either way " +
          "(§4 D123). Add a deploy step AND a path trigger, or defer it in " +
          "coverage.yaml's `functions_not_deployed` with the package that will and why.");
      }
    }
    for (const fn of deferredFns.keys()) {
      if (!present.includes(fn)) {
        fail("R17", `functions_not_deployed names "${fn}", which is not a function in the repo`);
      }
    }
    console.log(
      `  R17 edge functions reach production · ${present.length} in the repo · ` +
      `${present.filter((f) => deployed.has(f)).length} deployed · ` +
      `${deferredFns.size} deferred with a named package (D123)`,
    );
  }
}

// ───────── R18: A DECLARED WRITER HAS TO BE A WRITER SOMEBODY CALLS
//
// §4 D118: `network_summary` declared `computed_by: combine-project` on five columns
// and that function never touches the table. Its whole write surface is
// `etl_replace_supply_chain` and `refresh_node_list_for_project`. The only statement
// that can insert a row is `bulk_insert_network_summary`, and NO CALL SITE EXISTS —
// not in `src/`, not in `supabase/functions/`. So a project created today has an
// empty `network_summary` and it stays empty, while the generated reference page
// marked every value column "written by combine-project".
//
// **THE SHAPE WAS RIGHT AND THE CONTENT WAS WRONG, WHICH IS THE ONE KIND OF WRONG A
// GENERATOR CANNOT CATCH.** `computed_by` is load-bearing since D101 —
// `graphHashCoverage.test.ts` derives the computed-column set from it instead of a
// literal Set — so every gate downstream believed it. It was also the only one of the
// five tables declaring `computed_by` that was wrong, which is how long a single
// wrong value survives when nothing compares it to the tree.
//
// TWO THINGS THIS RULE LEARNED FROM ITS OWN FIRST RUN, both worth keeping:
//
//   * **A declared writer is resolved against the writers that EXIST** — the edge
//     function directories and the SQL functions the artifact knows — rather than
//     pattern-matched out of the text. One sidecar's value is
//     `"calculate-node-prominence (and calculate-network-science-metrics)"`, prose
//     naming two real functions, and a rule that treated the whole string as one
//     identifier called both of them missing.
//   * **A function's own DEFINITION is not a call site.** `bulk_insert_network_summary`
//     appears in `20250905160724` because that migration creates it, and the first
//     draft read that as "something refers to it" — which would have passed the exact
//     value D118 is about. `CREATE`/`DROP`/`ALTER`/`COMMENT ON`/`GRANT`/`REVOKE` lines
//     are excluded, so what is left is somebody using it.
//
// An unreachable writer is ALLOWED — `bulk_insert_network_summary` is one, and naming
// it is more honest than naming a live function that does not write the table — but it
// has to be DECLARED, with `computed_by_unreachable` and a reason the reference page
// prints. A stale exemption fails too: telling a reader a live writer is dead is its
// own defect.
//
// **WHAT THIS RULE DOES NOT CHECK, AND IT IS THE HALF D118 ACTUALLY WAS.** It answers
// "does this writer exist, and does anything call it" — not "does it write THIS
// table". Naming `combine-project` on a `network_summary` column would still pass on
// its own terms, because that function exists and is called; what catches it now is
// the STALE EXEMPTION (the note says the writer is dead, the writer is live), and that
// is a second-order catch rather than the thing itself. Checking the write surface
// means parsing every branch of a 1 000-line edge function for the tables it touches,
// which is a static analysis this repository does not have and should not fake. Named,
// not taken — and the reason it is tolerable is that a wrong-but-live writer is now
// visible in the reference page as a declared claim a reader can check, where before
// it was invisible.
{
  const walk = (dir, out = []) => {
    if (!existsSync(dir)) return out;
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === "node_modules" || e.name === "__tests__") continue;
        walk(full, out);
      } else if (/\.(ts|tsx|sql|py)$/.test(e.name)) out.push(full);
    }
    return out;
  };

  // WHICH WRITERS EXIST. Edge functions are directories; SQL functions come from the
  // introspected artifact, which is the schema's own account of itself.
  const edgeFns = existsSync(join(ROOT, "supabase", "functions"))
    ? readdirSync(join(ROOT, "supabase", "functions"), { withFileTypes: true })
        .filter((d) => d.isDirectory() && !d.name.startsWith("_"))
        .map((d) => d.name)
    : [];
  const sqlFns = (schema.functions ?? []).map((f) => f.name).filter(Boolean);
  const knownWriters = [...new Set([...edgeFns, ...sqlFns])].sort((a, b) => b.length - a.length);

  // The tree a CALLER lives in. Deliberately NOT the sidecars or the generated
  // artifacts: a name that appears only in the contract and in the file the contract
  // generated is a name nothing calls, which is the whole subject.
  const callerFiles = [
    ...walk(join(ROOT, "src")),
    ...walk(join(ROOT, "supabase", "functions")),
    ...walk(join(ROOT, "supabase", "migrations")),
    ...walk(join(ROOT, "sim-worker")),
    ...walk(join(ROOT, "scsim")),
  ].filter((f) => !/\.generated\.|generated[/\\]/.test(f));
  const callerLines = callerFiles
    .flatMap((f) => readFileSync(f, "utf8").split("\n"))
    // A definition, a grant or a COMMENT is not a call — and the comment half is not
    // hypothetical: `20250905160724`'s first line is
    // `-- Fix the bulk_insert_network_summary function …`, so prose about a dead
    // function would have counted as somebody calling it, which is the exact value
    // §4 D118 is about passing its own gate.
    .filter((l) => !/\b(CREATE|DROP|ALTER|COMMENT\s+ON|GRANT|REVOKE)\b/i.test(l))
    .filter((l) => !/^\s*(--|\/\/|\*|#)/.test(l));
  const calledSomewhere = (name) => {
    const re = new RegExp(`\\b${name.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")}\\b`);
    return callerLines.some((l) => re.test(l));
  };

  let declared = 0;
  let exempt = 0;
  let unresolved = 0;
  // `sidecars` maps a table name to its PATH, not to parsed YAML — the same trap R9's
  // first version fell into, which "found every table undeclared, which happens to be
  // the answer it expected." This rule's first version reported 0 declarations for the
  // same reason, and 0 of 0 passes.
  for (const [table, path] of sidecars) {
    const sc = load(readFileSync(join(ROOT, path), "utf8"));
    for (const [field, spec] of Object.entries(sc.fields ?? {})) {
      const value = spec?.computed_by;
      if (!value) continue;
      declared += 1;
      const note = spec?.computed_by_unreachable;
      const named = knownWriters.filter((w) => value.includes(w));
      if (named.length === 0) {
        unresolved += 1;
        fail("R18",
          `${table}.${field} declares \`computed_by: ${value}\`, which names no function this ` +
          "repository contains — not an edge function directory and not a SQL function in the " +
          "introspected schema. A declared producer that does not exist is a fact with the right " +
          "shape and no content (§4 D118).");
        continue;
      }
      const dead = named.filter((w) => !calledSomewhere(w));
      if (dead.length === 0) {
        if (note) {
          fail("R18",
            `${table}.${field} declares \`computed_by_unreachable\` and every writer it names ` +
            `(${named.join(", ")}) IS called somewhere. A stale exemption is worse than none: it ` +
            "tells a reader the writer is dead when it is live. Remove the note.");
        }
        continue;
      }
      if (!note) {
        fail("R18",
          `${table}.${field} declares \`computed_by: ${value}\` and ${dead.join(", ")} is called ` +
          "NOWHERE a caller could live — not in src/, supabase/functions/, supabase/migrations/, " +
          "sim-worker/ or scsim/, counting a definition or a grant as not a call. So nothing runs " +
          "it and the column is permanently empty. Name the real writer, or declare " +
          "`computed_by_unreachable` with the reason (§4 D118).");
        continue;
      }
      exempt += 1;
    }
  }
  if (!unresolved)
    console.log(
      `  R18 every declared writer is reachable or says why not · ${declared} \`computed_by\` ` +
      `declaration(s) over ${knownWriters.length} known writer(s) · ${exempt} declared unreachable (D118)`,
    );
}

// ───────── R16: A D-NUMBER IS AN IDENTITY, SO IT HAS TO BE UNIQUE
//
// FOUND BY A MERGE, WHICH IS THE ONLY WAY IT COULD BE FOUND (WP 6.3).
//
// Two branches each took "the next free D-number" from the same §4 and each was
// right on its own. The merge produced §4 with TWO D112 rows describing different
// defects, TWO D113, TWO D114 — and, worse, duplicated four EXISTING rows (D87-D90)
// because the table's lines merged cleanly line by line while meaning nothing as a
// table.
//
// NOTHING NOTICED. Every rule that walks §4 iterates rows: R6 resolved both
// citations, R8 read both owners, and `trustReportLimits.test.ts` built a Map keyed
// by D-number and silently kept whichever came last — so a closed defect and an
// open one shared a key and the open one won. A D-number is the identity CLAUDE.md
// makes every other document cite by ("cite §4 by D-number"), and an identity that
// can be duplicated is not one.
//
// The rule is the cheapest possible and it would have gone red on the merge commit.
{
  const plan4 = readFileSync(PLAN, "utf8");
  const s4start = plan4.indexOf("\n## 4. ");
  const s4end = plan4.indexOf("\n### 4.1 ");
  const section4 = s4start < 0 ? "" : plan4.slice(s4start, s4end < 0 ? undefined : s4end);
  const seen = new Map();
  for (const line of section4.split("\n")) {
    const m = /^\|\s*\*{0,2}(D[0-9]+)\*{0,2}\s*\|/.exec(line);
    if (!m) continue;
    const id = m[1];
    if (seen.has(id)) {
      fail("R16",
        `§4 has more than one ${id} row. A D-number is the identity every other ` +
        "document cites by, so a duplicate is two defects with one name — and every " +
        "rule that walks §4 silently keeps whichever it saw last. Renumber the newer " +
        "row (§4's highest number + 1) and update its references, or delete the " +
        "duplicate if a merge produced it.\n" +
        `      first:  ${seen.get(id).slice(0, 120)}\n` +
        `      second: ${line.slice(0, 120)}`);
      continue;
    }
    seen.set(id, line);
  }
  // A number may be SKIPPED — a row can be deleted — but the count is printed so a
  // gap is visible rather than discovered by the next author picking a used number.
  const nums = [...seen.keys()].map((d) => Number(d.slice(1))).sort((a, b) => a - b);
  const highest = nums.length ? nums[nums.length - 1] : 0;
  const gaps = [];
  for (let i = 1; i <= highest; i++) if (!nums.includes(i)) gaps.push(`D${i}`);
  console.log(
    `  R16 §4 D-numbers are unique · ${seen.size} row(s) · highest D${highest}` +
    (gaps.length ? ` · ${gaps.length} unused (${gaps.slice(0, 8).join(", ")}${gaps.length > 8 ? ", …" : ""})` : " · none unused") +
    ` · next free is D${highest + 1}`,
  );
}

// ───────── R15: A SIDECAR MAY NOT CONTRADICT ITSELF ABOUT ITS OWN READERS
//
// §4 D58, and it is §4 D101's shape one scope tighter — not two files disagreeing,
// ONE FILE disagreeing with itself.
//
// `multi_tier_supply_chain.contract.yaml` carried a `surfaces` entry naming
// `DataManager.tsx` via `rpc delete_project_dataset` with `confirmed: true`, and
// twenty lines later a prose note reading "no RPC writes it … no application code
// in `src/` or `supabase/functions/` mentions it". Both were authored by hand, both
// describe what reaches the table, and nothing compared them. **The generated page
// renders the PROSE**, so the manual told users nothing touches a table that the
// project manager's "Delete ALL data" button empties.
//
// The rule is narrow on purpose. It does not try to read prose in general — it looks
// for the specific CLAIM OF ABSENCE that `surfaces` can refute, in a table that has
// `surfaces` entries. A sidecar is free to say a table has no UPLOAD, no WRITER, or
// no engine consumer; it may not say nothing REACHES it while its own lineage block
// names something that does.
{
  const contract = JSON.parse(readFileSync(GENERATED, "utf8"));
  // Phrases that deny any application path at all. Each is a sentence a reader
  // would take as "no code touches this", which `surfaces` is the authority on.
  const DENIES_ALL_ACCESS = [
    /no\s+application\s+code[^.]{0,80}mentions\s+it/i,
    /nothing\s+(?:reads|touches|reaches)\s+it\b/i,
    /no\s+reader\s+and\s+no\s+writer/i,
  ];
  let checked = 0;
  let cleared = 0;
  for (const t of Object.values(contract.tables)) {
    const surfaces = t.surfaces ?? [];
    const confirmed = surfaces.filter((x) => x.confirmed && x.via);
    if (confirmed.length === 0) continue;
    checked++;
    const note = String(t.note ?? "");
    if (!note) continue;
    const denial = DENIES_ALL_ACCESS.find((re) => re.test(note));
    if (!denial) { cleared++; continue; }
    // The denial stands ONLY if the note also accounts for the surface — naming
    // the path, or the rule, somewhere in its own text. That is the correction
    // D58 took: keep the claim, and say what the exception is.
    const accounted = confirmed.every((x) => {
      const rpc = /rpc\s+([a-z_][a-z0-9_]*)/i.exec(String(x.via))?.[1];
      return rpc ? note.includes(rpc) : note.includes(String(x.via));
    });
    if (accounted) { cleared++; continue; }
    fail("R15",
      `${t.table}'s note claims nothing in the application reaches it, and its own ` +
      `\`surfaces\` block confirms ${confirmed.length}: ` +
      `${confirmed.map((x) => `${x.page} via ${x.via}`).join("; ")}. ` +
      "One file, two statements of one fact, and the generated page renders the " +
      "prose — so the contradiction is published to users (D58, D101's shape). " +
      "Name the path in the note, or stop claiming the absence.");
  }
  console.log(
    `  R15 no sidecar denies a reader it confirms · ${checked} table(s) with a confirmed surface · ` +
    `${cleared} whose note is consistent with it (D58)`,
  );
}

// ───────── R14: A DYNAMIC RLS STATEMENT MUST NAME SOMETHING
//
// §4 D51 — the introspector cannot EVALUATE `EXECUTE format(…)`, and it does not
// try. What it does is mark every table such a statement touches as
// `determinate: false`, which the generated page renders as "the migrations do
// not say" rather than as "off". That flag keys on the names it can see, and when
// the target arrives through a `%1$s` placeholder there are none — so the three
// `erp_staged_*` tables were recorded as determinately policy-less, and their
// pages said so, for the whole of Phase 2. A published falsehood, CI-gated, in
// the D40 shape pointing the other way.
//
// WP 6.2 widened the name scan to the enclosing DO block, where a loop variable
// is actually bound. That made `20260614000001`'s policy statement resolve — and
// it had been resolving by ACCIDENT before, because the array literal happened to
// share a semicolon-fragment with the `ENABLE ROW LEVEL SECURITY` line. Written
// with the ENABLE outside the loop, all three item masters would have been
// recorded as determinately policy-less.
//
// THIS IS A GATE AND NOT A RATCHET BECAUSE IT IS EMPTY. Every dynamic statement
// that touches RLS today resolves at least one table this schema has. One that
// resolves none has marked nothing indeterminate, so the schema's RLS story for
// its target is whatever other statements happened to say — with nothing
// recording that a run-time statement also had an opinion. That is exactly the
// silence D51 was, and it fails here on the commit that introduces it.
{
  const unresolved = schema.rls_dynamic_unresolved;
  if (!Array.isArray(unresolved)) {
    fail("R14", "build/schema.introspected.json has no `rls_dynamic_unresolved` — " +
      "re-run `npm run contract:introspect`; a missing list is not an empty one");
  } else {
    for (const d of unresolved) {
      fail("R14",
        `${d.migration} runs a dynamic statement that touches RLS and names no table ` +
        `this schema has${d.has_format_placeholder ? " (its target is assembled through a format placeholder)" : ""}. ` +
        "Nothing is marked indeterminate, so the generated page will state an RLS " +
        "story the migrations do not support (D51). Name the tables literally, or " +
        "put the loop's source literal inside the same DO block.\n" +
        `      ${d.statement}`);
    }
    console.log(
      `  R14 dynamic RLS statements resolve · ${(schema.dynamic_ddl ?? []).filter((d) => d.touches_rls).length} touch RLS · ` +
      `${unresolved.length} name no known table · ` +
      `${(schema.dynamic_ddl ?? []).filter((d) => d.named_only_via_block).length} resolved only via the enclosing block (D51)`,
    );
  }
}

// ───────── R13: A DECLARED REQUIREMENT IS DESCRIBED, AND IS NOT SWALLOWED
//
// TWO RULES THAT ONLY LOOK LIKE ONE, and the second was found by trying to
// satisfy the first.
//
// (1) §4 D94 — `contract:generate` already refuses a `base_data_requirements`
// field the contract has no column for. Its INVERSE had nobody: an IMPLEMENTED
// policy could read an entity field, declare nothing, and the sidecar would
// record `consumed_by: null` with nothing to contradict it. That is exactly how
// `P-C.2`'s two `Customer` reads survived a trace, a sidecar rewrite and a
// resolution-chain package. So: a requirement declared by a policy whose
// `status` is `implemented` must name a column the contract describes, and that
// column's `engine.consumed_by` may not be null.
//
// (2) §4 D112 — a requirement the GRADER has no binding for is dropped, in
// silence, on every surface: `grading.ts::flattenFindings`, `validationService
// .ts::compileRequiredDataFindings` and `trustReport.ts` each skip a field whose
// `evaluable` is false, and `itemMasterCandidates.ts` twice more. Thirteen of
// thirteen declared fields were bound when WP 6.2 looked, which is why nothing
// had ever noticed: the FIRST declaration for a table the grader does not load
// would have been declared in the engine, described in the contract, and
// invisible to every reader — T1's "no number without a source" inverted into a
// source with no number. A binding is `FIELD_BINDINGS` in the shared grader, and
// this rule counts the fields that have none so the next one cannot vanish.
{
  const registryPath = join(ROOT, "src", "lib", "policies", "registry.generated.json");
  const gradingPath = join(ROOT, "supabase", "functions", "_shared", "grading.ts");
  if (!existsSync(registryPath) || !existsSync(gradingPath)) {
    fail("R13", "the registry snapshot or the shared grader is missing — cannot check declared requirements");
  } else {
    const registry = JSON.parse(readFileSync(registryPath, "utf8"));
    const grading = readFileSync(gradingPath, "utf8");
    // `FIELD_BINDINGS` keys, read from the grader itself rather than listed here:
    // a second list of the same fact is the defect this rule is about.
    const boundFields = new Set(
      [...grading.matchAll(/"([a-z_]+\.[a-z_]+)":\s*\{\s*rows:/g)].map((m) => m[1]),
    );
    if (boundFields.size === 0) {
      fail("R13", "no FIELD_BINDINGS parsed out of grading.ts — fix the scan rather than reporting zero");
    }
    const contract = JSON.parse(readFileSync(GENERATED, "utf8"));
    const declared = new Map();
    const note = (req, who) => {
      const prev = declared.get(req.field);
      declared.set(req.field, prev ? { ...prev, by: `${prev.by}, ${who}` } : { req, by: who });
    };
    for (const req of registry.base_data_requirements ?? []) note(req, "the engine");
    for (const pol of registry.policies ?? []) {
      // Only an IMPLEMENTED policy's requirement is a fact about running code. A
      // `planned` policy declaring a field it will one day read is a design note,
      // and holding the contract to it would be the mirror of D95: giving a
      // column a reason that belongs to a different column.
      if (pol.status !== "implemented") continue;
      for (const req of pol.data_requirements ?? []) note(req, pol.catalog_ref ?? pol.id);
    }

    let unbound = 0;
    const unboundFields = [];
    for (const [field, { by }] of declared) {
      // Counted BEFORE the resolution checks below, which `continue`. A count
      // that only sees the fields that resolved is a count that reports zero on
      // the day everything breaks.
      if (!boundFields.has(field)) { unbound++; unboundFields.push(field); }
      const [table, column] = field.split(".");
      const described = contract.tables?.[table];
      if (!described) {
        fail("R13",
          `the engine declares "${field}" (${by}) and the contract describes no table "${table}" — ` +
          "describe it or stop declaring the field; a requirement nothing can resolve is D95's shape");
        continue;
      }
      const col = (described.columns ?? []).find((c) => c.name === column);
      if (!col) {
        fail("R13",
          `the engine declares "${field}" (${by}) and "${table}" has no column "${column}"`);
        continue;
      }
      if (!col.engine || col.engine.consumed_by === null || col.engine.consumed_by === undefined) {
        fail("R13",
          `"${field}" is a declared data requirement of ${by} and its sidecar says ` +
          "`consumed_by: null` — the engine and the contract disagree about whether anything reads it (D94)");
      }
    }

    // The count is printed rather than failed. A binding needs the table in
    // `GradingDataset`, which is a loader change in two runtimes, so a
    // declaration may legitimately land one commit ahead of it — but it may not
    // land SILENTLY, which is the whole of D112.
    if (unbound > 0) {
      warn("R13", `${unbound} declared requirement(s) have no FIELD_BINDINGS entry, so every ` +
        "grading surface drops them (`evaluable: false`). Add the binding or record the gap (D112): " +
        unboundFields.join(", "));
    }
    console.log(
      `  R13 declared requirements resolve · ${declared.size} declared by implemented policies + the engine · ` +
      `${declared.size - unbound} gradeable, ${unbound} not (D94, D112)`,
    );
  }
}

// ───────── R12: LINEAGE MUST RESOLVE, AND EVERY PAGE MUST BE ACCOUNTED FOR
//
// WP 5.1 fills `surfaces`, and its brief is one sentence long about why this
// rule exists: "an unconfirmed lineage entry is worse than none — it will be
// trusted." A lineage entry is a claim about a file and a line, and §4's own
// citations went stale within a quarter for want of anything re-opening them
// (D21, D22). So every entry carries `path:line` and this rule opens it.
//
// TWO HALVES, and the second is the gap check §12 asks for:
//
//   1. every `surfaces` entry's evidence resolves — the file exists, the line
//      is in range, and an access is actually there (±2 lines, because a
//      formatter moving a chained call by one is not a lineage defect and a
//      gate that fails on reflow is a gate people switch off);
//   2. every page in `src/pages` appears in at least one entry OR is declared
//      in `coverage.yaml`'s `pages_without_project_data`. A page in neither is a
//      page nobody has decided about — the same silence R11 took away from the
//      deferral list.
{
  const rd = readdirSync;
  const pagesDir = join(ROOT, "src", "pages");
  const allPages = rd(pagesDir).filter((f) => f.endsWith(".tsx"));
  const seenPages = new Set();
  let entries = 0;
  let unconfirmed = 0;

  const checkEntry = (where, e) => {
    entries++;
    // A `shell` entry does NOT count as lineage and that is deliberate. It says
    // the page reaches this table only through auth/session plumbing every page
    // imports — which is a fact worth recording and is not "this is where the
    // data is shown". Letting it satisfy the coverage half would mean a page
    // that renders nothing passes because it imports `useAuth`, which is the
    // over-claim WP 5.1's first analyser run produced for fifteen pages.
    if (e.grain !== "shell") seenPages.add(e.page);
    if (e.confirmed === false) unconfirmed++;
    if (!allPages.includes(e.page)) {
      fail("R12", `${where} names page "${e.page}", which does not exist in src/pages`);
      return;
    }
    const [file, lineStr] = String(e.evidence).split(":");
    const abs = join(ROOT, file);
    if (!existsSync(abs)) {
      fail("R12", `${where} cites \`${e.evidence}\` — no such file`);
      return;
    }
    const lines = readFileSync(abs, "utf8").split("\n");
    const line = Number(lineStr);
    if (!(line >= 1 && line <= lines.length)) {
      fail("R12", `${where} cites \`${e.evidence}\` but that file has ${lines.length} lines — the lineage is stale`);
      return;
    }
    const window = lines.slice(Math.max(0, line - 3), line + 2).join("\n");
    if (!/\.from\(\s*["'][a-z_]+["']\s*\)|\.rpc\(\s*["'][a-z_]+["']/.test(window)) {
      fail("R12", `${where} cites \`${e.evidence}\`, and there is no table read or rpc call within two lines of it. ` +
        `A lineage entry whose evidence has moved is exactly what D21 and D22 look like.`);
    }
  };

  // Read the SIDECARS, not the generated artifact: the sidecar is what a person
  // authored, and checking the derived copy would let an un-regenerated artifact
  // hide a stale entry behind a second failure.
  for (const [name, rel] of sidecars) {
    const doc = load(readFileSync(join(ROOT, rel), "utf8"));
    for (const e of doc.surfaces ?? []) checkEntry(`${name}.surfaces`, e);
    for (const [field, f] of Object.entries(doc.fields ?? {})) {
      for (const e of f?.surfaces ?? []) checkEntry(`${name}.${field}.surfaces`, e);
    }
  }

  const declared = new Set(coverage.pages_without_project_data ?? []);
  for (const d of declared) {
    if (!allPages.includes(d)) {
      fail("R12", `coverage.yaml declares "${d}" as reading no project data, and no such page exists`);
    }
    if (seenPages.has(d)) {
      fail("R12", `coverage.yaml declares "${d}" as reading no project data, but it appears in a surfaces entry — one of the two is wrong`);
    }
  }
  for (const p of allPages) {
    if (seenPages.has(p) || declared.has(p)) continue;
    fail("R12", `page "${p}" appears in no \`surfaces\` entry and is not declared in coverage.yaml's ` +
      `pages_without_project_data. A page in neither is a page nobody has decided about.`);
  }

  console.log(
    `  R12 lineage resolves · ${entries} surface entr(ies) across ${seenPages.size} page(s) · ` +
    `${declared.size} page(s) declared as reading no project data · ${unconfirmed} UNCONFIRMED`,
  );
}

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
