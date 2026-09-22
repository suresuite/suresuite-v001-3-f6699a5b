/**
 * A2 — the value chain. §5.4, and `single-source` (I1) applied to a popover.
 *
 * ── THE QUESTION IT ANSWERS ────────────────────────────────────────────────
 *
 * §5.4's five artifacts escalate. A1 is a dot that says what KIND of number this
 * is; A2 is the next step a reader takes when the dot is not enough: *"where did
 * THIS number come from?"* §5.4 lists the hops it has to name — source file → row
 * → uploader → approver → unit → engine transform → substitutions → freshness →
 * what would change it — and the state column has read `missing` since the plan
 * was written.
 *
 * ── THE RULE THIS MODULE IS BUILT ON ──────────────────────────────────────
 *
 * **A HOP THAT CANNOT BE ANSWERED IS STATED, NEVER DROPPED.** Every step is a
 * `ChainStep` carrying either a value or `null` WITH a reason. A chain that
 * silently omits the uploader because the row predates provenance reads as a
 * complete chain that happens to be short — which is the over-claim T1 forbids,
 * and it is worse here than anywhere else, because the artifact's entire subject
 * is where a number came from.
 *
 * 8 577 rows in this database predate the landing path (§4 D88) and can never be
 * backfilled: inventing an `ingest_run_id` is the fabricated provenance
 * `declared-fallback` (I6) forbids. So "unknown" is the normal answer for a large
 * part of every project, and the difference between "unknown" and an empty popover
 * is the whole of T2 at this point of display.
 *
 * ── WHAT THIS MODULE DOES NOT COMPUTE ─────────────────────────────────────
 *
 * Three facts come in rather than being derived here, each because deriving them
 * would be a second implementation of something already authored once:
 *
 * 1. **The column → CSV header mapping** comes from `INGEST_DATASETS`, generated
 *    from `supabase/contract/*.contract.yaml`. `ingest_value_chain` deliberately
 *    returns `raw` and `parsed` whole for the same reason — the mapping has one
 *    owner (I1, and §4 D101 is what two owners looks like).
 * 2. **The engine hop** comes from `CHAINS` in `policy.generated.ts`, the same
 *    derivation `resolutionChains.test.ts` ratchets and the manual renders. A
 *    popover that described the engine transform in its own words would drift from
 *    the gate within a quarter, which is §4 D21.
 * 3. **The provenance state** is decided by the grid's resolver and handed in. The
 *    resolver's precedence is ORDER-DEPENDENT (`RESOLUTION_ORDER`); re-deciding it
 *    here would make two answers to "which rule won".
 */
import { INGEST_DATASETS } from "../../../supabase/functions/_shared/ingestSpec.generated";
import { CHAINS } from "@/components/docs/generated/policy.generated";
import type { Provenance } from "@/components/policies/policyGridUi";

/** One hop of the chain, or the stated absence of one. */
export interface ChainStep {
  /** Stable key — what the step is, in the vocabulary a reader can match. */
  key: string;
  label: string;
  /** What this hop says, or null when it cannot be answered. */
  value: string | null;
  /**
   * Why `value` is null. REQUIRED when it is: a blank hop with no reason is
   * indistinguishable from a hop that failed to load, and this artifact's whole
   * subject is the difference.
   */
  absentBecause?: string;
  /** Which part of the chain this belongs to, for grouping in the popover. */
  part: "source" | "people" | "value" | "engine" | "freshness" | "next";
}

/** What `ingest_value_chain` returns — one row, always. */
export interface ValueChainRow {
  has_provenance: boolean;
  project_id: string | null;
  target_table: string | null;
  source_kind: string | null;
  original_filename: string | null;
  content_sha256: string | null;
  byte_size: number | null;
  source_row_number: number | null;
  raw: Record<string, unknown> | null;
  parsed: Record<string, unknown> | null;
  findings: unknown[] | null;
  diff_state: string | null;
  uploaded_by_name: string | null;
  uploaded_by_email: string | null;
  received_at: string | null;
  promoted_by_name: string | null;
  promoted_by_email: string | null;
  promoted_at: string | null;
  run_status: string | null;
  later_uploads: number | null;
  latest_upload_at: string | null;
}

