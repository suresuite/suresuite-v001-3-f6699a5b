// The input-table reference block — WP 5.2b, PLAN.md §6.3 section 3.
//
// Components only. The functions and types they read live in `tableFacts.ts`;
// a module that exports both breaks fast refresh for everything importing it.
//
// ── WHY THIS FILE EXISTS ──────────────────────────────────────────────────
//
// Eleven pages document eleven tables and every one of them answers the same
// four questions about every column: what do I type here, what happens if I
// leave it blank, what does the software call it, and what does the engine do
// with it. Written eleven times, those answers drift eleven ways — which is
// exactly what `docBodies.tsx` was (§6.1 (b), D22). Written once and fed from
// the contract, they cannot.
//
// ── THE TWO RULES THIS FILE ENFORCES BY CONSTRUCTION ──────────────────────
//
// **Rule 1 — the name the reader typed leads (§6.1 (a), D21).** `csvHeader` is
// the heading. The database column and the engine field are TRANSLATION, and
// they live in a collapsed block underneath. A page whose heading reads
// `unit_price` where the file says `sell_price` is a failed page, and it is the
// specific failure that made a planner holding products.csv unable to find one
// of their own headers.
//
// **Rule 2 — every column says what a blank cell does, and names its source
// (§5.3 T1).** `blankBehaviour()` below resolves that from the contract through
// four ordered sources and returns WHICH one answered, so the page can show it.
// When none answers, it returns `unknown` and the page prints a blind-spot line
// (T3). It never guesses, and there is no fifth branch that invents a plausible
// sentence.
//
// Nothing here types a column name, a unit, a constraint, a default or an
// engine field. If a page needs a fact this file cannot reach, the fix is a
// sidecar edit and a regenerate — never a literal.

import { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { P, Key, Prose, Term, Callout, Section, DocLink } from "@/components/docs/prose";
import type { RefColumn, RefTable } from "@/components/docs/generated/reference.generated";
import {
  blankBehaviour,
  computedColumns,
  filled,
  suppliedColumns,
  typed,
  type BlankSource,
} from "@/components/docs/tableFacts";

const SOURCE_LABEL: Record<BlankSource, string> = {
  rejected: "required",
  substitution: "substituted",
  "engine-default": "engine default",
  "engine-null": "passed through",
  unknown: "not recorded",
};

function BlankLine({ c }: { c: RefColumn }) {
  const a = blankBehaviour(c);
  if (a.source === "unknown") {
    // T3 — publish the blind spot. A plausible sentence here would be a number
    // without a source, which is the one thing T1 forbids outright.
    return (
      <p className="mt-2 text-[13px] leading-relaxed">
        <span className="font-medium text-foreground">If you leave it blank:</span>{" "}
        <span className="text-destructive">not recorded in the contract.</span>{" "}
        <span className="text-muted-foreground">
          We are not going to guess on this page. Until the sidecar says, treat this column as one
          you should fill in.
        </span>
      </p>
    );
  }
  return (
    <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
      <span className="font-medium text-foreground">If you leave it blank:</span>{" "}
      <Prose text={a.text} />
      {a.provenance && (
        <span className="text-muted-foreground"> — marked as {a.provenance}</span>
      )}
      {a.visibleAs && (
        <span className="block text-[12px]">
          You see it here: <Prose text={a.visibleAs} />
        </span>
      )}
    </p>
  );
}

// ── the technical block ────────────────────────────────────────────────────

/**
 * The translation layer, collapsed.
 *
 * A native `<details>`: it works with JavaScript off, it is keyboard-operable
 * without a single line of ours, and it prints expanded. §6.1 Rule 3 — plain
 * language first, notation last, in a collapsed block.
 */
function TechnicalDetails({ c }: { c: RefColumn }) {
  const rows: { k: string; v: ReactNode }[] = [];
  if (c.csvHeader && c.csvHeader !== c.name) rows.push({ k: "Stored as", v: <Term>{c.name}</Term> });
  rows.push({ k: "Type", v: <Term>{c.type}</Term> });
  if (c.unit) rows.push({ k: "Unit", v: <Prose text={c.unit} /> });
  if (c.unitColumn) rows.push({ k: "Unit named by", v: <Term>{c.unitColumn}</Term> });
  if (c.normalizeAtPromotion)
    rows.push({
      k: "Converted on promotion",
      v: (
        <>
          {c.normalizeAtPromotion.conversion} → <Term>{c.normalizeAtPromotion.canonical}</Term>
        </>
      ),
    });
  if (c.validate) rows.push({ k: "Checked", v: <Prose text={c.validate} /> });
  if (c.engineField) rows.push({ k: "Engine field", v: <Prose text={c.engineField} /> });
  if (c.engineTransform) rows.push({ k: "Engine does", v: <Prose text={c.engineTransform} /> });
  if (c.engineChain) rows.push({ k: "Engine fallback chain", v: <Prose text={c.engineChain} /> });
  if (c.references)
    rows.push({
      k: "Points at",
      v: (
        <>
          <Term>{c.references.table}</Term>
          {c.references.onDelete ? ` (on delete: ${c.references.onDelete.toLowerCase()})` : null}
        </>
      ),
    });
  if (!rows.length) return null;

  return (
    <details className="mt-2 rounded-sm border border-border bg-muted/30 px-3 py-2">
      <summary className="cursor-pointer text-[12px] font-medium text-muted-foreground">
        Technical details
      </summary>
      <dl className="mt-2 space-y-1">
        {rows.map((r) => (
          <div key={r.k} className="grid grid-cols-1 gap-0.5 md:grid-cols-[11rem_minmax(0,1fr)] md:gap-3">
            <dt className="text-[12px] text-muted-foreground">{r.k}</dt>
            <dd className="min-w-0 break-words text-[12px] text-foreground">{r.v}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

// ── one column ─────────────────────────────────────────────────────────────

/**
 * One column, led by the name the reader typed.
 *
 * The anchor is `#<csvHeader>` where there is one, so the upload wizard and a
 * validation finding can deep-link a reader to the exact header they got wrong
 * (§6.4). Where there is no CSV header the anchor is the column name, because
 * that is then the only name the reader has.
 */
export function Column({ c, note }: { c: RefColumn; note?: ReactNode }) {
  const lead = c.csvHeader ?? c.name;
  return (
    <div id={lead} className="scroll-mt-20 border-t border-border py-4 first:border-t-0">
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="font-mono text-sm font-semibold text-foreground">{lead}</span>
        {c.unit && (
          <span className="text-[12px] text-muted-foreground">
            in <Prose text={c.unit} />
          </span>
        )}
        <Badge
          variant={blankBehaviour(c).source === "rejected" ? "secondary" : "outline"}
          className="text-[10px]"
        >
          {SOURCE_LABEL[blankBehaviour(c).source]}
        </Badge>
      </div>
      <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
        <Prose text={c.meaning} />
      </p>
      {note && <div className="mt-2 text-[13px] leading-relaxed text-foreground">{note}</div>}
      <BlankLine c={c} />
      <TechnicalDetails c={c} />
    </div>
  );
}

/**
 * The columns you type, in contract order.
 *
 * `notes` lets a page add ONE sentence of context to a specific column — the
 * thing a generated `meaning` cannot carry because it is about the page's own
 * story rather than about the column. The column itself still comes from the
 * contract; the note sits beside it and is clearly the page's voice.
 */
export function TypedColumns({
  table,
  notes = {},
}: {
  table: RefTable;
  notes?: Record<string, ReactNode>;
}) {
  const cols = typed(table);
  return (
    <div className="rounded-sm border border-border bg-card px-4 shadow-xs">
      {cols.map((c) => (
        <Column key={c.name} c={c} note={notes[c.csvHeader ?? c.name]} />
      ))}
    </div>
  );
}

/**
 * The columns the system sets, listed rather than hidden.
 *
 * They are on the reader's row whether or not they typed them, and several of
 * them — `ingest_run_id`, `source_row_id` — are the reason a value can be
 * traced back to the line of the file it came from. A reference that showed
 * only the typed columns would be describing half a row.
 */
export function FilledColumns({ table }: { table: RefTable }) {
  const cols = filled(table);
  if (!cols.length) return null;
  return (
    <details className="rounded-sm border border-border bg-card p-4 shadow-xs">
      <summary className="cursor-pointer text-sm font-medium text-foreground">
        {cols.length} more columns the system fills in
      </summary>
      <div className="mt-3 space-y-3">
        {cols.map((c) => (
          <div key={c.name}>
            <span className="font-mono text-[12px] font-medium text-foreground">{c.name}</span>
            <p className="text-[13px] leading-relaxed text-muted-foreground">
              <Prose text={c.meaning} />
            </p>
          </div>
        ))}
      </div>
    </details>
  );
}

// ── the table's own facts ──────────────────────────────────────────────────

const ROUTE_FOR_WIZARD: Record<string, string> = {
  // Where the reader goes to do this. Not a fact about the data, so not in the
  // contract — a route is the app's, and `App.tsx` is its authority.
  inbound_logistics: "/project-manager",
  outbound_logistics: "/project-manager",
  bom_single_level: "/project-manager",
  bom_multi_level: "/project-manager",
  item_master_materials: "/project-manager",
  item_master_products: "/project-manager",
  item_master_suppliers: "/project-manager",
};

/**
 * How this table is loaded, what identifies a row, and who may write it.
 *
 * `ingestDataset` being null does NOT mean the reader cannot upload the table.
 * Three of section 3's eleven — the node list and the two deep-tier files —
 * have an upload tab and a template and still land nothing: they reach their
 * tables through bulk RPCs rather than through the ingestion contract's
 * `ingest_land_file` (§4 D56). "No upload" and "an upload that skips staging"
 * are different facts and a reader deserves the second one, so the page passes
 * `instead` and says what its own route actually does.
 */
export function HowItLoads({
  table,
  instead,
}: {
  table: RefTable;
  /** What happens instead, for a table with no contract dataset. Required there. */
  instead?: ReactNode;
}) {
  const d = table.ingestDataset;
  const key = table.naturalKeyIntended ?? [];
  const enforced =
    key.length > 0 && key.every((k) => table.naturalKey.includes(k)) && table.naturalKey.length > 1;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary">Tier {table.tier}</Badge>
        <span className="text-xs text-muted-foreground">{table.tierName}</span>
      </div>
      <P>
        <Prose text={table.grain} />
      </P>

      {d ? (
        <Key>
          Uploaded as <Term>{d.wizardId}</Term>
          {ROUTE_FOR_WIZARD[d.wizardId] ? ` from ${ROUTE_FOR_WIZARD[d.wizardId]}` : ""}.{" "}
          {d.serverSet.length > 0 && (
            <>
              You never type{" "}
              {d.serverSet.map((s, i) => (
                <span key={s}>
                  {i > 0 && " or "}
                  <Term>{s}</Term>
                </span>
              ))}{" "}
              — the server sets {d.serverSet.length === 1 ? "it" : "them"} from the project you are
              in, so a file cannot land in somebody else's project by naming it.
            </>
          )}
        </Key>
      ) : (
        <Callout tone="limit" title="This table is outside the ingestion contract">
          <p>
            Nothing lands it in staging, nothing diffs it against what is already there, and
            nothing promotes it under review — the four steps{" "}
            <DocLink to="how-your-data-flows">How your data flows</DocLink> describes are skipped.
          </p>
          {instead}
        </Callout>
      )}

      {key.length > 0 && (
        <P>
          A row is identified by{" "}
          {key.map((k, i) => (
            <span key={k}>
              {i > 0 && " + "}
              <Term>{k}</Term>
            </span>
          ))}
          .{" "}
          {enforced
            ? "The database enforces it, so uploading the same file twice updates those rows rather than doubling them."
            : "The database does NOT enforce it yet, so uploading the same file twice adds the rows twice."}
        </P>
      )}

      {table.governance && (
        <P>
          Writing to it needs project role{" "}
          <Term>{table.governance.minProjectRole ?? "unspecified"}</Term> or above
          {table.governance.audited
            ? ", and every write records who made it."
            : ", and writes to it are NOT recorded in the audit log."}{" "}
          <DocLink to="who-can-see-your-data">Who can see your data</DocLink> is the honest version
          of what that role check does and does not buy you.
        </P>
      )}
    </div>
  );
}

/** The CHECKs the database enforces, verbatim. Never paraphrased. */
export function DatabaseRules({ table }: { table: RefTable }) {
  if (!table.checks.length) return null;
  return (
    <Section id="database-rules" title="Rules the database itself enforces">
      <P>
        These run on every write, from any source. A row that fails one is refused — not corrected,
        not warned about.
      </P>
      <ul className="space-y-1.5 rounded-sm border border-border bg-card p-4 shadow-xs">
        {table.checks.map((c) => (
          <li key={c.name} className="break-words font-mono text-[11px] leading-relaxed text-muted-foreground">
            {c.definition}
          </li>
        ))}
      </ul>
    </Section>
  );
}

/** The header row of a template file, built from the contract's own order. */
export function TemplateHeaders({ table }: { table: RefTable }) {
  const cols = typed(table);
  if (!cols.length) return null;
  const required = cols.filter((c) => blankBehaviour(c).source === "rejected");
  return (
    <div className="space-y-2">
      <div className="overflow-x-auto rounded-sm border border-border bg-card p-3 shadow-xs">
        <code className="whitespace-pre font-mono text-[12px] text-foreground">
          {cols.map((c) => c.csvHeader).join(",")}
        </code>
      </div>
      <p className="text-xs text-muted-foreground">
        {cols.length} columns, of which {required.length}{" "}
        {required.length === 1 ? "is required" : "are required"}:{" "}
        {required.map((c) => c.csvHeader).join(", ") || "none"}. Column order does not matter — the
        parser reads the header row, not the position.
      </p>
    </div>
  );
}

// ── tables that are BOTH halves at once (§4 D56) ───────────────────────────

/**
 * One column of a table with no CSV header — the name IS the database name.
 *
 * Rule 1 (lead with the name the reader typed) is satisfied vacuously here and
 * it is worth saying why rather than quietly doing something different: these
 * four tables are outside the ingestion contract, so no header-to-column
 * mapping exists for them. The reader sees the database name in their export
 * and in the grid, so the database name is the name they have.
 */
function PlainColumn({ c }: { c: RefColumn }) {
  return (
    <div id={c.name} className="scroll-mt-20 border-t border-border py-3 first:border-t-0">
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="font-mono text-[13px] font-semibold text-foreground">{c.name}</span>
        <span className="text-[11px] text-muted-foreground">{c.type}</span>
        {c.computedBy && (
          <Badge variant="outline" className="text-[10px]">
            written by {c.computedBy}
          </Badge>
        )}
      </div>
      <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
        <Prose text={c.meaning} />
      </p>
      {!c.computedBy && (
        // These tables declare no ingestion rule, so there is no blank-cell
        // behaviour to resolve — the four sources blankBehaviour() reads are
        // all about a CSV that does not exist here. Saying "not recorded" would
        // report the absence of a question as the absence of an answer.
        <p className="mt-1 text-[12px] text-muted-foreground">
          Blank means blank: nothing substitutes a value for this column, because nothing validates
          it on the way in.
        </p>
      )}
    </div>
  );
}

/**
 * The two halves of a table that holds inputs and outputs in the same row.
 *
 * `network_nodes` and `node_list` each carry columns somebody uploaded beside
 * columns an analysis wrote, which is why "what tier is this table" had no
 * answer for three work packages. The split is rendered from the contract's
 * `computed_by`, so the page cannot get it wrong and cannot go stale.
 */
export function SuppliedAndComputed({ table }: { table: RefTable }) {
  const supplied = suppliedColumns(table);
  const written = computedColumns(table);
  return (
    <div className="space-y-4">
      <div className="rounded-sm border border-border bg-card px-4 shadow-xs">
        {supplied.map((c) => (
          <PlainColumn key={c.name} c={c} />
        ))}
      </div>
      {written.length > 0 && (
        <>
          <Callout title={`${written.length} of these columns are not yours`}>
            <p>
              They are written by an analysis, onto the same row as the data you supplied. Each one
              below names the analyzer that writes it. Change your data and they do not change until
              that analysis runs again —{" "}
              <DocLink to="dataset-versions">Dataset Versions</DocLink> is how you tell whether what
              you are looking at was computed from what you are holding.
            </p>
          </Callout>
          <div className="rounded-sm border border-border bg-card px-4 shadow-xs">
            {written.map((c) => (
              <PlainColumn key={c.name} c={c} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
