#!/usr/bin/env node
// D33 · ONE CAPABILITY CATALOG, AUTHORED ONCE.
//
//   npm run contract:capabilities            # regenerate src/lib/capabilities.generated.ts
//   npm run contract:capabilities -- --check # fail if the committed file has drifted
//
// The catalog lives in `public.capabilities`, seeded across NINE migrations, and
// again in `src/lib/capabilities.ts` as a union type, two arrays and a role
// fallback — because the client needs the labels without a round trip. Nothing
// checked that the two agreed and they had already drifted: the DB grew from 5
// feature keys to twenty-odd and the TypeScript learned of each one only when
// somebody remembered. A key in the DB and not in TS is a capability no client
// can ever be granted; the reverse is a permission screen offering a right that
// resolves to false.
//
// WHICH SIDE GENERATES WHICH. The migrations do, and the TypeScript is the
// artifact — the same direction as every other generator in this contract
// (`introspect` reads migrations; `generate` writes docs). The alternative,
// emitting SQL from TypeScript, cannot work: migrations are history, and history
// is not regenerated.
//
// WHAT IT DOES NOT COVER, said here rather than discovered later: the ROLE
// DEFAULT grants (`role_capabilities`). Those seeds are `INSERT … SELECT` with
// correlated subqueries — `reports` inherits whatever `ai_chat` had, per role —
// and a parser that pretends to evaluate them would be inventing facts. The
// role fallback in `capabilities.ts` is instead held to the catalog by TYPE:
// `Record<FeatureKey, boolean>` has to name every feature key, and
// `capabilityCatalog.test.ts` asserts it at run time because this repo has no
// `tsc` step in CI.

import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { splitStatements, splitTopLevel, parenBody, squash } from "./sql-lex.mjs";

const ROOT = process.cwd();
const MIGRATIONS = path.join(ROOT, "supabase", "migrations");
const OUT = path.join(ROOT, "src", "lib", "capabilities.generated.ts");
const check = process.argv.includes("--check");

/* ───────────────────────────── parse ───────────────────────────── */

const INSERT_RE =
  /^INSERT INTO (?:public\.)?capabilities\s*\(([^)]*)\)\s*VALUES\b/i;

/** A SQL string literal → its text. Anything else (a number, an expression) stays raw. */
function literal(token) {
  const t = token.trim();
  if (t.startsWith("'") && t.endsWith("'")) return t.slice(1, -1).replace(/''/g, "'");
  if (/^-?\d+$/.test(t)) return Number(t);
  if (/^null$/i.test(t)) return null;
  return t;
}

/**
 * Every capability row the migrations seed, in migration order, with
 * `ON CONFLICT (key) DO UPDATE` applied — so the LAST seed of a key wins,
 * exactly as it does in the database.
 */
export function capabilityCatalog(root = ROOT) {
  const dir = path.join(root, "supabase", "migrations");
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".sql")).sort() : [];
  const byKey = new Map();
  const seededBy = new Map();

  for (const file of files) {
    const sql = readFileSync(path.join(dir, file), "utf8");
    for (const stmt of splitStatements(sql)) {
      const flat = squash(stmt);
      const head = INSERT_RE.exec(flat);
      if (!head) continue;
      const columns = head[1].split(",").map((c) => c.trim().toLowerCase());
      // The VALUES list starts at the first `(` after the VALUES keyword, which
      // is past the column list — so search from the end of the matched head.
      let cursor = flat.toUpperCase().indexOf("VALUES", head[0].length - 6);
      cursor = cursor === -1 ? head[0].length : cursor + "VALUES".length;
      const tail = flat.slice(cursor);
      // Stop at ON CONFLICT: its own parentheses are not rows.
      const rowsText = tail.split(/\bON CONFLICT\b/i)[0];

      let at = 0;
      for (;;) {
        const tuple = parenBody(rowsText, at);
        if (!tuple) break;
        at = tuple.end + 1;
        const cells = splitTopLevel(tuple.body).map(literal);
        const row = {};
        columns.forEach((c, i) => (row[c] = cells[i]));
        if (!row.key) continue;
        byKey.set(row.key, { ...(byKey.get(row.key) ?? {}), ...row });
        seededBy.set(row.key, file);
      }
    }
  }

  return [...byKey.entries()]
    .map(([key, row]) => ({
      key,
      kind: row.kind,
      label: row.label,
      description: row.description ?? null,
      sort_order: typeof row.sort_order === "number" ? row.sort_order : 100,
      seeded_by: seededBy.get(key),
    }))
    .sort((a, b) => a.sort_order - b.sort_order || a.key.localeCompare(b.key));
}

/* ───────────────────────────── emit ───────────────────────────── */

const ts = (s) => `'${String(s).replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;

function render(rows) {
  const pages = rows.filter((r) => r.kind === "page");
  const features = rows.filter((r) => r.kind === "feature");

  const entry = (r) =>
    `  { key: ${ts(r.key)}, kind: ${ts(r.kind)}, label: ${ts(r.label)},` +
    (r.description ? ` description: ${ts(r.description)},` : "") +
    ` sortOrder: ${r.sort_order} },` +
    `  // ${r.seeded_by}`;

  return `// GENERATED by scripts/data-contract/gen-capabilities.mjs — DO NOT EDIT.
//
// The capability catalog, read out of the migrations that seed
// \`public.capabilities\`. Edit the migration, then run
// \`npm run contract:capabilities\`. \`contract:check\` fails when this file and
// the migrations disagree (PLAN.md §4 D33).
//
// ${rows.length} capabilities: ${pages.length} page, ${features.length} feature.

export type CapabilityKind = 'page' | 'feature';

export interface CapabilityMeta {
  key: string;
  kind: CapabilityKind;
  label: string;
  description?: string;
  sortOrder: number;
}

/** Every feature key the database knows. A key absent here can never be granted. */
export type FeatureKey =
${features.map((r) => `  | ${ts(r.key)}`).join("\n")};

export const PAGE_CAPABILITIES: CapabilityMeta[] = [
${pages.map(entry).join("\n")}
];

export const FEATURE_CAPABILITIES: CapabilityMeta[] = [
${features.map(entry).join("\n")}
];

export const FEATURE_KEYS: FeatureKey[] = FEATURE_CAPABILITIES.map((c) => c.key as FeatureKey);
`;
}

/* ───────────────────────────── main ───────────────────────────── */

function main() {
  const rows = capabilityCatalog(ROOT);
  if (!rows.length) {
    console.error("no capability seeds found — has the INSERT shape changed?");
    process.exit(2);
  }
  const rendered = render(rows);
  const existing = existsSync(OUT) ? readFileSync(OUT, "utf8") : null;

  if (check) {
    if (existing === rendered) {
      console.log(
        `✓ the capability catalog matches the migrations · ${rows.length} keys ` +
          `(${rows.filter((r) => r.kind === "page").length} page, ` +
          `${rows.filter((r) => r.kind === "feature").length} feature)`,
      );
      return;
    }
    console.error(
      "✗ src/lib/capabilities.generated.ts does not match the migrations.\n" +
        "  Run `npm run contract:capabilities` and commit the result.\n" +
        "  A capability authored twice drifts; this is PLAN.md §4 D33.",
    );
    process.exit(1);
  }

  writeFileSync(OUT, rendered);
  console.log(`wrote ${path.relative(ROOT, OUT)} · ${rows.length} capabilities`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
