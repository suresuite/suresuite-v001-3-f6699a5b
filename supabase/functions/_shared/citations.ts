// Citation resolver — Phase H1 (ai-agents.md §22.2).
//
// The §4.3 citation shape, made resolvable: resolveCitation() checks that a
// citation's `ref` names a real artifact of THIS project, using the same
// service-role project-scoped reads every tool makes. It is a pure function
// over an injected client (no module-level client, no env reads) so the
// deterministic eval tier drives it against the stub DB and the §22.3
// verifier / UI click-through drive it against the live database — one
// resolution semantics everywhere.
//
// Resolution strength per kind (§22.2, §4.3 locators):
//   run:<uuid>              → simulation_runs row exists in the project
//                             (resolves to the Lab deep link)
//   validation_card:<uuid>  → model_validations row exists in the project
//   table_rows:<table>+rows → every listed entity id exists in that table
//                             under this project (closed table→id-column map)
//   tool_call:<tool>#<h12>  → the hash matches a tool call recorded THIS turn
//                             (the caller passes the turn's recorded refs)
//   registry:<ref>          → the catalog ref / field path exists in the
//                             registry export (policyFields.ts, the §6.2 SSOT)
//   document:<path#anchor>  → locator-shape check only (the server cannot
//                             read the repo at runtime)
//   user_message:<locator>  → locator-shape check only ('thread:<id>#<msg>' —
//                             threads may live client-side, §14.1)

import { FAMILY_FIELDS, policyCatalogRows } from "./policyFields.ts";

export type CitationKind =
  | "tool_call"
  | "table_rows"
  | "registry"
  | "run"
  | "validation_card"
  | "document"
  | "user_message";

/** The §4.3 JSONB item shape (citations.v1.json). */
export interface Citation {
  kind: CitationKind;
  ref: string;
  rows?: string[];
  quote?: string;
}

/** Structural client so this module never imports the supabase-js bundle. */
export interface CitationDb {
  // deno-lint-ignore no-explicit-any
  from(table: string): any;
}

export interface ResolveOptions {
  /** `<tool>#<args_sha256_12>` refs recorded THIS turn (tool_call kind). */
  toolCallRefs?: ReadonlySet<string>;
}

export interface ResolveResult {
  ok: boolean;
  /** One-line reason on failure (ids and shapes only — §7.5 safe). */
  reason?: string;
  /** In-app deep link for click-through, when the kind has one. */
  link?: string;
}

const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Closed map: which project tables a table_rows citation may name, and which
 * columns count as that table's entity ids. Never resolve arbitrary tables. */
const TABLE_ROW_ID_COLS: Record<string, string[]> = {
  suppliers: ["supplier_id"],
  materials: ["material_id"],
  products: ["product_id"],
  node_list: ["node_id"],
  inbound_logistics: ["supplier_id", "material_id"],
  outbound_logistics: ["customer_id", "product_id"],
  bom_multi_level: ["material_id", "higher_level_component_id"],
  scenarios: ["id"],
  simulation_runs: ["id"],
};

const catalogRefRe = /^P-[SPTCFXW]\.\d+/;

function registryRefExists(ref: string): boolean {
  // Catalog refs (P-S.x …) resolve against the generated catalog rows; field
  // paths ("family.field") resolve against the registry-overlaid field specs.
  if (catalogRefRe.test(ref)) {
    return policyCatalogRows().some((r) => r.catalog_ref === ref || ref.startsWith(r.catalog_ref));
  }
  const [family, field] = ref.split(".", 2);
  const fields = (FAMILY_FIELDS as Record<string, Record<string, unknown>>)[family];
  if (!fields) return false;
  return field == null || field === "" || field in fields;
}

