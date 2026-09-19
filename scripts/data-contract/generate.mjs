#!/usr/bin/env node
// Build the data contract and render the pages it owns (Phase 1 / WP 1.4).
//
//   npm run contract:generate            # (re)write the contract + docs/data/tables/*.md
//   npm run contract:generate -- --check # CI gate: fail (exit 1) on drift
//
// THE MERGE. PLAN.md §2.2 names four sources; three of them exist today and this
// script joins them:
//
//   build/schema.introspected.json   what the schema IS      (WP 1.1, replayed)
//   supabase/contract/*.yaml         what the columns MEAN   (WP 1.2/1.3, authored)
//   src/lib/policies/registry.generated.json
//                                    what the engine READS and what it falls back
//                                    to when a value is missing (imported)
//
// The fourth — static analysis of which page touches each field — is `surfaces[]`
// and lands in WP 5.1. It is empty here, not absent, which is the difference
// between "not yet recorded" and "nothing renders it".
//
// THE GATE PATTERN is `scsim/scripts/gen_docs.py --check`'s, deliberately: render
// into memory, compare against what is committed, and fail naming the files that
// differ. It does NOT rewrite in CI. A generator that silently regenerates proves
// only that it ran.
//
// THE REGISTRY BRIDGE CONVENTION is `scripts/check_registry_bridge.mjs`'s: the
// engine's snapshot is read, never re-stated, and a reference it does not
// recognise is an error rather than a silently dropped row. `base_data_requirements`
// is keyed `table.column`, so a requirement naming a column the contract does not
// have means one of the two moved — reported, not ignored.
//
// WHAT IT EMITS
//   build/data-contract.generated.json   the contract (COMMITTED — see .gitignore)
//   docs/data/tables/<table>.md          one page per covered table, GENERATED banner

import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { load } from "js-yaml";
import {
  deriveChains,
  deriveStressTests,
  deriveApiRoutes,
  deriveStressPresets,
  deriveUploadAssets,
  deriveApiNotebook,
  deriveApiErrors,
  deriveApiLimits,
  deriveItemSeries,
  deriveRunKpis,
  deriveReplicationSeries,
  deriveScenarioSetup,
  deriveRecoveryLevers,
} from "./chains.mjs";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const INTROSPECTED = join(ROOT, "build", "schema.introspected.json");
const SIDECARS = join(ROOT, "supabase", "contract");
const REGISTRY = join(ROOT, "src", "lib", "policies", "registry.generated.json");
export const CONTRACT_OUT = join(ROOT, "build", "data-contract.generated.json");
export const PAGES_DIR = join(ROOT, "docs", "data", "tables");
const COVERAGE = join(ROOT, "scripts", "data-contract", "coverage.yaml");
// WP 5.2a. The manual's "data model at a glance" page is marked G in PLAN.md
// §6.3: it renders from here, so the one place a table list is authored stays
// the contract. Emitted into src/ because the page is a React route, and gated
// by this generator's own --check — the same gate as docs/data/tables/*.md.
export const DOCS_DATA_MODEL = join(ROOT, "src", "components", "docs", "generated", "dataModel.generated.ts");
// WP 5.2h. §6.3 section 15 marks "All tables" and "Field index" G. Both render
// from here, so the detailed reference — every column, its type, unit, CSV
// header, meaning and substitutions — is authored in the sidecars and nowhere
// else. Emitted separately from dataModel.generated.ts because it is an order
// of magnitude larger and only the reference section loads it.
export const DOCS_REFERENCE = join(ROOT, "src", "components", "docs", "generated", "reference.generated.ts");
// WP 3.2. The CSV ingestion spec `ingest-file` validates against — which target
// a dataset lands in, which header maps to which column, what each cell must
// satisfy, and which six targets may be promoted at all. Emitted into
// supabase/functions/_shared/ because the edge function imports it directly, and
// gated by this generator's own --check like every other generated file. The
// point is `single-source` (I1) applied to VALIDATION: for three phases the
// ingestion rules existed only as English in `ingest.validate`, and nothing could
// run English.
export const INGEST_SPEC = join(ROOT, "supabase", "functions", "_shared", "ingestSpec.generated.ts");
// WP 5.2c — §6.3 section 5's policy pages. The chains are DERIVED by
// `src/lib/policies/resolutionChains.ts`, the same module `resolutionChains.test.ts`
// ratchets; `chains.mjs` bundles it so this generator can call it. Emitted here
// rather than in its own script so it is covered by the drift comparison that
// already runs in CI — a generated artifact with no gate is the shape D57 was.
export const DOCS_POLICY = join(ROOT, "src", "components", "docs", "generated", "policy.generated.ts");

const TIER_NAMES = {
  "0": "landing — raw bytes as received",
  "1": "staging — parsed, diffed, unpromoted",
  "2": "canonical — the only tier humans edit",
  "2-O": "observations — append-only, bitemporal (reserved)",
  "3": "derived — a pure function of tier 2",
  "4": "decisions — policies, overrides, scenarios",
  "5": "results — pinned to dataset + policy + engine version",
  G: "governance — identity, capability, delegation, audit",
  reference: "project-independent, versioned by vintage rather than by project",
};

// ───────────────────────────────────────────────────────────────────── the merge

/** Read the three sources. Throws rather than degrading: a contract built from
 *  two of three sources is a contract that is wrong about the third. */
export function readSources() {
  for (const [path, what] of [
    [INTROSPECTED, "run `npm run contract:introspect`"],
    [REGISTRY, "regenerate it from the engine (`scsim/scripts/gen_frontend_registry.py`)"],
  ]) {
    if (!existsSync(path)) throw new Error(`${relative(ROOT, path)} is missing — ${what}.`);
  }
  const introspected = JSON.parse(readFileSync(INTROSPECTED, "utf8"));
  const registry = JSON.parse(readFileSync(REGISTRY, "utf8"));
  const sidecars = new Map();
  for (const file of readdirSync(SIDECARS).filter((f) => f.endsWith(".contract.yaml")).sort()) {
    const doc = load(readFileSync(join(SIDECARS, file), "utf8"));
    sidecars.set(doc.table, { doc, file: `supabase/contract/${file}` });
  }
  return { introspected, registry, sidecars };
}

/** `base_data_requirements`, indexed by the `table.column` key the engine uses. */
function engineRequirements(registry, problems) {
  const byField = new Map();
  for (const req of registry.base_data_requirements ?? []) {
    if (byField.has(req.field)) problems.push(`registry: two base_data_requirements for "${req.field}"`);
    byField.set(req.field, req);
  }
  return byField;
}

/** The engine's fallback chain as one readable sentence, from `fallback_spec`.
 *  I6: a fallback absent from the contract may not exist in code — so the chain
 *  is rendered from the engine's own data, never paraphrased by hand. */
function fallbackChain(req) {
  const steps = (req.fallback_spec ?? []).map((s) =>
    s.reducer ? `${s.reducer} (${s.grade})` : `constant ${s.constant} (${s.grade})`,
  );
  return steps.length ? steps.join(" → ") : "none — the absence is the value";
}

