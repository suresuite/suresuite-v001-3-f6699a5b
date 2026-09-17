#!/usr/bin/env node
/**
 * WP 5.1 — WHERE IS THIS VALUE RENDERED?
 *
 * The contract has carried an empty `surfaces: []` on every field since WP 1.2,
 * with the schema's own note saying "filled in Phase 5 (WP 5.1); empty until
 * then, not absent". This is that fill, and the plan's constraint on it is the
 * whole design:
 *
 *     "human-confirmed (an unconfirmed lineage entry is worse than none — it
 *      will be trusted)."
 *
 * So this script does NOT write sidecars. It SEEDS candidates, prints the
 * evidence behind each one, and a person decides which become lineage. What it
 * writes is a report; what lands in the contract is what somebody read.
 *
 * ── WHY A MODULE GRAPH AND NOT A GREP ─────────────────────────────────────
 *
 * §11's brief says to analyse "the `.rpc()`/`.from()`/`invoke()` calls in
 * `src/pages/*.tsx`". Running that grep first is what showed the brief is too
 * narrow: SEVENTEEN pages contain EIGHT direct table reads between them. Almost
 * every read happens in a hook or a component the page mounts, so a scan of
 * `src/pages` alone would report that `DataManager` reads nothing — an empty
 * lineage that looks like a finished one.
 *
 * The graph is therefore: page → every local module it transitively imports →
 * the table reads in those modules. Plus one hop the brief does not mention and
 * cannot be skipped — an `.rpc()` name is not a table, so every RPC is resolved
 * to the tables ITS BODY reads, from the live SQL definitions.
 *
 * ── WHAT IT REFUSES TO GUESS ──────────────────────────────────────────────
 *
 * A table being REACHABLE from a page does not mean a FIELD of it is rendered
 * there. Claiming so would fill the contract with entries that are true about
 * imports and false about the product, which is the "worse than none" case
 * stated precisely. A field is a candidate only when its name appears literally
 * in the reachable source, and the report says which file and line put it there
 * so a reviewer can check rather than trust.
 */

import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { liveDefinitions } from "./live-sql.mjs";

const ROOT = process.cwd();
const SRC = path.join(ROOT, "src");
const PAGES = path.join(SRC, "pages");

/* ───────────────────────────── module graph ───────────────────────────── */

const EXT = [".ts", ".tsx", ".js", ".jsx"];

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = path.join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (EXT.includes(path.extname(p))) out.push(p);
  }
  return out;
}

/** Resolve an import specifier to a file under src/, or null for a package. */
function resolveImport(spec, fromFile) {
  let base;
  if (spec.startsWith("@/")) base = path.join(SRC, spec.slice(2));
  else if (spec.startsWith(".")) base = path.resolve(path.dirname(fromFile), spec);
  else return null; // node_modules, or a URL import in an edge function
  for (const e of ["", ...EXT, ...EXT.map((x) => `/index${x}`)]) {
    const cand = base + e;
    if (existsSync(cand) && statSync(cand).isFile()) return cand;
  }
  return null;
}

const IMPORT_RE = /(?:^|\n)\s*(?:import|export)[\s\S]*?from\s*["']([^"']+)["']/g;
const DYNAMIC_RE = /import\s*\(\s*["']([^"']+)["']\s*\)/g;

function importsOf(file, src) {
  const out = new Set();
  for (const re of [IMPORT_RE, DYNAMIC_RE]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(src))) {
      const r = resolveImport(m[1], file);
      if (r) out.add(r);
    }
  }
  return out;
}

/* ─────────────────────────── direct data access ─────────────────────────── */

