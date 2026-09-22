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
// WHAT IT DOES NOT COVER, said here rather than discovered later: the GLOBAL
// role default grants (`role_capabilities`). Those seeds are `INSERT … SELECT`
// with correlated subqueries — `reports` inherits whatever `ai_chat` had, per
// role — and a parser that pretends to evaluate them would be inventing facts.
// The role fallback in `capabilities.ts` is instead held to the catalog by
// TYPE: `Record<FeatureKey, boolean>` has to name every feature key, and
// `capabilityCatalog.test.ts` asserts it at run time because this repo has no
// `tsc` step in CI.
//
// WHAT IT DOES COVER BEYOND THE CATALOG: the PROJECT role layer. The
// `project_role_capabilities` seed is a plain VALUES list and
// `project_role_rank()` is a CASE of literals, so both parse without
// evaluation — which is exactly the line the paragraph above draws. They are
// emitted so the manual's roles page can show the owner/editor/analyst/viewer
// matrix without authoring it a second time (invariant I1; D101 is what a
// literal copy in a page costs).

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
const PROJECT_INSERT_RE =
  /^INSERT INTO (?:public\.)?project_role_capabilities\s*\(([^)]*)\)\s*VALUES\b/i;
const RANK_FN_RE = /FUNCTION (?:public\.)?project_role_rank\b/i;

/** A SQL string literal → its text. Anything else (a number, an expression) stays raw. */
function literal(token) {
  const t = token.trim();
  if (t.startsWith("'") && t.endsWith("'")) return t.slice(1, -1).replace(/''/g, "'");
  if (/^-?\d+$/.test(t)) return Number(t);
  if (/^null$/i.test(t)) return null;
  return t;
}

/** The VALUES tuples of one flattened INSERT, as row objects keyed by column. */
function insertRows(flat, headMatch) {
  const columns = headMatch[1].split(",").map((c) => c.trim().toLowerCase());
  // The VALUES list starts at the first `(` after the VALUES keyword, which
  // is past the column list — so search from the end of the matched head.
  let cursor = flat.toUpperCase().indexOf("VALUES", headMatch[0].length - 6);
  cursor = cursor === -1 ? headMatch[0].length : cursor + "VALUES".length;
  // Stop at ON CONFLICT: its own parentheses are not rows.
  const rowsText = flat.slice(cursor).split(/\bON CONFLICT\b/i)[0];

  const rows = [];
  let at = 0;
  for (;;) {
    const tuple = parenBody(rowsText, at);
    if (!tuple) break;
    at = tuple.end + 1;
    const cells = splitTopLevel(tuple.body).map(literal);
    const row = {};
    columns.forEach((c, i) => (row[c] = cells[i]));
    rows.push(row);
  }
  return rows;
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
      for (const row of insertRows(flat, head)) {
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

/**
 * The project role layer: the ordered vocabulary from `project_role_rank()`
 * and the default grants from the `project_role_capabilities` seed, with
 * `ON CONFLICT … DO UPDATE` applied so the last seed of a pair wins.
 *
 * Both are literals — a CASE of constants and a plain VALUES list — so
 * reading them is transcription, not evaluation. The moment either grows an
 * expression this parser cannot read, it should FAIL rather than guess,
 * which the empty-result guards in main() are for.
 */
export function projectRoleLayer(root = ROOT) {
  const dir = path.join(root, "supabase", "migrations");
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".sql")).sort() : [];
  const rank = new Map(); // role -> number, last definition wins
  const grants = new Map(); // "role\u0000key" -> { role, key, allowed, file }

  for (const file of files) {
    const sql = readFileSync(path.join(dir, file), "utf8");
    for (const stmt of splitStatements(sql)) {
      const flat = squash(stmt);
      if (RANK_FN_RE.test(flat) && /CREATE\s+(OR\s+REPLACE\s+)?FUNCTION/i.test(flat)) {
        const arms = [...flat.matchAll(/WHEN\s+'([a-z_]+)'\s+THEN\s+(\d+)/gi)];
        if (arms.length) {
          rank.clear();
          for (const [, role, n] of arms) rank.set(role, Number(n));
        }
        continue;
      }
      const head = PROJECT_INSERT_RE.exec(flat);
      if (!head) continue;
      for (const row of insertRows(flat, head)) {
        if (!row.project_role || !row.capability_key) continue;
        grants.set(`${row.project_role}\u0000${row.capability_key}`, {
          role: row.project_role,
          key: row.capability_key,
          allowed: String(row.allowed).toLowerCase() === "true",
          file,
        });
      }
    }
  }

  const roles = [...rank.entries()]
    .sort((a, b) => a[1] - b[1])
    .map(([role, n]) => ({ role, rank: n }));
  return { roles, grants: [...grants.values()] };
}

/* ───────────────────────────── emit ───────────────────────────── */

const ts = (s) => `'${String(s).replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;

function render(rows, project) {
  const pages = rows.filter((r) => r.kind === "page");
  const features = rows.filter((r) => r.kind === "feature");
  const sortOrder = new Map(rows.map((r) => [r.key, r.sort_order]));
  const rankOf = new Map(project.roles.map((r) => [r.role, r.rank]));
  const grants = [...project.grants].sort(
    (a, b) =>
      (rankOf.get(b.role) ?? 0) - (rankOf.get(a.role) ?? 0) ||
      (sortOrder.get(a.key) ?? 999) - (sortOrder.get(b.key) ?? 999) ||
      a.key.localeCompare(b.key),
  );

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

/**
 * The project-role vocabulary, rank ascending, read from \`project_role_rank()\`
 * — the one place the ordering is written (its own COMMENT says so).
 */
export type ProjectRole =
${project.roles.map((r) => `  | ${ts(r.role)}`).join("\n")};

export const PROJECT_ROLE_RANK: Record<ProjectRole, number> = {
${project.roles.map((r) => `  ${r.role}: ${r.rank},`).join("\n")}
};

/** Rank DESCENDING — the order an access table reads best in. */
export const PROJECT_ROLES: ProjectRole[] = [
${[...project.roles].sort((a, b) => b.rank - a.rank).map((r) => `  ${ts(r.role)},`).join("\n")}
];

export interface ProjectRoleGrant {
  projectRole: ProjectRole;
  capabilityKey: string;
  allowed: boolean;
}

/**
 * The default grant each project role carries, from the
 * \`project_role_capabilities\` seed. Defaults: a super admin bypasses them,
 * and a per-user or per-org row can override any one of them.
 */
export const PROJECT_ROLE_DEFAULTS: ProjectRoleGrant[] = [
${grants
  .map(
    (g) =>
      `  { projectRole: ${ts(g.role)}, capabilityKey: ${ts(g.key)}, allowed: ${g.allowed} },` +
      `  // ${g.file}`,
  )
  .join("\n")}
];
`;
}

/* ───────────────────────────── main ───────────────────────────── */

function main() {
  const rows = capabilityCatalog(ROOT);
  if (!rows.length) {
    console.error("no capability seeds found — has the INSERT shape changed?");
    process.exit(2);
  }
  const project = projectRoleLayer(ROOT);
  if (!project.roles.length || !project.grants.length) {
    console.error(
      "no project-role vocabulary or grants found — has project_role_rank() " +
        "or the project_role_capabilities seed changed shape?",
    );
    process.exit(2);
  }
  const rendered = render(rows, project);
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