export function buildContract({ introspected, registry, sidecars }) {
  const problems = [];
  const requirements = engineRequirements(registry, problems);
  const byName = new Map(introspected.tables.map((t) => [t.name, t]));
  const usedRequirements = new Set();

  const tables = {};
  for (const [name, { doc, file }] of [...sidecars.entries()].sort()) {
    const t = byName.get(name);
    if (!t) {
      // `contract:validate` already fails on this; the generator must not paper
      // over it by emitting a page for a table that does not exist.
      problems.push(`${file}: describes "${name}", which exists in no migration`);
      continue;
    }
    const columns = t.columns.map((c) => {
      const f = doc.fields[c.name];
      if (!f) {
        problems.push(`${file}: column "${c.name}" has no field entry`);
        return null;
      }
      const key = `${name}.${c.name}`;
      const req = requirements.get(key);
      if (req) usedRequirements.add(key);
      return {
        name: c.name,
        // schema half — introspected, never authored
        type: c.type,
        nullable: c.nullable,
        default: c.default,
        primary_key: c.primary_key,
        unique: c.unique,
        references: c.references,
        added_by: c.added_by,
        // meaning half — authored, never introspected
        unit: f.unit,
        unit_source: f.unit_source,
        unit_column: f.unit_column ?? null,
        // WP 3.3 (I3) — the conversion `ingest_apply_run` applies as the value is
        // promoted, so nothing downstream converts. Paired with `unit_column`,
        // which already says where the unit comes from.
        normalize_at_promotion: f.normalize_at_promotion ?? null,
        meaning: f.meaning,
        grain: f.grain,
        // WP 5.2b (I1) — the analyzer that writes this column, where one does.
        // "Which columns are computed" was a data fact authored twice: as prose
        // in each field's `note`, and as a literal Set in graphHashCoverage's
        // test. Authored once, here, and read by both.
        computed_by: f.computed_by ?? null,
        engine: f.engine,
        substitutions: f.substitutions,
        ingest: f.ingest,
        surfaces: f.surfaces,
        resolution: f.resolution ?? null,
        note: f.note ?? null,
        // engine half — imported from the registry snapshot
        engine_requirement: req
          ? { level: req.level, reason: req.reason, fallback: req.fallback, chain: fallbackChain(req) }
          : null,
      };
    }).filter(Boolean);

    tables[name] = {
      table: name,
      schema_name: doc.schema_name ?? "public",
      tier: doc.tier,
      tier_name: TIER_NAMES[doc.tier] ?? "unknown tier",
      grain: doc.grain,
      owner: doc.owner,
      created_by: t.created_by,
      sidecar: file,
      natural_key_unique: t.natural_key_unique,
      natural_key_intended: doc.natural_key_intended ?? null,
      // WP 3.2 — present only when a CSV upload targets this table. It is what
      // makes `ingest-file` contract-driven: the spec it validates against is
      // generated from here, so a new dataset is a sidecar edit and not a
      // second list inside an edge function.
      ingest_dataset: doc.ingest_dataset ?? null,
      // WP 5.1 — TABLE-grain lineage: which pages read this table, by what path,
      // with a file:line `contract:check` R12 re-opens on every run. It lives on
      // the table rather than being repeated on every column, because "this page
      // reads this table" is one fact and authoring it thirty times is `single-
      // source` (I1) broken by copy-paste.
      surfaces: doc.surfaces ?? [],
      // `rls_enabled` is the introspected value, never the sidecar's — and it is
      // NULL, not false, when a dynamic-SQL migration leaves the question open.
      governance: {
        ...doc.governance,
        rls_enabled: t.rls.determinate === false ? null : t.rls.enabled,
      },
      rls: t.rls,
      // CHECK constraints are surfaced deliberately (WP 1.3's handoff): a
      // constraint that rejects a user's upload belongs on the page the user
      // reads, not only in the migration that added it.
      constraints: t.constraints,
      indexes: t.indexes,
      columns,
      note: doc.note ?? null,
      // WP 4.2's OPEN ENUM of analysis kinds, with each kind's analyzer, code
      // version and parameter schema. Carried into the contract (and from there
      // into the manual) because it is the catalog of what an analysis IS, and
      // `single-source` (I1) says that is authored once — which it is, in the
      // sidecar, because a CHECK constraining the shape cannot hold a catalog.
      analysis_kinds: doc.analysis_kinds ?? null,
    };
  }

  for (const [field] of requirements) {
    if (usedRequirements.has(field)) continue;
    const [table] = field.split(".");
    // Only a covered table can be checked; an uncovered one is the coverage
    // manifest's business, not this one's.
    if (sidecars.has(table)) {
      problems.push(
        `registry: base_data_requirements names "${field}", which the contract has no column for — ` +
        "the engine and the schema disagree about a field the engine calls required",
      );
    }
  }

  const payload = {
    $generator: "scripts/data-contract/generate.mjs",
    $doc:
      "The data contract: the introspected schema merged with the authored sidecars and the " +
      "engine registry snapshot. Generated — do not edit; `npm run contract:check` fails on drift.",
    engine_version: registry.engine_version,
    sources: {
      introspected: {
        generator: introspected.$generator,
        migrations_found: introspected.migrations_found,
        migrations_applied: introspected.migrations_applied,
        last_migration: introspected.last_migration,
      },
      sidecars: sidecars.size,
      registry: { engine_version: registry.engine_version, policies: registry.policies.length },
    },
    counts: {
      tables_in_schema: introspected.tables.length,
      tables_covered: Object.keys(tables).length,
      columns_covered: Object.values(tables).reduce((n, t) => n + t.columns.length, 0),
      check_constraints: Object.values(tables)
        .reduce((n, t) => n + t.constraints.filter((c) => c.kind === "CHECK").length, 0),
      engine_requirements: usedRequirements.size,
      orphans: introspected.orphans.length,
      phantom_tables: introspected.phantom_tables.length,
    },
    tables,
    orphans: introspected.orphans,
    phantom_tables: introspected.phantom_tables,
  };
  // Content address over everything else, so a page can name the contract it came
  // from without embedding a wall-clock date — a date makes a committed generated
  // file differ from itself tomorrow, which is a drift gate that cries wolf daily.
  payload.contract_version = createHash("sha256").update(JSON.stringify(payload)).digest("hex").slice(0, 12);
  return { payload, problems };
}

// ────────────────────────────────────────────────────────────────── the renderer

const esc = (s) => String(s ?? "").replace(/\|/g, "\\|").replace(/\n+/g, " ").trim();
// A code span cannot contain a backtick, and authored prose legitimately does:
// `inbound_logistics.volume`'s unit is literally "units per `time_unit`". Strip
// them inside spans only — stripping them everywhere would flatten the prose.
const tick = (s) => `\`${esc(s).replace(/`/g, "")}\``;
const code = (s) => (s === null || s === undefined || s === "" ? "—" : tick(s));
const prose = (s) => (s ? esc(s) : "—");

function banner(table) {
  return (
    `<!-- GENERATED by scripts/data-contract/generate.mjs from ` +
    `${table.sidecar} + build/schema.introspected.json + the engine registry. ` +
    `Do not edit by hand: \`npm run contract:check\` fails on drift. -->\n\n`
  );
}

