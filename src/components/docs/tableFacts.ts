// The facts behind §6.3 section 3's table pages — WP 5.2b.
//
// Split out of `tableRef.tsx` because these are functions and types, not
// components, and a module that exports both breaks fast refresh for everything
// that imports it. The reasoning that matters is with the code below; the
// rendering that uses it is next door.
//
// Nothing here types a column name, a unit, a constraint, a default or an
// engine field. If a page needs a fact these cannot reach, the fix is a sidecar
// edit and a regenerate — never a literal.

import {
  REFERENCE_TABLES,
  type RefColumn,
  type RefTable,
} from "@/components/docs/generated/reference.generated";
import { UPLOAD_ASSETS, type UploadAsset } from "@/components/docs/generated/policy.generated";
import { ALL_PAGES } from "@/components/docs/registry";

/** The contract row for a table, by name. Throws rather than rendering a blank. */
export function refTable(name: string): RefTable {
  const t = REFERENCE_TABLES.find((x) => x.table === name);
  if (!t) {
    // A page pointing at a table the contract does not describe is a broken
    // page, and a silent empty section is the worst way to find that out.
    throw new Error(
      `tableRef: no contract entry for "${name}". Either the sidecar is missing ` +
        `or the registry's \`table\` key is stale — registry.test.ts checks the ` +
        `schema, not the contract, so the two can disagree.`,
    );
  }
  return t;
}

/** Columns the user types, in the order the contract declares them. */
export const typed = (t: RefTable) => t.columns.filter((c) => c.csvHeader);
/** Columns the system fills in. Shown, never hidden — they are on the row too. */
export const filled = (t: RefTable) => t.columns.filter((c) => !c.csvHeader);

// ── "If you leave it blank" ────────────────────────────────────────────────

export type BlankSource =
  /** `blank: "reject"` — the parser refuses the row. */
  | "rejected"
  /** A named substitution in the contract, with its own provenance. */
  | "substitution"
  /** The engine's declared fallback for an absent value (I6). */
  | "engine-default"
  /** The engine's transform says what it does with the NULL it is handed. */
  | "engine-null"
  /** Nothing in the contract answers. A blind spot, printed as one. */
  | "unknown";

export type BlankAnswer = {
  source: BlankSource;
  text: string;
  /** How the substitution is marked, where the contract says (T2). */
  provenance: string | null;
  /** Where the reader would SEE it happen, where the contract says (T2). */
  visibleAs: string | null;
};

/**
 * What happens to an empty cell — resolved, never written.
 *
 * The order is not arbitrary. A rejected row never reaches a substitution, so
 * "rejected" wins; a declared substitution is a stronger statement than the
 * engine's own fallback because it names where the reader will SEE it; and the
 * engine's transform is last because it describes behaviour rather than
 * declaring a rule.
 */
export function blankBehaviour(c: RefColumn): BlankAnswer {
  if (c.blank === "reject" || c.required) {
    return {
      source: "rejected",
      text: "the row is rejected — this column is required and the file will not load without it",
      provenance: null,
      visibleAs: null,
    };
  }
  const s = c.substitutions[0];
  if (s) {
    return { source: "substitution", text: s.value, provenance: s.provenance, visibleAs: s.visibleAs };
  }
  if (c.engineMissingDefault) {
    return { source: "engine-default", text: c.engineMissingDefault, provenance: "default", visibleAs: null };
  }
  if (c.engineTransform && /null/i.test(c.engineTransform)) {
    return { source: "engine-null", text: c.engineTransform, provenance: null, visibleAs: null };
  }
  return { source: "unknown", text: "", provenance: null, visibleAs: null };
}

/** Columns an analysis wrote, from the contract's declared `computed_by`. */
export const computedColumns = (t: RefTable) => t.columns.filter((c) => c.computedBy);
/** Everything else on the row — what a person or a discovery run supplied. */
export const suppliedColumns = (t: RefTable) => t.columns.filter((c) => !c.computedBy);

// ── the file a reader actually downloads (§4 D110) ─────────────────────────

/**
 * The wizard dataset that loads a table, and the assets it offers.
 *
 * Two routes, in order, and the order is the point. A table whose sidecar
 * carries `ingest_dataset` answers for itself — that is the contract, and it is
 * the route `ingest-file` builds its own parser from, so the manual and the
 * uploader cannot disagree about which dataset a table belongs to. The four
 * tables outside the ingestion contract (§4 D56) have no such block and must
 * not be given one; their binding is declared beside `table` in the docs
 * registry, where `docsAssets.test.ts` checks it resolves and checks it never
 * shadows a contract answer.
 *
 * Returns `null` when neither route answers — a table with no upload at all —
 * so a page renders nothing rather than an empty download button.
 */
export function uploadAssetFor(table: RefTable): UploadAsset | null {
  const declared =
    table.ingestDataset?.wizardId ??
    ALL_PAGES.find((p) => p.section === 3 && p.table === table.table)?.wizardId ??
    null;
  if (!declared) return null;
  return UPLOAD_ASSETS.find((a) => a.id === declared) ?? null;
}
