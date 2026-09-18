#!/usr/bin/env node
/**
 * `npm run typecheck` — the gate that did not exist, and D57 is what that cost.
 *
 * ── WHY THIS FILE IS HERE ─────────────────────────────────────────────────
 *
 * `reference.generated.ts` declared `RefColumn.references` as `string | null`
 * and the generator wrote an OBJECT into it. Sixty-one TS2322 errors, emitted
 * by our own generator, sitting in a committed artifact since WP 5.2h — and
 * NOTHING in this repository would ever have said so:
 *
 *   · `npm run build` is Vite. Vite transpiles; esbuild strips types without
 *     checking them. A type error is not a build error here.
 *   · `contract:generate -- --check` compares the file it would write against
 *     the file on disk. Both were equally wrong, so the comparison passed.
 *   · `package.json` had no typecheck script at all.
 *   · And a bare `tsc --noEmit` at the root passes VACUOUSLY: `tsconfig.json`
 *     has `"files": []` and nothing but project references, so it typechecks
 *     the empty set and exits 0. A gate that cannot fail is worse than no gate,
 *     because it is reported as one.
 *
 * So this script pins the project explicitly (`tsconfig.app.json`, which is the
 * one with `"include": ["src"]`) and PROVES the program is non-empty before it
 * believes a clean result — see `assertNonVacuous`.
 *
 * ── WHY A RATCHET AND NOT A GATE ──────────────────────────────────────────
 *
 * Twenty-eight type errors predate D57 in nine files nothing in Phase 5 wrote —
 * Supabase client generics, a `Provenance` union, a `MobileRowProps` missing
 * `key`. Paying those down is not this package's, and a gate that is red on
 * arrival is a gate people route around, which is precisely what `npm run lint`
 * became (§4 D85). So the baseline below is a RATCHET, the same shape as
 * `resolutionChains.test.ts`'s `KNOWN_BREAKS`:
 *
 *   · a file with MORE errors than its baseline fails
 *   · a file with NO baseline and any error fails
 *   · a file with FEWER errors than its baseline fails too, asking for the
 *     number to be lowered — so the list cannot record debt already paid
 *
 * The baseline lives in `scripts/typecheck-baseline.json`, one entry per file,
 * and it may only ever shrink.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PROJECT = "tsconfig.app.json";
const BASELINE = join(ROOT, "scripts", "typecheck-baseline.json");

/** A file that must be in the program. If it is not, the run proved nothing. */
const CANARY = "src/main.tsx";

function tsc(args) {
  return spawnSync("npx", ["tsc", "-p", PROJECT, "--noEmit", ...args], {
    cwd: ROOT,
    encoding: "utf8",
    shell: process.platform === "win32",
  });
}

/**
 * Refuse to report success from an empty program.
 *
 * This is the whole reason D57 survived: `tsc --noEmit` at the repository root
 * exits 0 having read nothing. Asking tsc which files it loaded is the only
 * answer that cannot be faked by a config change.
 */
function assertNonVacuous() {
  const r = tsc(["--listFilesOnly"]);
  const files = (r.stdout ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
  const inProgram = files.filter((f) => f.includes("/src/") && !f.includes("node_modules"));
  if (!files.some((f) => f.endsWith(CANARY)) || inProgram.length < 50) {
    console.error(
      `typecheck: ${PROJECT} loaded ${inProgram.length} file(s) under src/ and ` +
        `${files.some((f) => f.endsWith(CANARY)) ? "did" : "did NOT"} include ${CANARY}.\n` +
        "That is not a program worth believing a green result from. Check the " +
        "project's `include` before trusting this gate.",
    );
    process.exit(2);
  }
  return inProgram.length;
}

const ERROR_LINE = /^(.+?)\((\d+),(\d+)\): error (TS\d+): (.*)$/;

function collect() {
  const r = tsc([]);
  const out = `${r.stdout ?? ""}\n${r.stderr ?? ""}`;
  const byFile = new Map();
  for (const line of out.split("\n")) {
    const m = ERROR_LINE.exec(line.trim());
    if (!m) continue;
    const file = m[1].replace(/\\/g, "/");
    if (!byFile.has(file)) byFile.set(file, []);
    byFile.get(file).push({ code: m[4], message: m[5] });
  }
  return byFile;
}

const loaded = assertNonVacuous();
const byFile = collect();
const baseline = JSON.parse(readFileSync(BASELINE, "utf8"));
const known = baseline.files ?? {};

const grown = [];
const appeared = [];
const shrunk = [];

for (const [file, errors] of [...byFile].sort()) {
  const allowed = known[file]?.count ?? 0;
  if (allowed === 0) appeared.push({ file, errors });
  else if (errors.length > allowed) grown.push({ file, was: allowed, now: errors.length, errors });
}
for (const [file, entry] of Object.entries(known)) {
  const now = byFile.get(file)?.length ?? 0;
  if (now < entry.count) shrunk.push({ file, was: entry.count, now });
}

const total = [...byFile.values()].reduce((n, e) => n + e.length, 0);
const allowedTotal = Object.values(known).reduce((n, e) => n + e.count, 0);

console.log(`typecheck — ${PROJECT}, ${loaded} file(s) under src/`);
console.log(`  ${total} error(s); ${allowedTotal} held in the baseline across ${Object.keys(known).length} file(s)`);

if (appeared.length) {
  console.error("\nNEW type errors in files the baseline does not hold:");
  for (const a of appeared) {
    console.error(`  ${a.file} — ${a.errors.length}`);
    for (const e of a.errors.slice(0, 5)) console.error(`      ${e.code}: ${e.message}`);
    if (a.errors.length > 5) console.error(`      … and ${a.errors.length - 5} more`);
  }
}
if (grown.length) {
  console.error("\nMORE type errors than the baseline allows:");
  for (const g of grown) console.error(`  ${g.file} — was ${g.was}, now ${g.now}`);
}
if (shrunk.length) {
  console.error("\nFEWER errors than the baseline claims — lower it, so it cannot record paid debt:");
  for (const s of shrunk) console.error(`  ${s.file} — baseline says ${s.was}, actual ${s.now}`);
}

if (appeared.length || grown.length || shrunk.length) {
  console.error(
    "\nThe baseline is a ratchet: it may shrink and it may not grow. Fix the " +
      "error, or — if you are paying down existing debt — lower the number in " +
      "scripts/typecheck-baseline.json.",
  );
  process.exit(1);
}

console.log("✓ no new type errors");