function renderGovernance(t) {
  const out = [`## Governance\n`];
  out.push(`| | |`, `|---|---|`);
  out.push(`| Read capability | ${t.governance.read ? code(t.governance.read) : "any project member"} |`);
  out.push(`| Write capability | ${t.governance.write ? code(t.governance.write) : "**no user-facing write path**"} |`);
  out.push(`| Minimum project role | ${code(t.governance.min_project_role)} |`);
  out.push(`| Tier transitions audited | ${t.governance.audited ? "yes" : "**no** — invariant `audit-actor` is not met here yet"} |`);
  const indeterminate = t.rls.determinate === false;
  out.push(
    `| Row-level security | ${indeterminate ? "**cannot be determined from the migrations**" : t.rls.enabled ? "enabled" : "**DISABLED**"} |`,
  );

  // ── what the DATABASE enforces, beside what the contract INTENDS ────────────
  // §5 T1 says every displayed value resolves to a source, and until WP 2.4 this
  // table showed only the INTENT: the capability a page is supposed to check.
  // A reader could not tell whether the database agreed. It frequently does not —
  // D28 — so the page now renders BOTH, which is the choice §9 offers over
  // rendering neither. An intent shown alone reads as an assurance.
  const policies = t.rls.policies ?? [];
  const isOpen = (p) => /^\s*true\s*$/i.test(p.using ?? "") || /^\s*true\s*$/i.test(p.with_check ?? "");
  const open = policies.filter(isOpen);
  const writeOpen = open.filter((p) => ["ALL", "INSERT", "UPDATE", "DELETE"].includes((p.command ?? "").toUpperCase()));
  out.push(
    `| Policies on the table | ${policies.length === 0 ? "**none**" : `${policies.length}` +
      (open.length ? ` — **${open.length} with no predicate**` : " — all carry a predicate")} |`,
  );
  out.push("");
  if (t.governance.note) out.push(prose(t.governance.note), "");
  if (open.length) {
    out.push(
      "> **What the database actually permits is wider than the row above.**",
      `> ${open.length} polic${open.length === 1 ? "y" : "ies"} here grant${open.length === 1 ? "s" : ""} access with`,
      "> **no predicate at all** (`USING (true)`), so the capability named above is what the",
      "> product intends to check, not what the database enforces:",
      ">",
      ...open.map((p) => `> - \`${esc(p.name)}\` — \`${esc(p.command)}\`${p.roles?.length ? ` to \`${p.roles.map(esc).join("`, `")}\`` : ""}`),
      ">",
      writeOpen.length
        ? "> Some of these permit **writes**. See PLAN.md D28: the application runs as the"
        : "> See PLAN.md D28: the application runs as the",
      "> `anon` role with no auth session and the anon key ships in the frontend bundle, so",
      "> closing these is a migration with an auth model behind it rather than a policy edit.",
      "",
    );
  }
  if (indeterminate) {
    out.push(
      "> **The migrations do not settle whether RLS is on here.**",
      `> ${(t.rls.indeterminate_from ?? []).map((m) => `\`${esc(m)}\``).join(", ")} sets it with`,
      "> **dynamic SQL** — `EXECUTE format(...)`, assembled at run time — which a static replay",
      "> of the migration history cannot evaluate. The honest answer is *unknown*, and this",
      "> page will not round it to *off*: a security review that starts from an invented",
      "> \"unprotected\" is as wrong as one that starts from an invented \"protected\".",
      "> Only reading the live database answers it (PLAN.md §15).",
      "",
    );
  } else if (!t.rls.enabled) {
    out.push(
      "> **RLS is off on this table.** Every row is readable by anyone who can reach the",
      "> database, whatever the capability column above says. The capability is what the",
      "> platform intends; RLS is what the database enforces, and here they differ.",
      "",
    );
  }
  if (t.rls.enabled && !indeterminate && t.rls.policies.length === 0) {
    out.push(
      "> **RLS is on and this table has no policy.** That is deny-all for every role except",
      "> `service_role`, which bypasses RLS. If a page reads this table directly and gets zero",
      "> rows, this is why.",
      "",
    );
  }
  if (t.rls.policies.length) {
    out.push(`<details><summary>${t.rls.policies.length} RLS ${t.rls.policies.length === 1 ? "policy" : "policies"}</summary>\n`);
    out.push(`| Policy | Command | Roles | Added by |`, `|---|---|---|---|`);
    for (const p of t.rls.policies) {
      out.push(`| ${esc(p.name)} | ${esc(p.command)} | ${p.roles.length ? p.roles.map(esc).join(", ") : "all"} | ${code(p.added_by)} |`);
    }
    out.push("", "</details>", "");
  }
  return out;
}

function renderKeys(t) {
  const out = [`## Uniqueness\n`];
  if (t.natural_key_unique.length === 0) {
    out.push("None. Nothing in the database stops a duplicate row.", "");
  } else {
    out.push(`| Columns | Source | Constraint |`, `|---|---|---|`);
    for (const k of t.natural_key_unique) {
      out.push(`| ${k.columns.map((c) => `\`${c}\``).join(" + ")} | ${esc(k.source)} | ${code(k.name)} |`);
    }
    out.push("");
  }
  if (t.natural_key_intended) {
    // IS IT LANDED? The sentence used to say "the database does NOT enforce
    // today" unconditionally, and WP 3.3 made that false for seven tables the
    // day it created their unique indexes — so eleven of thirteen generated
    // pages published the OPPOSITE of the truth about the very invariant
    // `natural-key` (I4) is. That is D40's class exactly: a generated page
    // stating a fact the schema had moved on from, CI-gated so it would have
    // stayed true-looking indefinitely (D74).
    //
    // `natural_key_intended` stays on a table whose key HAS landed on purpose —
    // `contract:check` R5 compares the landed columns against it, so removing it
    // would remove the comparison. What was wrong is the prose, not the field.
    const want = JSON.stringify([...t.natural_key_intended].sort());
    const landed = (t.natural_key_unique || []).find(
      (k) => JSON.stringify([...k.columns].sort()) === want,
    );
    const key = t.natural_key_intended.map((c) => `\`${c}\``).join(" + ");
    if (landed) {
      out.push(
        `**Natural key:** ${key} — the key this table's grain implies, and the`,
        `database ENFORCES it: ${code(landed.name)}. A re-upload of the same row updates`,
        `it rather than duplicating it.`,
        "",
      );
    } else {
      out.push(
        `**Intended natural key:** ${key} — the key this`,
        `table's grain implies and the database does NOT enforce today. A statement about`,
        `what is missing, never a claim about what is there.`,
        "",
      );
    }
  }
  return out;
}

function renderConstraints(t) {
  // Everything except the implicit primary key, which the uniqueness block above
  // already states. A CHECK is the only thing on this page that can reject a
  // user's upload outright, so it leads.
  const checks = t.constraints.filter((c) => c.kind === "CHECK");
  const others = t.constraints.filter((c) => c.kind !== "CHECK" && !c.implicit);
  if (!checks.length && !others.length) return [];
  const out = [`## Constraints\n`];
  if (checks.length) {
    out.push(
      "These reject the row outright. A value that fails one of them does not arrive",
      "partially or get corrected — the write fails.",
      "",
      `| Constraint | Rule | Added by |`,
      `|---|---|---|`,
    );
    for (const c of checks) out.push(`| ${code(c.name)} | \`${esc(c.definition)}\` | ${code(c.added_by)} |`);
    out.push("");
  }
  if (others.length) {
    out.push(`| Constraint | Kind | Definition |`, `|---|---|---|`);
    for (const c of others) out.push(`| ${code(c.name)} | ${esc(c.kind)} | \`${esc(c.definition)}\` |`);
    out.push("");
  }
  return out;
}

function renderColumnSummary(t) {
  const out = [
    `## Columns\n`,
    `\`CSV header\` is the name the **user types**, which is not always the column name —`,
    `that gap is defect D21. A dash means the column has no CSV origin.`,
    "",
    `| Column | CSV header | Type | Unit | Required in CSV | Meaning |`,
    `|---|---|---|---|---|---|`,
  ];
  for (const c of t.columns) {
    const unit =
      c.unit_source === "column" ? `${tick(c.unit)} *(from ${tick(c.unit_column)})*`
      : c.unit ? tick(c.unit)
      : "—";
    out.push(
      `| \`${c.name}\`${c.primary_key ? " 🔑" : ""} | ${code(c.ingest.csv_header)} | \`${esc(c.type)}\` | ${unit} | ` +
      `${c.ingest.csv_header ? (c.ingest.required ? "**yes**" : "no") : "—"} | ${prose(c.meaning)} |`,
    );
  }
  out.push("");
  return out;
}

function renderColumnDetail(t) {
  const out = [`## Each column in full\n`];
  for (const c of t.columns) {
    out.push(`### \`${c.name}\`\n`);
    out.push(prose(c.meaning), "");
    const rows = [
      ["Type", `\`${esc(c.type)}\`${c.nullable ? "" : ", `NOT NULL`"}${c.default ? `, default \`${esc(c.default)}\`` : ""}`],
      ["Grain", code(c.grain)],
      ["Unit", c.unit
        ? `${tick(c.unit)} — ${esc(c.unit_source)}${c.unit_column ? `, named by ${tick(c.unit_column)}` : ""}`
        : c.unit_source === "none" ? "dimensionless" : `none recorded (${esc(c.unit_source)})`],
      ["Added by", code(c.added_by)],
    ];
    if (c.references) {
      // Qualified when the migration qualified it (§4 D53). The page used to
      // say a column references `users`, and there is no `public.users`.
      const refName = c.references.schema
        ? `${c.references.schema}.${c.references.table}`
        : c.references.table;
      rows.push(["References", `\`${esc(refName)}(${c.references.columns.join(", ")})\`${c.references.on_delete ? ` ON DELETE ${esc(c.references.on_delete)}` : ""}`]);
    }
    rows.push(["Read by the engine", c.engine.consumed_by ? `\`${esc(c.engine.consumed_by)}\`` : "**not traced**"]);
    if (c.engine.transform) rows.push(["Transform", prose(c.engine.transform)]);
    if (c.engine.missing_default) rows.push(["When NULL, the engine uses", prose(c.engine.missing_default)]);
    rows.push(["Validated at ingest", prose(c.ingest.validate)]);
    rows.push(["Rendered at", c.surfaces.length ? c.surfaces.map((s) => `\`${esc(s)}\``).join(", ") : "*not yet recorded (WP 5.1)*"]);
    out.push(`| | |`, `|---|---|`, ...rows.map(([k, v]) => `| ${k} | ${v} |`), "");

    if (c.engine_requirement) {
      const r = c.engine_requirement;
      out.push(
        `**The engine calls this \`${esc(r.level)}\`.** ${prose(r.reason)}`,
        "",
        `Fallback chain, from the engine's own registry: ${r.chain}.`,
        "",
      );
    }
    if (c.substitutions.length) {
      out.push(
        `**Substitutions** — every point where a value you did not supply can stand in`,
        `for one you did.`,
        "",
        `| When | The value used | Shown as | Visible where |`,
        `|---|---|---|---|`,
      );
      for (const s of c.substitutions) {
        out.push(`| ${prose(s.when)} | ${prose(s.value)} | \`${esc(s.provenance)}\` | ${prose(s.visible_as)} |`);
      }
      out.push("");
    }
    if (c.resolution) {
      const r = c.resolution;
      out.push(
        `**Resolution** — how a value is decided when more than one source could supply one.`,
        "",
        `| | |`, `|---|---|`,
        `| Default mode | \`${esc(r.default_mode)}\` |`,
        `| Assertable by | ${r.assertable_by.length ? r.assertable_by.map((x) => `\`${esc(x)}\``).join(", ") : "—"} |`,
        `| Estimable from | ${r.estimable_from.length ? r.estimable_from.map((x) => `\`${esc(x)}\``).join(", ") : "**never** — this value may not be estimated"} |`,
        `| Hybrid (centre / spread) | ${r.hybrid ? `\`${esc(r.hybrid.centre)}\` / \`${esc(r.hybrid.spread)}\`` : "**none** — the engine has no variability field for this quantity"} |`,
        `| On conflict | \`${esc(r.on_conflict)}\` |`,
        "",
      );
      if (r.note) out.push(prose(r.note), "");
    }
    const surf = (c.surfaces ?? []).filter((e) => e.grain === "column");
    if (surf.length) {
      out.push(
        `**Rendered on** ${surf.map((e) => `\`${esc(e.page)}\` (\`${esc(e.evidence)}\`${e.confirmed ? "" : ", **unconfirmed**"})`).join(", ")} —`,
        `each of these names this column in an explicit \`select\` list, so the claim`,
        `is about the column and not only about the table.`,
        "",
      );
    }
    if (c.note) out.push(`> ${prose(c.note)}`, "");
  }
  return out;
}

