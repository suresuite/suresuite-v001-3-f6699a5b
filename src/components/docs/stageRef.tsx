// The policy-grid reference block — WP 5.2c, PLAN.md §6.3 section 5.
//
// ── WHERE EVERY FACT ON THESE PAGES COMES FROM ────────────────────────────
//
// Three sources, all live, none retyped:
//
//   `STAGE_TABLE_SPEC`  the grid's own column list, imported from the module
//                       the grid renders. Not a copy — the same object. A
//                       column added to the grid appears on its page with no
//                       edit here, and a column removed cannot linger.
//   `CHAINS`            generated from `resolutionChains.ts` by the data
//                       contract, so the manual and `resolutionChains.test.ts`
//                       are the same derivation (§4 D90, D91).
//   `fieldEngineStatus` the product's own answer to "does the engine read
//                       this", including the `stored-only` state D92 exists
//                       because of.
//
// ── THE POINT OF THE PAGE, AND IT IS NOT THE COLUMN LIST ──────────────────
//
// Components only; the functions they read live in `stageFacts.ts`.
//
// Eleven of the grid's 38 fields change nothing when you edit them. Some are
// read only by a frozen engine, some the engine recomputes and ignores, one is
// read by nothing at all. A stage page that listed the columns and stopped
// would be describing a screen; what a user needs is which of these cells is
// worth their afternoon. So a broken chain is rendered AS PROMINENTLY as the
// column it belongs to, with the shape of the break and the evidence behind it.

import { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { P, Key, Prose, Term, Callout } from "@/components/docs/prose";
import type { PolicyChain, BreakClass } from "@/components/docs/generated/policy.generated";
import { chainFor, stageColumns } from "@/components/docs/stageFacts";
import type { ColSpec } from "@/lib/policies/columnSpecs";
import { fieldEngineStatus } from "@/lib/policies/fieldStatus";
import type { StageKey } from "@/lib/policies/stages";

/** One line a user can act on, per break shape. */
const BREAK_HEADLINE: Record<BreakClass, string> = {
  "legacy-only": "Editing this changes nothing in the strategic engine",
  "app-routing": "This steers the app, not the simulation",
  overridden: "The engine works this out itself and ignores what you type",
  "no-target": "There is nowhere for this value to be stored",
  unread: "Nothing reads this value at all",
};

function BreakNote({ chain }: { chain: PolicyChain }) {
  if (!chain.breakClass) return null;
  return (
    <div className="mt-2 rounded-sm border border-l-4 border-border border-l-destructive bg-card p-3">
      <div className="text-[12px] font-semibold text-foreground">
        {BREAK_HEADLINE[chain.breakClass]}
      </div>
      {chain.breaks.map((b, i) => (
        <p key={i} className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
          <Prose text={b} />
        </p>
      ))}
    </div>
  );
}

/** The hops, collapsed — plain language first, notation last (§6.1 Rule 3). */
function Hops({ chain }: { chain: PolicyChain }) {
  if (!chain.hops.length) return null;
  return (
    <details className="mt-2 rounded-sm border border-border bg-muted/30 px-3 py-2">
      <summary className="cursor-pointer text-[12px] font-medium text-muted-foreground">
        Where this value travels
      </summary>
      <ol className="mt-2 space-y-1.5">
        {chain.hops.map((h, i) => (
          <li key={i} className="text-[12px] leading-relaxed text-muted-foreground">
            <span className="mr-2 font-mono text-[10px] uppercase tracking-wider text-foreground">
              {h.kind}
            </span>
            <Prose text={h.detail} />
            {h.evidence && (
              <span className="ml-1 font-mono text-[10.5px] opacity-70">({h.evidence})</span>
            )}
          </li>
        ))}
      </ol>
    </details>
  );
}

/**
 * One grid column.
 *
 * The heading is the grid's own `label` — the words on screen — with the stored
 * field name beneath it. Section 3's rule applied to a screen rather than a
 * file: lead with what the reader is looking at.
 */
export function GridColumn({ stage, col, note }: { stage: StageKey; col: ColSpec; note?: ReactNode }) {
  const chain = chainFor(stage, col.field);
  const status = fieldEngineStatus(col.family, col.field);

  return (
    <div id={`${stage}.${col.field}`} className="scroll-mt-20 border-t border-border py-4 first:border-t-0">
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="text-sm font-semibold text-foreground">{col.label}</span>
        <span className="font-mono text-[11px] text-muted-foreground">{col.field}</span>
        <Badge variant="outline" className="text-[10px]">
          {col.family}
        </Badge>
        {status.state === "reaches-engine" && (
          <Badge variant="secondary" className="text-[10px]">
            reaches the engine
          </Badge>
        )}
        {status.state === "pending" && (
          <Badge variant="outline" className="text-[10px]">
            waiting on {status.milestone}
          </Badge>
        )}
        {status.state === "stored-only" && (
          <Badge variant="outline" className="text-[10px]">
            stored only
          </Badge>
        )}
        {col.readOnly && (
          <Badge variant="outline" className="text-[10px]">
            read-only
          </Badge>
        )}
      </div>

      {note && <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{note}</p>}

      {col.master && (
        <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
          Backed by the item master: the value lives in <Term>{col.master.table}</Term>, and editing
          the cell writes there rather than saving a policy override.
          {col.master.nullMeans && (
            <>
              {" "}
              An empty one is not missing — it means{" "}
              <Term>{col.master.nullMeans.token}</Term> ({col.master.nullMeans.title}).
            </>
          )}
        </p>
      )}

      {col.defaultWhenMissing !== undefined && (
        <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
          <span className="font-medium text-foreground">If you leave it blank:</span> the cell shows{" "}
          <Term>{String(col.defaultWhenMissing)}</Term> — a declared default, not a value from your
          data.
        </p>
      )}

      {chain && <BreakNote chain={chain} />}
      {chain && <Hops chain={chain} />}
    </div>
  );
}

/** Every column of a stage, in the order the grid declares them. */
export function StageColumns({
  stage,
  notes = {},
}: {
  stage: StageKey;
  notes?: Record<string, ReactNode>;
}) {
  const cols = stageColumns(stage);
  return (
    <div className="rounded-sm border border-border bg-card px-4 shadow-xs">
      {cols.map((c) => (
        <GridColumn key={c.field} stage={stage} col={c} note={notes[c.field]} />
      ))}
    </div>
  );
}

/**
 * The stage's headline, counted rather than stated.
 *
 * "Three of this stage's fourteen columns change nothing" is a sentence that
 * has to be recomputed every time the grid or the engine moves, so it is.
 */
export function StageSummary({ stage }: { stage: StageKey }) {
  const cols = stageColumns(stage);
  const broken = cols.filter((c) => chainFor(stage, c.field)?.breaks.length);
  const families = [...new Set(cols.map((c) => c.family))];

  return (
    <>
      <Key>
        {cols.length} columns, across {families.length}{" "}
        {families.length === 1 ? "policy family" : "policy families"} —{" "}
        {families.map((f, i) => (
          <span key={f}>
            {i > 0 && ", "}
            <Term>{f}</Term>
          </span>
        ))}
        .
      </Key>
      {broken.length > 0 ? (
        <Callout tone="limit" title={`${broken.length} of them do not reach the simulation`}>
          <p>
            Each is marked below with what is actually happening to it. They are not broken
            settings you should avoid — they are settings that are stored, versioned and shown back
            to you while the run ignores them, which is a different and more misleading thing. We
            would rather say so here than let you discover it by changing one and seeing no
            difference.
          </p>
        </Callout>
      ) : (
        <P>Every column on this stage reaches the simulation.</P>
      )}
    </>
  );
}