export interface ValueChainInput {
  /** The RPC's single row, or null when it has not been read yet. */
  row: ValueChainRow | null;
  /** The tier-2 table the value lives in — the dataset key in the contract. */
  dataset: string;
  /** The tier-2 column being explained. */
  column: string;
  /** The grid stage and field, for the engine hop. */
  stage: string;
  field: string;
  /** What the dot says about this cell. */
  provenance: Provenance;
  /** What the grid is showing, already formatted. */
  displayed: string;
  /**
   * The substitution behind this cell, when there is one (§4 D167).
   *
   * `provenance` says a fallback answered; this says WHICH, in a sentence the
   * resolver assembles from the registry's declared chain
   * (`resolveEffective.ts::substitutionNote`). Also carries the OTHER case the
   * dot cannot express: a cell the user can edit and the engine will not read,
   * because an item-master column outranks it.
   *
   * Optional, and an absent one is rendered as "no substitution — the value is
   * the value", never as a gap: a cell that resolves straight from data has
   * nothing missing here.
   */
  substitution?: string | null;
  /** True when the engine reads another field instead of this one (`shadowed_by`). */
  superseded?: boolean;
  /**
   * Whether this cell's value can come from an UPLOAD at all.
   *
   * Seven grid columns are master-backed (`ColSpec.master`) and therefore land
   * through the ingestion path, so their chain can reach a file. The rest resolve
   * from the policy bundle — override → default — and for those "which file did
   * this come from" has a correct answer that is not a file, and saying "unknown"
   * would be wrong rather than merely unhelpful. The caller knows which it is
   * because `sourceFor` told it.
   */
  uploadable: boolean;
}

export interface ValueChain {
  steps: ChainStep[];
  /**
   * True only when the chain reaches a FILE — a named file, a line in it and a
   * person. Anything less is a chain that stops somewhere, and the headline says
   * where rather than implying completeness.
   */
  tracesToAFile: boolean;
  headline: string;
}

const ts = (iso: string | null): string | null => {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toISOString().slice(0, 16).replace("T", " ") + " UTC";
};

const person = (name: string | null, email: string | null): string | null => {
  if (name && email) return `${name} <${email}>`;
  return name ?? email ?? null;
};

/**
 * What a cell held in the file, said in a way that distinguishes the three cases
 * a reader cares about. `''` is not "nothing": the file carried the column and
 * left it blank, which is what `blank: 'null'` acts on. An ABSENT key means the
 * file had no such column at all. §4 D7 is what happens when those are spelled
 * the same way.
 */
const cell = (bag: Record<string, unknown> | null, key: string): { text: string | null; why?: string } => {
  if (!bag) return { text: null, why: "no row was read" };
  if (!(key in bag)) return { text: null, why: `the file carried no \`${key}\` column` };
  const v = bag[key];
  if (v === null) return { text: null, why: "the file's cell was empty" };
  if (v === "") return { text: "(empty)", };
  return { text: String(v) };
};

/** What the reader can DO about this value — per provenance state, never generic. */
const REMEDY: Record<Provenance, string> = {
  data: "Re-upload this dataset to change it.",
  master: "Edit the item master, or upload a new master file.",
  contract: "Fill this cell in an upload — while it is empty the schema's declared meaning applies.",
  imputed: "Upload a value for this line; the average stops being used the moment one exists.",
  derived: "Upload the inbound/outbound rows this is computed from.",
  suggested: "Confirm or replace the suggestion — it is ranked from your volumes, not uploaded.",
  override: "Change or clear the override on this cell.",
  edited: "Save or discard the edit.",
  default: "Upload a value, or set an override — nothing you supplied is in play.",
};