function renderIndexes(t) {
  if (!t.indexes.length) return [];
  const out = [`## Indexes\n`, `| Index | Columns | Unique | Added by |`, `|---|---|---|---|`];
  for (const i of t.indexes) {
    out.push(`| ${code(i.name)} | ${i.columns.map((c) => `\`${c}\``).join(", ")} | ${i.unique ? "yes" : "no"} | ${code(i.added_by)} |`);
  }
  out.push("");
  return out;
}


/**
 * WP 5.1 · LINEAGE — where this table's data reaches the screen.
 *
 * THREE GRADES, NEVER BLURRED, because the brief's whole constraint is that an
 * unconfirmed entry is worse than none: it will be trusted. So the page states
 * what each grade does and does not claim, rather than printing a page list and
 * letting a reader assume the strongest reading of it.
 */
function renderSurfaces(t) {
  const all = t.surfaces ?? [];
  if (!all.length) return [];
  const real = all.filter((e) => e.grain !== "shell");
  const shell = all.filter((e) => e.grain === "shell");
  const out = [`## Where this data is read\n`];

  if (!real.length) {
    out.push(
      `**No page renders this table.** Every path to it runs through app-shell`,
      `modules (auth and session) that almost every page imports, so reaching it`,
      `is a property of the import graph rather than of the product.`,
      "",
    );
  } else {
    out.push(
      `| Page | Via | Evidence | Confirmed |`, `|---|---|---|---|`,
      ...real.map((e) =>
        `| \`${esc(e.page)}\` | ${esc(e.via)} | \`${esc(e.evidence)}\` | ${e.confirmed ? "yes" : "**NO — unconfirmed**"} |`),
      "",
      `Each row says the page READS the table by that path, at that line. It does`,
      `not say every column below is displayed there — a column carries its own`,
      `lineage only where an explicit \`select\` names it. \`npm run contract:check\``,
      `R12 re-opens every evidence line on each run, so an entry cannot go stale`,
      `unnoticed.`,
      "",
    );
  }

  if (shell.length) {
    out.push(
      `<details><summary>${shell.length} app-shell read(s) — not lineage</summary>`, "",
      ...shell.map((e) => `* \`${esc(e.page)}\` — \`${esc(e.evidence)}\``),
      "",
      `These reach the table only through modules the shell mounts on every page.`,
      `Listing them as surfaces would be true about the imports and false about`,
      `the product.`,
      "", `</details>`, "",
    );
  }
  return out;
}

export function renderPage(t, contract) {
  const out = [];
  out.push(banner(t).trimEnd(), "");
  out.push(`# \`${t.table}\`\n`);
  out.push(
    `> **GENERATED** — rendered from the data contract. Edit [\`${t.sidecar}\`](../../../${t.sidecar})`,
    `> for what the columns mean, or the migrations for what the schema is. Do not edit`,
    `> this page: \`npm run contract:check\` fails when it differs from what the contract`,
    `> generates.`,
    "",
  );
  out.push(`**Tier ${t.tier}** — ${TIER_NAMES[t.tier] ?? "unknown tier"} · owned by \`${t.owner}\` · \`${t.schema_name}.${t.table}\``, "");
  out.push(`**One row is** ${prose(t.grain)}`, "");
  if (t.note) out.push(prose(t.note), "");
  out.push(...renderKeys(t));
  out.push(...renderConstraints(t));
  out.push(...renderGovernance(t));
  out.push(...renderSurfaces(t));
  out.push(...renderColumnSummary(t));
  out.push(...renderColumnDetail(t));
  out.push(...renderIndexes(t));
  out.push("---", "");
  out.push(
    `*Generated from data contract \`${contract.contract_version}\`, engine \`${contract.engine_version}\`,`,
    `sidecar \`${t.sidecar}\`, table created by \`${t.created_by}\`. No wall-clock date: a generated`,
    `page that differs from itself tomorrow cannot be drift-gated.*`,
    "",
  );
  return out.join("\n");
}

export function renderIndexPage(contract) {
  const tables = Object.values(contract.tables);
  const out = [];
  out.push(
    `<!-- GENERATED by scripts/data-contract/generate.mjs. Do not edit by hand: ` +
    `\`npm run contract:check\` fails on drift. -->`,
    "",
    `# Table reference\n`,
    `> **GENERATED** — one page per table the data contract covers. Edit the sidecars in`,
    `> \`supabase/contract/\`, not these pages.`,
    "",
    `${tables.length} of ${contract.counts.tables_in_schema} tables are covered,`,
    `${contract.counts.columns_covered} columns in all. A table that is not here is listed`,
    `with its reason in [\`scripts/data-contract/coverage.yaml\`](../../../scripts/data-contract/coverage.yaml);`,
    `\`npm run contract:check\` fails on a table that is in neither.`,
    "",
    `| Table | Tier | Owner | Columns | One row is |`,
    `|---|---|---|---|---|`,
  );
  for (const t of tables) {
    out.push(`| [\`${t.table}\`](${t.table}.md) | ${t.tier} | \`${t.owner}\` | ${t.columns.length} | ${prose(t.grain)} |`);
  }
  out.push("", "---", "");
  out.push(`*Generated from data contract \`${contract.contract_version}\`, engine \`${contract.engine_version}\`.*`, "");
  return out.join("\n");
}


// ─────────────────────────────────────────── the manual's data-model page (5.2a)

/** `coverage.yaml`'s deferrals, flattened to table → { wp, why }. */
function readCoverage() {
  const doc = load(readFileSync(COVERAGE, "utf8"));
  const byTable = new Map();
  const packages = [];
  for (const entry of doc.deferred ?? []) {
    const wp = String(entry.wp);
    const why = String(entry.why ?? "").replace(/\s+/g, " ").trim();
    packages.push({ wp, why, tables: [...entry.tables].sort() });
    for (const t of entry.tables) byTable.set(t, { wp, why });
  }
  packages.sort((a, b) => a.wp.localeCompare(b.wp, undefined, { numeric: true }));
  return { byTable, packages };
}

/** The TS module behind "The data model at a glance". Every table in the schema
 *  appears exactly once: described tables under their tier, the rest under the
 *  work package that owes them. A page that showed only the described ones
 *  would be making a false claim by omission (§5.3 T3). */
export function renderDataModelModule(contract, introspected) {
  const { byTable, packages } = readCoverage();
  const columnsOf = new Map(introspected.tables.map((t) => [t.name, t.columns.length]));

  const byTier = new Map();
  for (const t of Object.values(contract.tables)) {
    if (!byTier.has(t.tier)) byTier.set(t.tier, []);
    byTier.get(t.tier).push({
      table: t.table,
      grain: String(t.grain ?? "").replace(/\s+/g, " ").trim(),
      columns: t.columns.length,
      owner: t.owner,
    });
  }
  // Tier order is TIER_NAMES' order — the journey, not the alphabet.
  const tiers = [...Object.keys(TIER_NAMES)]
    .filter((k) => byTier.has(k))
    .map((tier) => ({
      tier,
      name: TIER_NAMES[tier],
      tables: byTier.get(tier).sort((a, b) => a.table.localeCompare(b.table)),
    }));

  const described = new Set(Object.keys(contract.tables));
  const undescribed = packages
    .map((p) => ({
      wp: p.wp,
      why: p.why,
      tables: p.tables
        .filter((t) => !described.has(t))
        .map((t) => ({ table: t, columns: columnsOf.get(t) ?? 0 })),
    }))
    .filter((p) => p.tables.length);

  // Every table in the schema is in exactly one of the two lists, or the page
  // lies. Fail the generator rather than render a page that undercounts.
  const listed = new Set([...described, ...undescribed.flatMap((p) => p.tables.map((t) => t.table))]);
  const missing = introspected.tables.map((t) => t.name).filter((n) => !listed.has(n));
  if (missing.length) {
    throw new Error(
      `dataModel.generated.ts would omit ${missing.length} table(s) in neither the ` +
      `contract nor coverage.yaml: ${missing.join(", ")}. contract:check R1 owns this.`,
    );
  }

  const json = (v) => JSON.stringify(v, null, 2);
  return [
    "// GENERATED by scripts/data-contract/generate.mjs from build/schema.introspected.json,",
    "// supabase/contract/*.yaml and scripts/data-contract/coverage.yaml.",
    "// Do not edit by hand: `npm run contract:check` fails on drift.",
    "//",
    "// PLAN.md §6.3 marks \"The data model at a glance\" G — generated. A hand-written",
    "// table list is the defect Phase 5 exists to end (D21, D22).",
    "",
    "export type GlanceTable = {",
    "  table: string;",
    "  grain: string;",
    "  columns: number;",
    "  owner: string;",
    "};",
    "",
    "export type GlanceTier = {",
    "  tier: string;",
    "  name: string;",
    "  tables: GlanceTable[];",
    "};",
    "",
    "export type UndescribedGroup = {",
    "  wp: string;",
    "  why: string;",
    "  tables: { table: string; columns: number }[];",
    "};",
    "",
    "/** The contract version these figures came from. §6.4: a version, never a date. */",
    `export const CONTRACT_VERSION = ${json(contract.contract_version)};`,
    `export const ENGINE_VERSION = ${json(contract.engine_version)};`,
    `export const LAST_MIGRATION = ${json(contract.sources.introspected.last_migration)};`,
    "",
    `export const COUNTS = ${json({
      tablesInSchema: contract.counts.tables_in_schema,
      tablesDescribed: contract.counts.tables_covered,
      columnsDescribed: contract.counts.columns_covered,
      tablesUndescribed: contract.counts.tables_in_schema - contract.counts.tables_covered,
    })} as const;`,
    "",
    "/** Described tables, grouped by the tier their data sits in. */",
    `export const TIERS: GlanceTier[] = ${json(tiers)};`,
    "",
    "/** The rest of the schema, under the work package that owes each one. */",
    `export const UNDESCRIBED: UndescribedGroup[] = ${json(undescribed)};`,
    "",
  ].join("\n");
}