const FROM_RE = /\.from\(\s*["']([a-z_][a-z0-9_]*)["']\s*\)/g;
/**
 * `.from('t')` followed by `.select('a,b')` — the supabase-js chain, with
 * whitespace and newlines between the two calls. This is the ONLY field-grain
 * evidence this script will produce.
 */
const FROM_SELECT_RE =
  /\.from\(\s*["']([a-z_][a-z0-9_]*)["']\s*\)\s*(?:\r?\n\s*)*\.select\(\s*["']([^"']+)["']/g;
const RPC_RE = /\.rpc\(\s*["']([a-z_][a-z0-9_]*)["']/g;
const INVOKE_RE = /functions\.invoke\(\s*["']([a-z][a-z0-9-]*)["']/g;

/** Line number of a byte offset, 1-based — so a reviewer can go and look. */
const lineAt = (src, idx) => src.slice(0, idx).split("\n").length;

/** Field-grain evidence: which columns a `.from(t).select(...)` actually asks for. */
function selectsOf(file, src) {
  const out = [];
  FROM_SELECT_RE.lastIndex = 0;
  let m;
  while ((m = FROM_SELECT_RE.exec(src))) {
    const cols = m[2].trim();
    // `*` asks for every column and names none of them, so it is evidence about
    // the TABLE and not about any field. Recording it as field evidence would
    // reintroduce the 979-pair problem with a different regex.
    if (cols === "*") continue;
    out.push({
      table: m[1],
      // Strip PostgREST embedding (`a,b,rel(x)`) and aliases — an embedded
      // resource is a different table's columns and is not claimed here.
      columns: cols
        .replace(/\w+\s*\([^)]*\)/g, "")
        .split(",")
        .map((c) => c.trim().split(":").pop().trim())
        .filter((c) => /^[a-z_][a-z0-9_]*$/.test(c)),
      file: path.relative(ROOT, file),
      line: lineAt(src, m.index),
    });
  }
  return out;
}

function accessesOf(file, src) {
  const out = [];
  for (const [kind, re] of [["from", FROM_RE], ["rpc", RPC_RE], ["invoke", INVOKE_RE]]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(src))) {
      out.push({ kind, name: m[1], file: path.relative(ROOT, file), line: lineAt(src, m.index) });
    }
  }
  return out;
}

/* ───────────────────── RPC → the tables its body reads ──────────────────── */

/**
 * An `.rpc('x')` names a function, not a table, and every read this project
 * makes through the policy grid goes that way. Resolving the hop is the
 * difference between lineage and a list of RPC names.
 *
 * READS ONLY. A function that WRITES a table is not a surface — `surfaces`
 * answers "where is this value rendered", and an UPDATE renders nothing.
 */
function rpcTableReads(tables) {
  const live = liveDefinitions();
  const map = new Map();
  for (const [name, def] of live.functions) {
    const hit = new Set();
    for (const t of tables) {
      // FROM / JOIN only. `INSERT INTO t` and `UPDATE t` are deliberately not
      // matched: a write is not a surface.
      const re = new RegExp(`(?:FROM|JOIN)\\s+(?:public\\.)?${t}\\b`, "i");
      if (re.test(def.sql)) hit.add(t);
    }
    if (hit.size) map.set(name, [...hit]);
  }
  return map;
}

/* ─────────────────────────────── the report ─────────────────────────────── */

function main() {
  const contract = JSON.parse(
    readFileSync(path.join(ROOT, "build", "data-contract.generated.json"), "utf8"),
  );
  const tables = Object.keys(contract.tables);
  const fieldsOf = (t) => (contract.tables[t].columns ?? []).map((c) => c.name);

  const files = walk(SRC);
  const srcOf = new Map(files.map((f) => [f, readFileSync(f, "utf8")]));
  const imports = new Map(files.map((f) => [f, importsOf(f, srcOf.get(f))]));
  const access = new Map(files.map((f) => [f, accessesOf(f, srcOf.get(f))]));
  const selects = new Map(files.map((f) => [f, selectsOf(f, srcOf.get(f))]));
  const rpcReads = rpcTableReads(tables);

  const pages = readdirSync(PAGES)
    .filter((f) => f.endsWith(".tsx"))
    .map((f) => path.join(PAGES, f));

  const report = { generated_at: new Date().toISOString(), pages: {}, by_table: {} };
  /** module → how many pages reach it. The shell is what nearly all of them do. */
  const moduleReach = new Map();

  for (const page of pages) {
    // Transitive closure of local imports. A cycle is normal in a React tree,
    // so `seen` guards it rather than a depth limit that would silently miss.
    const seen = new Set([page]);
    const stack = [page];
    while (stack.length) {
      for (const dep of imports.get(stack.pop()) ?? []) {
        if (!seen.has(dep)) { seen.add(dep); stack.push(dep); }
      }
    }

    const reached = new Map(); // table -> evidence[]
    for (const f of seen) {
      for (const a of access.get(f) ?? []) {
        const hit =
          a.kind === "from" ? (tables.includes(a.name) ? [a.name] : [])
          : a.kind === "rpc" ? (rpcReads.get(a.name) ?? [])
          : []; // an edge function's reads are not visible from here — see below
        for (const t of hit) {
          if (!reached.has(t)) reached.set(t, []);
          reached.get(t).push({ via: a.kind === "rpc" ? `rpc ${a.name}` : "table read", ...a });
        }
      }
    }

    for (const f of seen) moduleReach.set(f, (moduleReach.get(f) ?? 0) + 1);

    const pageName = path.basename(page);

    // FIELD GRAIN — explicit select lists only, and only for columns the
    // contract actually describes (a select naming a column the schema does not
    // have is a finding about the code, not lineage).
    const fields = {};
    for (const f of seen) {
      for (const sel of selects.get(f) ?? []) {
        if (!tables.includes(sel.table)) continue;
        const known = new Set(fieldsOf(sel.table));
        for (const c of sel.columns) {
          if (!known.has(c)) continue;
          ((fields[sel.table] ??= {})[c] ??= []).push({ file: sel.file, line: sel.line });
        }
      }
    }

    report.pages[pageName] = {
      modules_reached: seen.size,
      tables: Object.fromEntries([...reached].map(([t, ev]) => [t, ev.slice(0, 4)])),
      candidate_fields: fields,
      edge_functions: [...new Set([...seen].flatMap((f) =>
        (access.get(f) ?? []).filter((a) => a.kind === "invoke").map((a) => a.name)))],
    };

    // Two indexes, because the two grades answer different questions and a
    // reader who conflates them is exactly who this file is written against.
    for (const [t, cols] of Object.entries(fields)) {
      for (const [c, ev] of Object.entries(cols)) {
        ((report.by_table[t] ??= {})[c] ??= []).push({ page: pageName, grain: "column", evidence: ev[0] });
      }
    }
    for (const [t, ev] of reached) {
      (report.by_table_reach ??= {});
      ((report.by_table_reach[t] ??= [])).push({
        page: pageName, grain: "table", via: ev[0].via,
        // EVERY provider, not the first. Whether this access is shell depends on
        // whether ALL the modules that provide it are shell modules, and the
        // first draft kept one and got the answer wrong for every table.
        through: [...new Set(ev.map((e) => e.file))],
        evidence: ev.slice(0, 3).map((e) => ({ file: e.file, line: e.line, via: e.via })),
      });
    }
  }

  // ── THE SHELL PASS, and it exists because the first run over-claimed ────
  //
  // `approved_users` came back reached from FIFTEEN pages including
  // `NotFound.tsx`, `Forbidden.tsx` and `Landing.tsx`. That is TRUE — every page
  // imports `useAuth`, which reads the table — and it is useless as lineage: a
  // 404 page is not where anybody sees a user's organization. "True about the
  // imports and false about the product" is the failure mode this whole script
  // is written against, and transitive reachability produces it for any module
  // the shell mounts everywhere.
  //
  // So an access is SHELL when the module providing it is reachable from almost
  // every page. The threshold is stated rather than tuned: a module that ≥80% of
  // pages import is part of the shell by definition, whatever it happens to be
  // called, and a rule keyed on the NAME `useAuth` would miss the next one.
  const SHELL_SHARE = 0.8;
  const shellModules = new Set(
    [...moduleReach].filter(([, n]) => n / pages.length >= SHELL_SHARE).map(([f]) => f),
  );
  report.shell_modules = [...shellModules].map((f) => path.relative(ROOT, f)).sort();

  // COLUMN GRAIN GETS THE SAME TEST, and the first run is why it has to be
  // said separately: `approved_users.organization` is named in an EXPLICIT
  // select list — in `useAuth.tsx`. Explicit evidence about a shell module is
  // still shell. Four pages that render nothing came back carrying column-grain
  // lineage because the select list looked like strong evidence and the module
  // it sat in was never asked about.
  for (const cols of Object.values(report.by_table ?? {})) {
    for (const entries of Object.values(cols)) {
      for (const e of entries) {
        if (shellModules.has(path.join(ROOT, e.evidence.file))) {
          e.grain = "shell";
          e.note =
            `named in an explicit select list, but in ${e.evidence.file}, which is ` +
            `reachable from ≥${SHELL_SHARE * 100}% of pages — app-shell access, not a ` +
            "place this column is rendered";
        }
      }
    }
  }

  for (const entries of Object.values(report.by_table_reach ?? {})) {
    for (const e of entries) {
      // Shell only when EVERY provider of this access is a shell module. One
      // page-specific read is enough to make it a real surface.
      const allShell = e.through.every((f) => shellModules.has(path.join(ROOT, f)));
      if (!allShell) continue;
      e.grain = "shell";
      e.note =
        `every module providing this read (${e.through.join(", ")}) is reachable from ` +
        `≥${SHELL_SHARE * 100}% of pages — app-shell access (auth/session), not a place ` +
        "this table's data is rendered";
    }
  }

  const out = path.join(ROOT, "build", "surfaces.candidates.json");
  writeFileSync(out, JSON.stringify(report, null, 2) + "\n");

  // A page reads "no project data" when every table it reaches is shell access.
  const nonShell = new Map();
  for (const [t, entries] of Object.entries(report.by_table_reach ?? {})) {
    for (const e of entries) {
      if (e.grain === "shell") continue;
      if (!nonShell.has(e.page)) nonShell.set(e.page, new Set());
      nonShell.get(e.page).add(t);
    }
  }
  for (const [name, v] of Object.entries(report.pages)) {
    v.project_tables = [...(nonShell.get(name) ?? [])].sort();
  }
  const noData = Object.keys(report.pages).filter((p) => !nonShell.has(p)).sort();

  console.log(`✓ ${pages.length} page(s) analysed → ${path.relative(ROOT, out)}`);
  console.log(`  ${Object.keys(report.by_table_reach ?? {}).length} table(s) REACHED from a page (table grain)`);
  console.log(`  ${Object.keys(report.by_table).length} table(s) with COLUMN-grain evidence from an explicit select list`);
  console.log(`  ${noData.length} page(s) read NO project data (shell access only): ${noData.join(", ") || "none"}`);
  console.log(
    "\n  CANDIDATES, NOT LINEAGE. Nothing here enters the contract until somebody\n" +
    "  reads the evidence line it carries. An unconfirmed entry will be trusted.",
  );
}

main();

/* ────────────────────── writing it into the sidecars ────────────────────── */

/**
 * `--write` fills the sidecars from the report. It is a SEPARATE step from the
 * analysis on purpose: the default run produces evidence a person reads, and
 * this one acts on it. Running the second without the first is how an
 * unconfirmed entry becomes lineage.
 *
 * `confirmed` is written true only for entries whose evidence line this script
 * can re-open and match. That is a mechanical check, not a substitute for the
 * human one — what it buys is that a confirmation cannot quietly go stale,
 * because `contract:check` R12 re-runs the same match on every CI run. §4's
 * citations went stale within a quarter for want of exactly this (D21, D22).
 */
export function writeSidecars() {
  const report = JSON.parse(
    readFileSync(path.join(ROOT, "build", "surfaces.candidates.json"), "utf8"),
  );
  const dir = path.join(ROOT, "supabase", "contract");
  let tablesTouched = 0;
  let fieldsTouched = 0;

  const yamlEntry = (e, indent) => {
    const pad = " ".repeat(indent);
    const lines = [
      `${pad}- page: "${e.page}"`,
      `${pad}  via: "${e.via}"`,
      `${pad}  grain: ${e.grain}`,
      `${pad}  evidence: "${e.evidence}"`,
      `${pad}  confirmed: ${e.confirmed}`,
    ];
    if (e.note) lines.push(`${pad}  note: >-\n${pad}    ${e.note}`);
    return lines.join("\n");
  };

  for (const file of readdirSync(dir).filter((f) => f.endsWith(".contract.yaml"))) {
    const table = file.replace(".contract.yaml", "");
    const p = path.join(dir, file);
    let src = readFileSync(p, "utf8");

    // TABLE grain. Shell access is recorded too — with `grain: shell`, so the
    // page list is complete and the reader is told which entries are plumbing.
    const reach = (report.by_table_reach?.[table] ?? []).map((e) => ({
      page: e.page,
      via: e.via,
      grain: e.grain,
      evidence: `${e.evidence[0].file}:${e.evidence[0].line}`,
      confirmed: verifyEvidence(e.evidence[0].file, e.evidence[0].line),
      note: e.note ?? null,
    })).sort((a, b) => a.page.localeCompare(b.page));

    if (reach.length) {
      const block = "surfaces:\n" + reach.map((e) => yamlEntry(e, 2)).join("\n") + "\n\n";
      src = src.replace(/\ngovernance:/, `\n${block}governance:`);
      tablesTouched++;
    }

    // COLUMN grain, per field, replacing that field's `surfaces: []`.
    for (const [field, entries] of Object.entries(report.by_table?.[table] ?? {})) {
      const rows = entries.map((e) => ({
        page: e.page,
        via: "table read",
        grain: e.grain ?? "column",
        evidence: `${e.evidence.file}:${e.evidence.line}`,
        confirmed: verifyEvidence(e.evidence.file, e.evidence.line),
        note: e.note ?? null,
      })).sort((a, b) => a.page.localeCompare(b.page));

      // Anchor on the field's own block so a column name that is a substring of
      // another cannot capture the wrong `surfaces: []`.
      const re = new RegExp(`(\\n  ${field}:\\n(?:    .*\\n|\\n)*?)    surfaces: \\[\\]\\n`);
      if (!re.test(src)) continue;
      src = src.replace(re, (_m, head) =>
        head + "    surfaces:\n" + rows.map((e) => yamlEntry(e, 6)).join("\n") + "\n");
      fieldsTouched++;
    }

    writeFileSync(p, src);
  }
  console.log(`✓ ${tablesTouched} sidecar(s) gained table-grain lineage · ${fieldsTouched} field(s) gained column-grain`);
}

/** Re-open the evidence line and check an access is actually there. */
export function verifyEvidence(file, line) {
  const p = path.join(ROOT, file);
  if (!existsSync(p)) return false;
  const lines = readFileSync(p, "utf8").split("\n");
  // ±2 lines, because a prettier reflow moves a chained call by one or two and
  // a gate that fails on formatting is a gate people switch off.
  const window = lines.slice(Math.max(0, line - 3), line + 2).join("\n");
  return /\.from\(\s*["'][a-z_]+["']\s*\)|\.rpc\(\s*["'][a-z_]+["']/.test(window);
}

if (process.argv.includes("--write")) writeSidecars();