/**
 * The tier-2 table and column a grid column's value lives in — or null when it
 * does not live in one.
 *
 * **ONLY `ColSpec.master` ANSWERS THIS TODAY, AND THAT IS A FINDING RATHER THAN A
 * SHORTCUT (§4 D125).** `columnSpecs.ts` declares grid field → MASTER column, and
 * `dataMap.ts` declares dataset column → ENGINE field. Nothing declares grid field
 * → LANE column: the supplier grid's `lead_time_days` is `inbound_logistics.lead_time`
 * times seven and `volume_per_day` is `volume` through a unit table, and both
 * conversions live inside `useStageRows`'s enrichment as expressions. So a chain for
 * a lane cell would have to guess its own first hop, and a popover that guessed
 * would be a second opinion about the data layer — `single-source` (I1) broken by
 * the artifact built to explain it. The map belongs in the contract, next to
 * `csv_header`, and A2 reaches the lane columns when it is there.
 */
export function sourceFor(col: {
  field: string;
  master?: { table: string; field: string };
}): { dataset: string; column: string } | null {
  return col.master ? { dataset: col.master.table, column: col.master.field } : null;
}

export function buildValueChain(input: ValueChainInput): ValueChain {
  const { row, dataset, column, stage, field, provenance, displayed } = input;
  const spec = INGEST_DATASETS[dataset];
  const col = spec?.columns.find((c) => c.column === column) ?? null;
  const norm = spec?.normalize.find((n) => n.column === column) ?? null;
  const chain = CHAINS.find((c) => c.stage === stage && c.field === field) ?? null;
  const steps: ChainStep[] = [];

  const push = (s: ChainStep) => steps.push(s);

  // ── source ───────────────────────────────────────────────────────────────
  if (!input.uploadable) {
    // NOT an absence. This cell's value comes from the policy bundle, and the
    // resolver's precedence is the chain — saying "unknown" here would report a
    // gap where the design is deliberate.
    push({
      key: "file", label: "Source file", value: null, part: "source",
      absentBecause:
        "this column is not uploaded — it resolves from the policy bundle (override → default), so it has no file",
    });
    push({
      key: "resolver", label: "Resolved by", part: "source",
      value: "the policy resolver, first matching branch wins (`RESOLUTION_ORDER`)",
    });
  } else if (!row) {
    push({
      key: "file", label: "Source file", value: null, part: "source",
      absentBecause: "the chain has not been read yet",
    });
  } else if (!row.has_provenance) {
    push({
      key: "file", label: "Source file", value: null, part: "source",
      // The exact sentence matters: this row's provenance is UNKNOWN, and saying
      // "none" would assert something nobody measured.
      absentBecause:
        "this row predates the ingestion path, so nothing recorded which file it came from — unknown, not none",
    });
  } else {
    push({
      key: "file", label: "Source file", part: "source",
      value: `${row.original_filename ?? "(unnamed)"}${
        row.content_sha256 ? ` · sha256 ${row.content_sha256.slice(0, 12)}…` : ""
      }${row.byte_size != null ? ` · ${row.byte_size} bytes` : ""}`,
    });
    push({
      key: "row", label: "Row in that file", part: "source",
      value: row.source_row_number != null ? `line ${row.source_row_number} (the header is line 1)` : null,
      absentBecause: row.source_row_number != null ? undefined : "the staged row records no line number",
    });
  }

  // ── people ───────────────────────────────────────────────────────────────
  const uploader = row?.has_provenance ? person(row.uploaded_by_name, row.uploaded_by_email) : null;
  push({
    key: "uploader", label: "Uploaded by", part: "people",
    value: uploader && row?.received_at ? `${uploader} · ${ts(row.received_at)}` : uploader,
    absentBecause: uploader
      ? undefined
      : row?.has_provenance
        ? "the upload recorded no user — the identity is client-asserted (§4 D28)"
        : "no upload is recorded for this row",
  });
  const approver = row?.has_provenance ? person(row.promoted_by_name, row.promoted_by_email) : null;
  push({
    key: "approver", label: "Promoted by", part: "people",
    value: approver && row?.promoted_at ? `${approver} · ${ts(row.promoted_at)}` : approver,
    absentBecause: approver
      ? undefined
      : row?.has_provenance
        ? "the run has not been applied, or recorded no approver"
        : "no promotion is recorded for this row",
  });

  // ── the value itself ─────────────────────────────────────────────────────
  const header = col?.csvHeader ?? column;
  const asReceived = cell(row?.has_provenance ? (row.raw ?? null) : null, header);
  push({
    key: "as_received", label: `The cell as received (\`${header}\`)`, part: "value",
    value: asReceived.text,
    absentBecause: asReceived.text === null
      ? (row?.has_provenance ? asReceived.why : "no file is recorded for this row")
      : undefined,
  });
  const established = cell(row?.has_provenance ? (row.parsed ?? null) : null, column);
  push({
    key: "established", label: "What validation established", part: "value",
    value: established.text,
    absentBecause: established.text === null
      ? (row?.has_provenance
          ? "no value was established for this cell — absent is not the same as empty (§4 D7)"
          : "nothing validated this row")
      : undefined,
  });
  push({
    key: "unit", label: "Unit", part: "value",
    value: norm
      ? `normalized at promotion to \`${norm.canonical}\` (${norm.conversion}); \`${norm.unitColumn}\` states it`
      : null,
    absentBecause: norm ? undefined : "this column carries no unit — it is a count, a ratio or a name",
  });
  push({
    key: "displayed", label: "Shown on the grid as", part: "value",
    value: `${displayed} · ${provenance}`,
  });

  // ── engine ───────────────────────────────────────────────────────────────
  // T2 — the substitution is visible at the POINT OF DISPLAY, and this popover
  // is that point. Rendered before the engine hop because "the run uses a
  // different number than this cell" outranks "here is what the engine does
  // with this cell" (§4 D167).
  push({
    key: "substitution",
    label: input.superseded ? "The run does NOT use this cell" : "How this value was arrived at",
    part: "engine",
    value: input.substitution ?? null,
    absentBecause: input.substitution
      ? undefined
      : "nothing stood in for this value — it is the number itself, not a substitute",
  });
  const engineHop = chain?.hops.find((h) => h.kind === "engine") ?? null;
  push({
    key: "engine", label: "In the engine", part: "engine",
    value: engineHop?.detail ?? null,
    absentBecause: engineHop
      ? undefined
      : chain
        ? `no engine hop — ${chain.breaks[0] ?? "the chain stops before the engine"}`
        : "no resolution chain is derived for this field",
  });
  if (chain?.breaks.length) {
    push({
      key: "break", label: "Known break", part: "engine",
      value: chain.breaks.join(" · "),
    });
  }

  // ── freshness ────────────────────────────────────────────────────────────
  const later = row?.later_uploads ?? null;
  push({
    key: "freshness", label: "Since then", part: "freshness",
    value:
      later == null
        ? null
        : later === 0
          ? "no later upload of this dataset"
          : `${later} later upload${later === 1 ? "" : "s"} of this dataset${
              row?.latest_upload_at ? ` · newest ${ts(row.latest_upload_at)}` : ""
            }${row?.has_provenance ? "" : " — and this row is not attributed to any of them"}`,
    absentBecause: later == null ? "the chain has not been read yet" : undefined,
  });

  // ── what would change it ─────────────────────────────────────────────────
  push({ key: "remedy", label: "What would change it", value: REMEDY[provenance], part: "next" });

  const tracesToAFile = !!row?.has_provenance && !!row.original_filename && row.source_row_number != null;
  const headline = tracesToAFile
    ? `Line ${row!.source_row_number} of ${row!.original_filename}`
    : row && !row.has_provenance
      ? "Provenance unknown — this row predates the ingestion path"
      : row
        ? "Partly traced — the chain stops before a file"
        : "Not read yet";

  return { steps, tracesToAFile, headline };
}