// ──────────────────────────────────────── the manual's reference section (5.2h)

/** Trim a contract column to what the reference pages actually render. */
function refColumn(c) {
  return {
    name: c.name,
    type: c.type,
    nullable: c.nullable,
    unit: c.unit ?? null,
    csvHeader: c.ingest?.csv_header ?? null,
    required: Boolean(c.ingest?.required),
    validate: c.ingest?.validate ?? null,
    meaning: String(c.meaning ?? "").replace(/\s+/g, " ").trim(),
    primaryKey: Boolean(c.primary_key),
    unique: Boolean(c.unique),
    // Re-keyed rather than passed through: the introspector's `on_delete` is
    // snake_case like the SQL it read, and every other field on this type is
    // camelCase like the TypeScript that reads it. One shape, stated once.
    references: c.references
      ? {
          schema: c.references.schema,
          table: c.references.table,
          columns: c.references.columns,
          onDelete: c.references.on_delete ?? null,
        }
      : null,
    substitutions: (c.substitutions ?? []).map((x) => ({
      when: String(x.when ?? "").replace(/\s+/g, " ").trim(),
      value: String(x.value ?? "").replace(/\s+/g, " ").trim(),
      provenance: x.provenance ?? null,
      visibleAs: x.visible_as ?? null,
    })),
    // The engine's own fallback chain, rendered by the generator that reads the
    // registry (I6). Never paraphrased here.
    engineChain: c.engine_requirement?.chain ?? null,
    engineLevel: c.engine_requirement?.level ?? null,

    // ── WP 5.2b's additions ────────────────────────────────────────────────
    //
    // §6.3 section 3 gives every uploaded column an "If you leave it blank"
    // line, and PLAN.md §5.3 T1 says every such line resolves to data, a named
    // rule or an explicit default — there is no fourth option. That answer was
    // in the contract already and not in this module, so the pages could not
    // reach it without typing it, which is D21. Four ordered sources, each
    // labelled at the point of display so the reader knows WHICH answered:
    //
    //   1. `blank: "reject"`     the row does not land at all
    //   2. `substitutions[]`     a named substitution, with its provenance
    //   3. `engineMissingDefault` the engine's declared fallback (I6)
    //   4. `engineTransform`     what the engine does with a NULL it is given
    //
    // A column none of the four answers is a BLIND SPOT, and the page says so
    // (T3) rather than guessing.
    /** What the parser does with an empty cell: "reject" or "null". */
    blank: c.ingest?.rule?.kind ? (c.ingest.rule.blank ?? null) : null,
    /** The engine field this reaches, e.g. `project_map.py::… -> Material.cost`. */
    engineField: c.engine?.consumed_by ?? null,
    /** What the engine uses when this is absent. */
    engineMissingDefault: c.engine?.missing_default ?? null,
    /** What the engine does to the value it is given, NULL included. */
    engineTransform: c.engine?.transform ?? null,
    /** The sibling column that names this one's unit, where there is one (I3). */
    unitColumn: c.unit_column ?? null,
    /** How the promotion canonicalises it, where it does (I3). */
    normalizeAtPromotion: c.normalize_at_promotion
      ? {
          conversion: c.normalize_at_promotion.conversion,
          canonical: c.normalize_at_promotion.canonical,
        }
      : null,
    /** identifier · level · rate · metadata — what KIND of quantity this is. */
    quantityGrain: c.grain ?? null,
    /**
     * The analyzer that WROTE this column, where it is an analysis output.
     *
     * `null` means a person supplied it. Two of section 3's pages document a
     * table that is BOTH halves at once (§4 D56) and cannot say which is which
     * without this; the alternative was a column list typed into a page, which
     * is D21 exactly.
     */
    computedBy: c.computed_by ?? null,
  };
}

/** The per-table reference the "All tables" and "Field index" pages render. */
export function renderReferenceModule(contract) {
  const tables = Object.values(contract.tables).map((t) => ({
    table: t.table,
    tier: t.tier,
    tierName: t.tier_name,
    owner: t.owner,
    grain: String(t.grain ?? "").replace(/\s+/g, " ").trim(),
    naturalKey: (t.natural_key_unique ?? []).flatMap((k) => k.columns),
    naturalKeyIntended: t.natural_key_intended ?? null,
    checks: t.constraints
      .filter((c) => c.kind === "CHECK")
      .map((c) => ({ name: c.name, definition: c.definition })),
    // WP 5.2b: whether the table has a CSV origin at all, and under which
    // wizard. Four of §6.3 section 3's eleven tables have NONE — they reach
    // their tables through bulk RPCs rather than `ingest_land_file` (§4 D56) —
    // and a page that did not know the difference would invent an upload path.
    ingestDataset: t.ingest_dataset
      ? {
          wizardId: t.ingest_dataset.wizard_id,
          factClass: t.ingest_dataset.fact_class,
          serverSet: t.ingest_dataset.server_set ?? [],
        }
      : null,
    // WP 5.2e — WP 5.1's lineage, at TABLE grain only.
    //
    // THE THREE GRADES ARE NEVER BLURRED and only one of them is carried here.
    // `table` means "this page reads this table by this path"; `column` is a
    // stronger claim about one column; `shell` is auth/session plumbing that
    // ≥80% of pages import and is EXPLICITLY NOT LINEAGE. D82 is what happens
    // when the two are mixed — a 404 page reported as a surface for user data.
    // The manual renders `table` entries, and it renders them as "this screen
    // reads this table", which is exactly the claim the grade supports.
    surfaces: (t.surfaces ?? [])
      .filter((x) => x.grain === "table" && x.confirmed)
      .map((x) => ({ page: x.page, via: x.via, evidence: x.evidence })),
    governance: t.governance
      ? {
          read: t.governance.read ?? null,
          write: t.governance.write ?? null,
          minProjectRole: t.governance.min_project_role ?? null,
          audited: Boolean(t.governance.audited),
          rlsEnabled: Boolean(t.governance.rls_enabled),
        }
      : null,
    // WP 5.2g — what row-level security actually IS on this table, in three
    // states rather than two.
    //
    // "RLS: enabled" reads as an assurance it does not give. WP 2.4 executed
    // the migration against a real PostgreSQL and found the inherited claim
    // wrong in BOTH directions: RLS is enabled on all three item masters, AND
    // both policies on each are `USING (true)`, so enabling it buys nothing.
    // `determinate: false` is the third state — the static replay could not
    // settle the question, which is a different answer from "off" and the
    // manual renders it as one.
    rls: {
      enabled: Boolean(t.rls?.enabled),
      determinate: Boolean(t.rls?.determinate),
      policies: (t.rls?.policies ?? []).length,
      // A policy whose USING clause is the literal `true` restricts nothing.
      // Counted rather than judged, so a page can say "two of two" instead of
      // "permissive", which is a word a reader has to take on trust.
      unrestricted: (t.rls?.policies ?? []).filter((p) => String(p.using ?? "").trim() === "true").length,
    },
    columns: t.columns.map(refColumn),
  }));

  const columnCount = tables.reduce((n, t) => n + t.columns.length, 0);
  if (columnCount !== contract.counts.columns_covered) {
    throw new Error(
      `reference.generated.ts would carry ${columnCount} columns but the contract counts ` +
      `${contract.counts.columns_covered}. The two must agree or the field index undercounts.`,
    );
  }

  return [
    "// GENERATED by scripts/data-contract/generate.mjs from the data contract.",
    "// Do not edit by hand: `npm run contract:check` fails on drift.",
    "//",
    "// PLAN.md §6.3 section 15 marks \"All tables\" and \"Field index\" G. Every column",
    "// name, type, unit, CSV header, constraint and substitution below is authored in",
    "// supabase/contract/*.yaml and read from there — never typed into a page.",
    "",
    "/**",
    " * A foreign key, as the introspector reports it (D57).",
    " *",
    " * It was declared `string | null` here while `refColumn()` emitted this",
    " * object — the generator and its own type disagreed from the day WP 5.2h",
    " * wrote them, and sixty-one TS2322 errors went unseen because nothing in",
    " * this repository typechecked. The OBJECT is kept and the type corrected,",
    " * not the reverse: a reference page wants to say WHICH table a column",
    " * points at, and a stringified key cannot be linked to.",
    " */",
    "export type RefReference = {",
    "  schema: string;",
    "  table: string;",
    "  columns: string[];",
    "  onDelete: string | null;",
    "};",
    "",
    "export type RefSubstitution = {",
    "  when: string;",
    "  value: string;",
    "  provenance: string | null;",
    "  visibleAs: string | null;",
    "};",
    "",
    "export type RefColumn = {",
    "  name: string;",
    "  type: string;",
    "  nullable: boolean;",
    "  unit: string | null;",
    "  /** The header the user types in the CSV — the name that leads (D21). */",
    "  csvHeader: string | null;",
    "  required: boolean;",
    "  validate: string | null;",
    "  meaning: string;",
    "  primaryKey: boolean;",
    "  unique: boolean;",
    "  references: RefReference | null;",
    "  substitutions: RefSubstitution[];",
    "  engineChain: string | null;",
    "  engineLevel: string | null;",
    "  /** What an empty cell does: \"reject\" the row, or store `null`. */",
    "  blank: \"reject\" | \"null\" | null;",
    "  engineField: string | null;",
    "  engineMissingDefault: string | null;",
    "  engineTransform: string | null;",
    "  unitColumn: string | null;",
    "  normalizeAtPromotion: { conversion: string; canonical: string } | null;",
    "  quantityGrain: string | null;",
    "  /** The analyzer that wrote it. `null` means a person supplied it. */",
    "  computedBy: string | null;",
    "};",
    "",
    "export type RefTable = {",
    "  table: string;",
    "  tier: string;",
    "  tierName: string;",
    "  owner: string;",
    "  grain: string;",
    "  naturalKey: string[];",
    "  naturalKeyIntended: string[] | null;",
    "  checks: { name: string; definition: string }[];",
    "  /**",
    "   * Which screens read this table, at TABLE grain, human-confirmed (WP 5.1).",
    "   *",
    "   * `column`-grain and `shell`-grain entries are deliberately NOT here:",
    "   * a shell entry is auth plumbing that almost every page imports and is",
    "   * not lineage at all, and presenting one as a data surface is §4 D82.",
    "   */",
    "  surfaces: { page: string; via: string; evidence: string }[];",
    "  /** The CSV origin, where the table has one. `null` means it has none. */",
    "  ingestDataset: { wizardId: string; factClass: string; serverSet: string[] } | null;",
    "  /**",
    "   * Row-level security, in THREE states. `determinate: false` means the",
    "   * static replay could not settle it — which is not the same answer as",
    "   * `enabled: false`, and WP 2.4 is why the difference is carried.",
    "   */",
    "  rls: { enabled: boolean; determinate: boolean; policies: number; unrestricted: number };",
    "  governance: {",
    "    read: string | null;",
    "    write: string | null;",
    "    minProjectRole: string | null;",
    "    audited: boolean;",
    "    rlsEnabled: boolean;",
    "  } | null;",
    "  columns: RefColumn[];",
    "};",
    "",
    `export const REFERENCE_COLUMN_COUNT = ${columnCount};`,
    "",
    `export const REFERENCE_TABLES: RefTable[] = ${JSON.stringify(tables, null, 2)};`,
    "",
  ].join("\n");
}