export async function resolveCitation(
  citation: Citation,
  projectId: string,
  db: CitationDb,
  opts: ResolveOptions = {},
): Promise<ResolveResult> {
  const ref = String(citation?.ref ?? "").trim();
  if (!ref) return { ok: false, reason: "empty ref" };

  try {
    switch (citation.kind) {
      case "run": {
        if (!uuidRe.test(ref)) return { ok: false, reason: "run ref is not a uuid" };
        const { data, error } = await db
          .from("simulation_runs")
          .select("id")
          .eq("project_id", projectId)
          .eq("id", ref)
          .limit(1);
        if (error) return { ok: false, reason: `run lookup failed: ${error.message}` };
        if (!Array.isArray(data) || data.length === 0) {
          return { ok: false, reason: `run ${ref} not found in this project` };
        }
        return { ok: true, link: `/simulation-lab?run=${ref}` };
      }
      case "validation_card": {
        if (!uuidRe.test(ref)) return { ok: false, reason: "validation_card ref is not a uuid" };
        const { data, error } = await db
          .from("model_validations")
          .select("id")
          .eq("project_id", projectId)
          .eq("id", ref)
          .limit(1);
        if (error) return { ok: false, reason: `validation_card lookup failed: ${error.message}` };
        if (!Array.isArray(data) || data.length === 0) {
          return { ok: false, reason: `validation card ${ref} not found in this project` };
        }
        return { ok: true, link: `/policies` };
      }
      case "table_rows": {
        const idCols = TABLE_ROW_ID_COLS[ref];
        if (!idCols) return { ok: false, reason: `table ${ref} is not citable` };
        const rows = (citation.rows ?? []).map((r) => String(r));
        if (rows.length === 0) return { ok: false, reason: "table_rows citation lists no rows" };
        const { data, error } = await db
          .from(ref)
          .select(idCols.join(", "))
          .eq("project_id", projectId)
          .limit(10000);
        if (error) return { ok: false, reason: `${ref} lookup failed: ${error.message}` };
        const present = new Set<string>();
        for (const row of (data ?? []) as Record<string, unknown>[]) {
          for (const col of idCols) {
            const v = row[col];
            if (v != null) present.add(String(v));
          }
        }
        const missing = rows.filter((r) => !present.has(r));
        if (missing.length > 0) {
          return { ok: false, reason: `${missing.length} cited id(s) not in ${ref} (e.g. ${missing[0]})` };
        }
        return { ok: true };
      }
      case "tool_call": {
        // '<tool>#<args_sha256_12>' — must match a call recorded THIS turn;
        // entries are handler-assembled, so a miss means a minted citation.
        if (!/^[a-z0-9_]+#[0-9a-f]{12}$/i.test(ref)) {
          return { ok: false, reason: "tool_call ref must be '<tool>#<args_sha256_12>'" };
        }
        if (!opts.toolCallRefs || !opts.toolCallRefs.has(ref)) {
          return { ok: false, reason: `no tool call recorded this turn matches ${ref}` };
        }
        return { ok: true };
      }
      case "registry": {
        return registryRefExists(ref)
          ? { ok: true }
          : { ok: false, reason: `registry ref ${ref} not found in the registry export` };
      }
      case "document": {
        // Repo path (+ optional anchor), or a store-scoped ref
        // `<store>:<id>` — the Q22g idiom (`project_memory:<id>`,
        // `external_evidence:<id>`; §10 note 36f). Shape-checked only; the
        // draft/apply gates that consume store refs verify real existence.
        return /^[\w./-]+(:[\w-]+)?(#[\w.@-]+)?$/.test(ref)
          ? { ok: true }
          : { ok: false, reason: "document ref is not a repo path or store-scoped ref" };
      }
      case "user_message": {
        return /^thread:.+#.+$/.test(ref)
          ? { ok: true }
          : { ok: false, reason: "user_message ref must be 'thread:<thread_id>#<msg_id>'" };
      }
      default:
        return { ok: false, reason: `unknown citation kind ${String((citation as { kind?: unknown }).kind)}` };
    }
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : "resolution failed" };
  }
}