/**
 * The CSV ingestion spec (WP 3.2).
 *
 * Built from the sidecars alone: `ingest_dataset` says a table has a CSV origin,
 * `ingest.csv_header` says which header feeds which column, `ingest.required`
 * says whether the file must carry it, and `ingest.rule` says what the cell must
 * satisfy. Nothing here is typed twice — a dataset gains a column by gaining a
 * sidecar entry, and `contract:generate -- --check` fails if this file and the
 * sidecars stop agreeing.
 */
export function renderIngestSpecModule(contract) {
  const datasets = Object.values(contract.tables)
    .filter((t) => t.ingest_dataset)
    .sort((a, b) => a.table.localeCompare(b.table))
    .map((t) => {
      const serverSet = new Set(t.ingest_dataset.server_set ?? []);
      const columns = t.columns
        .filter((c) => c.ingest?.csv_header)
        .map((c) => {
          if (serverSet.has(c.name)) {
            throw new Error(
              `${t.table}.${c.name} is in ingest_dataset.server_set AND names a csv_header. ` +
              "A column the server supplies cannot also be read from the file.",
            );
          }
          if (!c.ingest.rule) {
            throw new Error(
              `${t.table}.${c.name} names csv_header "${c.ingest.csv_header}" but carries no ` +
              "`ingest.rule`. A column the parser reads with no rule it can execute is the " +
              "prose-only validation WP 3.2 exists to end — author the rule or drop the header.",
            );
          }
          return {
            column: c.name,
            csvHeader: c.ingest.csv_header,
            required: c.ingest.required === true,
            type: c.type,
            nullable: c.nullable,
            rule: c.ingest.rule,
            // The sentence beside the check, so a finding can quote the contract
            // rather than paraphrase it.
            validate: c.ingest.validate ?? null,
          };
        });
      if (!columns.length) {
        throw new Error(`${t.table} declares ingest_dataset but no column names a csv_header.`);
      }
      // WP 3.3 (I3) — the unit conversions the PROMOTION applies. Authored on the
      // field, not here: `unit_column` already says which column names the unit
      // and `normalize_at_promotion` says which conversion and what it lands in.
      // Restated in SQL by `ingest_normalize_at_promotion()` because SQL cannot
      // import this module, and `ingestSpecParity.test.ts` fails when the two
      // disagree — the same arrangement PROMOTABLE_TARGETS already has.
      const normalize = t.columns
        .filter((c) => c.normalize_at_promotion)
        .map((c) => {
          if (!c.unit_column) {
            throw new Error(
              `${t.table}.${c.name} declares normalize_at_promotion but no unit_column. ` +
              "A conversion with no column to read the unit from cannot be executed.",
            );
          }
          const unit = t.columns.find((u) => u.name === c.unit_column);
          if (!unit) {
            throw new Error(
              `${t.table}.${c.name}'s unit_column "${c.unit_column}" is not a column of ${t.table}.`,
            );
          }
          return {
            column: c.name,
            unitColumn: c.unit_column,
            conversion: c.normalize_at_promotion.conversion,
            canonical: c.normalize_at_promotion.canonical,
          };
        })
        .sort((a, b) => a.column.localeCompare(b.column));
      return {
        dataset: t.ingest_dataset.wizard_id,
        target: t.table,
        tier: t.tier,
        factClass: t.ingest_dataset.fact_class,
        serverSet: [...serverSet],
        columns,
        normalize,
      };
    });

  const promotable = datasets.map((d) => d.target).sort();

  return [
    "// GENERATED by scripts/data-contract/generate.mjs from the data contract.",
    "// Do not edit by hand: `npm run contract:check` fails on drift.",
    "//",
    "// Phase 3 / WP 3.2 — the CSV ingestion spec. `ingest-file` parses and validates",
    "// from this and from nothing else; every header, every required flag and every",
    "// rule below is authored in supabase/contract/*.contract.yaml.",
    "//",
    "// PROMOTABLE_TARGETS must equal the list inside public.ingest_target_is_promotable()",
    "// (20260916000015_ingest_landing.sql). `ingestSpecParity.test.ts` fails if they",
    "// drift — the SQL cannot import this file, so the parity is checked instead of",
    "// assumed.",
    "",
    "export type IngestRule = {",
    "  kind: 'text' | 'numeric' | 'integer' | 'unit' | 'enum' | 'boolean';",
    "  min?: number;",
    "  exclusive_min?: number;",
    "  max?: number;",
    "  values?: string[];",
    "  /** What an empty cell means: land no value, or reject the row. */",
    "  blank?: 'null' | 'reject';",
    "};",
    "",
    "export type IngestColumn = {",
    "  column: string;",
    "  csvHeader: string;",
    "  required: boolean;",
    "  type: string;",
    "  nullable: boolean;",
    "  rule: IngestRule;",
    "  validate: string | null;",
    "};",
    "",
    "/**",
    " * WP 3.3 (I3) — one unit conversion the PROMOTION applies, so that nothing",
    " * downstream converts. `rate` is a quantity per unit-period (rate_to_weekly);",
    " * `duration` is a length of time (duration_to_weeks). They are not inverses.",
    " * After promotion the row's `unitColumn` reads `canonical`, so a tier-2 row",
    " * states its own unit instead of relying on a default (§5 T1).",
    " */",
    "export type IngestNormalization = {",
    "  column: string;",
    "  unitColumn: string;",
    "  conversion: 'rate' | 'duration';",
    "  canonical: string;",
    "};",
    "",
    "export type IngestDataset = {",
    "  /** The template id UploadWizard offers. */",
    "  dataset: string;",
    "  /** The tier-2 table a promoted row lands in. */",
    "  target: string;",
    "  tier: string;",
    "  factClass: 'master' | 'transactional';",
    "  /** Columns the server supplies from the project; a file may not carry them. */",
    "  serverSet: string[];",
    "  columns: IngestColumn[];",
    "  /** Unit conversions the promotion applies; empty when the dataset has none. */",
    "  normalize: IngestNormalization[];",
    "};",
    "",
    `export const INGEST_DATASETS: Record<string, IngestDataset> = ${
      JSON.stringify(Object.fromEntries(datasets.map((d) => [d.dataset, d])), null, 2)
    };`,
    "",
    `export const PROMOTABLE_TARGETS: string[] = ${JSON.stringify(promotable, null, 2)};`,
    "",
  ].join("\n");
}

// ──────────────────────── the manual's policy section (5.2c)

/**
 * The resolution chains, as §6.3 section 5's pages render them.
 *
 * NOT A SECOND DERIVATION. `deriveChains` bundles and calls
 * `src/lib/policies/resolutionChains.ts` — the module `resolutionChains.test.ts`
 * ratchets — with exactly the sources that suite passes it. One derivation, two
 * readers: the gate that fails when a chain breaks, and the manual that tells a
 * user which of their cells changes a run.
 *
 * WP 6.1's own opening sentence is the reason: "~120 hand-written chains are
 * true on the day they are typed", which is D21 and D22 stated as a rule.
 */
export function renderAnalysisKinds(contract) {
  const kinds = [];
  for (const t of Object.values(contract.tables)) {
    for (const [kind, k] of Object.entries(t.analysis_kinds ?? {})) {
      kinds.push({
        kind,
        computedBy: k.computed_by,
        codeVersion: k.code_version ?? null,
        entityType: k.entity_type,
        note: String(k.note ?? "").replace(/\s+/g, " ").trim() || null,
        params: Object.entries(k.params ?? {}).map(([name, p]) => ({
          name,
          type: p.type,
          default: p.default ?? null,
          meaning: String(p.meaning ?? "").replace(/\s+/g, " ").trim(),
        })),
      });
    }
  }
  return kinds.sort((a, b) => a.kind.localeCompare(b.kind));
}

export function renderPolicyModule(contract, registry) {
  const { chains, order, orderSource } = deriveChains(ROOT, contract, registry);
  const broken = chains.filter((c) => c.breaks.length);
  const byClass = {};
  for (const c of broken) (byClass[c.breakClass] ??= []).push(`${c.stage}.${c.field}`);

  return [
    "// GENERATED by scripts/data-contract/generate.mjs via scripts/data-contract/chains.mjs.",
    "// Do not edit by hand: `npm run contract:check` fails on drift.",
    "//",
    "// WP 5.2c — PLAN.md §6.3 section 5. Every chain below is DERIVED from the",
    "// contract, the engine registry and the engine sources by",
    "// src/lib/policies/resolutionChains.ts, which is also what",
    "// resolutionChains.test.ts ratchets. The manual and the gate cannot disagree",
    "// about which chains break, because they are the same derivation.",
    "",
    "/** One hop of a chain, with where the claim can be checked. */",
    "export type ChainHop = {",
    "  kind: 'csv' | 'db' | 'rpc' | 'hook' | 'substitution' | 'engine' | 'unit';",
    "  detail: string;",
    "  /** `path:line`, or null when the hop is a contract fact rather than a code site. */",
    "  evidence: string | null;",
    "};",
    "",
    "/**",
    " * The five shapes a broken chain takes. Each needs a DIFFERENT sentence to a",
    " * user, which is why the shape is carried and not just the reason:",
    " *   legacy-only  read only by the frozen legacy engine",
    " *   app-routing  an application routing decision the engine excludes on purpose",
    " *   overridden   accepted and stored while the engine computes it and ignores yours",
    " *   no-target    the storage column named by the chain does not exist",
    " *   unread       read by nothing, anywhere",
    " */",
    "export type BreakClass = 'legacy-only' | 'app-routing' | 'overridden' | 'no-target' | 'unread';",
    "",
    "export type PolicyChain = {",
    "  stage: string;",
    "  field: string;",
    "  family: string;",
    "  hops: ChainHop[];",
    "  /** Why the chain cannot be written end to end. Empty means it can. */",
    "  breaks: string[];",
    "  breakClass: BreakClass | null;",
    "  /** `path:line` for each claim the classification rests on. */",
    "  breakEvidence: string[];",
    "};",
    "",
    "/** The resolver's precedence. The FIRST branch that matches wins. */",
    "export type ResolutionStep = { step: string; meaning: string };",
    "",
    `export const RESOLUTION_ORDER: ResolutionStep[] = ${JSON.stringify(order, null, 2)};`,
    "",
    `export const RESOLUTION_ORDER_SOURCE = ${JSON.stringify(orderSource)};`,
    "",
    `export const CHAINS: PolicyChain[] = ${JSON.stringify(chains, null, 2)};`,
    "",
    "/** How many chains break, by shape. A page renders the number, never types it. */",
    `export const BREAKS_BY_CLASS: Record<string, string[]> = ${JSON.stringify(byClass, null, 2)};`,
    "",
    "/**",
    " * WP 4.2's OPEN ENUM of analysis kinds, from the sidecar that declares it.",
    " *",
    " * The catalog is a data fact, so it is authored once — in",
    " * `analysis_runs.contract.yaml` — rather than in a CHECK constraint, which",
    " * could only constrain the shape. §4 D79 is what the alternative costs: a",
    " * kind was declared here with a parameter no code takes, and §11's \"four",
    " * analyzers\" turned out to be three.",
    " */",
    "export type AnalysisKind = {",
    "  kind: string;",
    "  computedBy: string;",
    "  codeVersion: string | null;",
    "  entityType: string;",
    "  note: string | null;",
    "  params: { name: string; type: string; default: unknown; meaning: string }[];",
    "};",
    "",
    `export const ANALYSIS_KINDS: AnalysisKind[] = ${JSON.stringify(renderAnalysisKinds(contract), null, 2)};`,
    "",
    "/**",
    " * The stress-test battery, READ FROM THE ENGINE SOURCE.",
    " *",
    " * This is §4 D90's weakest door — a text scan over a Python literal — and",
    " * the page that renders it says so. The battery is not in",
    " * `registry_export.py`, which is where a declaration belongs; until it is,",
    " * a scan that goes red when the literal moves beats a hand copy that goes",
    " * quietly wrong (§4 D22, and the archived copy already had).",
    " *",
    " * `runnable` is derived from a `_run_battery(..., \"ST-n\", ...)` call site,",
    " * not from the module docstring that claims the same thing.",
    " */",
    "export type StressTest = { id: string; description: string; runnable: boolean };",
    "",
    `export const STRESS_TESTS: StressTest[] = ${JSON.stringify(deriveStressTests(ROOT), null, 2)};`,
    "",
    "/**",
    " * The public API's routes, read from the dispatcher's own table.",
    " *",
    " * §6.3 marks this section G. The data contract describes TABLES and not an",
    " * HTTP surface, so the nearest declaration is the `routes` literal the",
    " * dispatcher itself matches against — which means a route added, removed",
    " * or re-scoped changes the manual with nobody editing a page. Another",
    " * instance of §4 D90's weakest door, and the page says so.",
    " */",
    "export type ApiRoute = { method: string; path: string; scope: string; handler: string };",
    "",
    `export const API_ROUTES: ApiRoute[] = ${JSON.stringify(deriveApiRoutes(ROOT), null, 2)};`,
    "",
    "/**",
    " * The seven stress presets Simulation Lab offers, from the drawer's own",
    " * literal — §4 D111.",
    " *",
    " * `STRESS_TESTS` above is the ENGINE's battery: a Python library API",
    " * importable from `scsim` and reachable from nothing the product runs.",
    " * These are what a user clicks. `resolves` on each event, and",
    " * `reachesEngine` on each preset, are the mapper's own rule applied to the",
    " * preset's fixed target — derived in `chains.mjs` against pinned anchors in",
    " * `project_map.py`, so the classification goes red when the mapper moves",
    " * rather than going quietly wrong.",
    " */",
    "export type StressPresetEvent = {",
    "  target: string;",
    "  targetType: string;",
    "  startDay: number;",
    "  durationDays: number;",
    "  magnitudePct: number;",
    "  /** `plant` always maps · `supplier-id` maps only on a matching project · `unsupported` never maps. */",
    "  resolves: \"plant\" | \"supplier-id\" | \"unsupported\";",
    "};",
    "",
    "export type StressPreset = {",
    "  id: string;",
    "  label: string;",
    "  scenarioName: string;",
    "  description: string;",
    "  events: StressPresetEvent[];",
    "  reachesEngine: boolean;",
    "};",
    "",
    `export const STRESS_PRESETS: StressPreset[] = ${JSON.stringify(deriveStressPresets(ROOT), null, 2)};`,
    "",
    "/**",
    " * The template and guide the upload wizard offers per dataset — §4 D110.",
    " *",
    " * Derived from `UploadWizard.tsx`'s `templateTypes`, which is where the",
    " * pairing is declared, so a template renamed in the wizard cannot leave a",
    " * dead link on a documentation page. `templateFile: null` is a declaration",
    " * and not a gap — `node_list` deliberately ships none.",
    " */",
    "export type UploadAsset = {",
    "  id: string;",
    "  name: string;",
    "  description: string;",
    "  templateFile: string | null;",
    "  guideFile: string | null;",
    "};",
    "",
    `export const UPLOAD_ASSETS: UploadAsset[] = ${JSON.stringify(deriveUploadAssets(ROOT), null, 2)};`,
    "",
    "/** The Colab notebook `/developer` offers, read from the href that offers it. */",
    `export const API_NOTEBOOK = ${JSON.stringify(deriveApiNotebook(ROOT))};`,
    "",
    "/**",
    " * Every failure the public API can return, by stable machine code.",
    " *",
    " * Read from the dispatcher's own `ApiError` construction sites, so a code",
    " * the server stops throwing leaves this page on the next regenerate —",
    " * which is §4 D21 and D22 pointed at an error a client branches on.",
    " * `sites` is how many places raise it; `message` is the first, with",
    " * `${...}` left in place because a runtime value's SHAPE is the fact.",
    " */",
    "export type ApiErrorCode = { code: string; status: number; message: string; sites: number };",
    "",
    `export const API_ERRORS: ApiErrorCode[] = ${JSON.stringify(deriveApiErrors(ROOT), null, 2)};`,
    "",
    "/**",
    " * The public API's ceilings, from the dispatcher's own literals.",
    " *",
    " * A per-key or per-organization row overrides the per-environment defaults",
    " * without a deploy, so these are the floor a client should assume rather",
    " * than a promise about any particular key.",
    " */",
    "export type ApiLimits = {",
    "  envs: { env: string; rpm: number; rpd: number; maxConcurrentRuns: number }[];",
    "  maxBodyKb: number;",
    "  idempotencyTtlHours: number;",
    "  failedAuthsPerMinutePerIp: number;",
    "  maxPageSize: number;",
    "  defaultPageSize: number;",
    "};",
    "",
    `export const API_LIMITS: ApiLimits = ${JSON.stringify(deriveApiLimits(ROOT), null, 2)};`,
    "",
    "/**",
    " * The weekly measures an inspection run keeps, per item.",
    " *",
    " * `run_item_series` is deferred in the contract, so this is joined from the",
    " * two places that declare it: the engine (which item kind each measure",
    " * belongs to) and the explorer's legend (the name the reader sees). The",
    " * derivation throws on either half missing a measure the other has.",
    " */",
    "export type ItemSeries = { kind: string; key: string; label: string };",
    "",
    `export const ITEM_SERIES: ItemSeries[] = ${JSON.stringify(deriveItemSeries(ROOT), null, 2)};`,
    "",
    "/**",
    " * What a replication row carries, against what the results table looks for.",
    " *",
    " * `emitted` is the engine's own per-replication row; `always: false` means",
    " * the measure exists only on a run that had a disruption. `display` is the",
    " * results screen's vocabulary with a flag saying whether the engine ever",
    " * writes that key — §4 D21 at the results layer, visible only in the join.",
    " */",
    "export type RunKpis = {",
    "  emitted: { key: string; always: boolean }[];",
    "  display: { key: string; label: string; emitted: boolean }[];",
    "  /** The scenario objective a user may pick, and whether a run produces it. */",
    "  objectives: { key: string; label: string; emitted: boolean }[];",
    "};",
    "",
    `export const RUN_KPIS: RunKpis = ${JSON.stringify(deriveRunKpis(ROOT), null, 2)};`,
    "",
    "/**",
    " * The weekly series a replication carries, and the one panel that looks for",
    " * a series nothing writes.",
    " */",
    "export type ReplicationSeries = {",
    "  written: string[];",
    "  offered: { key: string; label: string; unit: string; written: boolean }[];",
    "  heatmapWants: string;",
    "  heatmapEverRenders: boolean;",
    "};",
    "",
    `export const REPLICATION_SERIES_FACTS: ReplicationSeries = ${JSON.stringify(deriveReplicationSeries(ROOT), null, 2)};`,
    "",
    "/**",
    " * A scenario's settings, labelled as the setup form labels them.",
    " *",
    " * `scenarios` is deferred in the contract, so this is the only route to a",
    " * settings reference. Label → stored key → default is a join the form's",
    " * own `prov(local.X !== SCENARIO_ENGINE_DEFAULTS.X)` already declares.",
    " */",
    "export type ScenarioSetupGroup = {",
    "  name: string;",
    "  fields: { label: string; unit: string | null; key: string; default: string }[];",
    "};",
    "",
    `export const SCENARIO_SETUP: ScenarioSetupGroup[] = ${JSON.stringify(deriveScenarioSetup(ROOT), null, 2)};`,
    "",
    "/**",
    " * The recovery levers a scenario offers, joined to the engine plugin each",
    " * one reaches — `plugin: null` means the engine has no branch for it, so",
    " * the lever is saved, shown enabled, and changes no number.",
    " *",
    " * `inGrid` is whether the /policies grid offers the same response: that",
    " * list was already restricted to what the engine maps, so the two",
    " * disagreeing is the finding. `engineOnly` is the reverse — responses the",
    " * engine honours that the scenario pane never offers.",
    " */",
    "export type RecoveryLever = {",
    "  key: string;",
    "  label: string;",
    "  description: string | null;",
    "  plugin: string | null;",
    "  inGrid: boolean;",
    "  params: { key: string; label: string; unit: string; default: number; hint: string | null }[];",
    "};",
    "",
    "export type RecoveryLevers = {",
    "  levers: RecoveryLever[];",
    "  engineOnly: { key: string; plugin: string; inGrid: boolean }[];",
    "};",
    "",
    `export const RECOVERY_LEVERS: RecoveryLevers = ${JSON.stringify(deriveRecoveryLevers(ROOT), null, 2)};`,
    "",
    `export const CHAIN_COUNT = ${chains.length};`,
    `export const BROKEN_COUNT = ${broken.length};`,
    "",
  ].join("\n");
}

/**
 * Files this generator owns that are NOT per-table pages: the contract itself,
 * the manual's three generated modules and the ingestion spec. Counted rather
 * than hard-coded as "- 4", which is what it was until this module made it 5
 * and the page count started printing one too many.
 */
const NON_PAGE_FILES = 5;

/** Every file this generator owns, path → content. */
export function renderAll(contract, introspected, registry) {
  const files = new Map();
  files.set(join(PAGES_DIR, "README.md"), renderIndexPage(contract));
  for (const t of Object.values(contract.tables)) {
    files.set(join(PAGES_DIR, `${t.table}.md`), renderPage(t, contract));
  }
  files.set(DOCS_DATA_MODEL, renderDataModelModule(contract, introspected));
  files.set(DOCS_REFERENCE, renderReferenceModule(contract));
  files.set(INGEST_SPEC, renderIngestSpecModule(contract));
  files.set(DOCS_POLICY, renderPolicyModule(contract, registry));
  files.set(CONTRACT_OUT, JSON.stringify(contract, null, 2) + "\n");
  return files;
}

// ──────────────────────────────────────────────────────────────────────── main

export function generate() {
  const sources = readSources();
  const { payload, problems } = buildContract(sources);
  return { contract: payload, files: renderAll(payload, sources.introspected, sources.registry), problems };
}

function main() {
  const checking = process.argv.includes("--check");
  const { contract, files, problems } = generate();

  if (problems.length) {
    console.error("THE CONTRACT DOES NOT BUILD — the schema, the sidecars and the engine disagree:\n");
    for (const p of problems) console.error(`  ✗ ${p}`);
    console.error("\nFix the sidecar or the migration. Do not relax the generator.");
    return 1;
  }

  if (checking) {
    const drifted = [];
    for (const [path, content] of files) {
      if (!existsSync(path) || readFileSync(path, "utf8") !== content) drifted.push(relative(ROOT, path));
    }
    // A committed page for a table that is no longer covered is drift too: it
    // documents something the contract has stopped describing.
    const owned = new Set([...files.keys()]);
    for (const f of existsSync(PAGES_DIR) ? readdirSync(PAGES_DIR) : []) {
      if (f.endsWith(".md") && !owned.has(join(PAGES_DIR, f))) drifted.push(`${relative(ROOT, join(PAGES_DIR, f))} (orphaned page)`);
    }
    if (drifted.length) {
      console.error(
        `CONTRACT DRIFT: ${drifted.length} file(s) differ from what the contract generates —\n` +
        drifted.map((d) => `  ${d}`).join("\n") +
        "\n\nRun `npm run contract:generate` and commit.",
      );
      return 1;
    }
    console.log(
      `✓ the contract, its ${files.size - NON_PAGE_FILES} pages and the manual's three generated modules match ` +
      `the schema, the sidecars and engine ${contract.engine_version} ` +
      `(contract ${contract.contract_version})`,
    );
    return 0;
  }

  mkdirSync(PAGES_DIR, { recursive: true });
  mkdirSync(dirname(DOCS_DATA_MODEL), { recursive: true });
  // Remove pages for tables the contract no longer covers, so deleting a sidecar
  // deletes its page rather than leaving a document with no source.
  const owned = new Set([...files.keys()]);
  for (const f of readdirSync(PAGES_DIR)) {
    const p = join(PAGES_DIR, f);
    if (f.endsWith(".md") && !owned.has(p)) { rmSync(p); console.log(`  removed ${relative(ROOT, p)} — no longer covered`); }
  }
  for (const [path, content] of files) writeFileSync(path, content);
  console.log(
    `✓ contract ${contract.contract_version} — ${contract.counts.tables_covered} tables, ` +
    `${contract.counts.columns_covered} columns, ${contract.counts.check_constraints} CHECK constraints, ` +
    `${contract.counts.engine_requirements} engine requirements\n` +
    `  ${relative(ROOT, CONTRACT_OUT)} + ${files.size - NON_PAGE_FILES} pages under ${relative(ROOT, PAGES_DIR)}/\n` +
    `  ${relative(ROOT, DOCS_DATA_MODEL)}\n` +
    `  ${relative(ROOT, DOCS_REFERENCE)}\n` +
    `  ${relative(ROOT, INGEST_SPEC)}\n` +
    `  ${relative(ROOT, DOCS_POLICY)}`,
  );
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) process.exit(main());
