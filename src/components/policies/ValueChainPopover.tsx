/**
 * A2 — the value-chain popover. §5.4, and T1/T2 at the point of display.
 *
 * ── WHY A POPOVER AND NOT A TOOLTIP ───────────────────────────────────────
 *
 * `NumCell` has carried a `title` since WP 6.2 — a hover string assembled from the
 * resolved provenance — and its own comment says what that was: *"A2's popover
 * replaces the hover with something a person can read; until it does, this is the
 * answer."* A `title` cannot be read on a phone, cannot be copied, cannot hold a
 * filename beside a line number beside a person, and disappears the moment the
 * pointer moves. §5.4 asks for nine hops. Nine hops is a panel.
 *
 * ── THE RULE IT RENDERS ───────────────────────────────────────────────────
 *
 * `buildValueChain` returns every hop, including the ones that cannot be answered,
 * each with a stated reason. **This component renders the absences as prominently
 * as the values**, because the most common chain in this database is a short one:
 * 8 577 rows predate the ingestion path (§4 D88) and their provenance is UNKNOWN,
 * which is not the same statement as "there was none" and must not be shown as a
 * blank line. A popover that listed four facts and silently skipped five would read
 * as a complete chain, which is the over-claim T1 forbids.
 *
 * ── THE READ ──────────────────────────────────────────────────────────────
 *
 * One RPC, `ingest_value_chain`, called on OPEN rather than per render: the grid
 * has hundreds of cells and a chain is a question a person asks about one of them.
 * The RPC returns exactly one row in both of its modes, so a missing chain is
 * `has_provenance = false` and never an empty result — the component therefore has
 * no "nothing to show" state to get wrong.
 */
import React from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { supabase } from "@/integrations/supabase/client";
import { buildValueChain, type ChainStep, type ValueChainInput, type ValueChainRow } from "@/lib/trust/valueChain";

const PART_LABEL: Record<ChainStep["part"], string> = {
  source: "Where it came from",
  people: "Who touched it",
  value: "What it says",
  engine: "What the model does with it",
  freshness: "Since then",
  next: "What would change it",
};

const ORDER: ChainStep["part"][] = ["source", "people", "value", "engine", "freshness", "next"];

/**
 * The RPC surface this component needs, narrowed rather than cast to `any`.
 *
 * `ingest_value_chain` is not in the generated Supabase types — those are produced
 * from the hosted schema and this function lands with the branch's migration — so
 * the call needs a type from somewhere. Most of this repository writes
 * `(supabase as any).rpc(...)`, which eslint counts and which turns every argument
 * name into a string nobody checks. Declaring the shape here costs three lines and
 * keeps the arguments and the return typed at the one call site that matters.
 */
type ChainRpc = {
  rpc: (
    fn: "ingest_value_chain",
    args: {
      p_user_id: string;
      p_source_row_id: string | null;
      p_project_id: string | null;
      p_target_table: string | null;
    },
  ) => Promise<{ data: ValueChainRow[] | ValueChainRow | null; error: { message?: string } | null }>;
};

export interface ValueChainTarget {
  /**
   * The tier-2 table the value lives in — also the contract's dataset key — or
   * null when this column is not uploaded at all and resolves from the policy
   * bundle. `sourceFor` decides which, and the difference changes what the chain
   * SAYS rather than how much of it is missing.
   */
  dataset: string | null;
  column: string;
  stage: string;
  field: string;
  /** The staged row this tier-2 row was promoted from, when there is one. */
  sourceRowId: string | null;
  projectId: string | null;
}

/**
 * Reads the chain once per open. `null` while in flight — `buildValueChain`
 * renders that as "not read yet" rather than as an absence of provenance, because
 * those are different things and a reader should not be told the second while the
 * first is true.
 */
function useValueChainRow(target: ValueChainTarget | null, open: boolean, userId: string | null) {
  const [row, setRow] = React.useState<ValueChainRow | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => {
    // No dataset means nothing landed this value, so there is no chain to read —
    // `buildValueChain` renders the bundle-resolution chain from the input alone.
    if (!open || !target || !userId || !target.dataset) return;
    let cancelled = false;
    setRow(null);
    setError(null);
    (async () => {
      const { data, error: err } = await (supabase as unknown as ChainRpc).rpc("ingest_value_chain", {
        p_user_id: userId,
        p_source_row_id: target.sourceRowId,
        p_project_id: target.projectId,
        p_target_table: target.sourceRowId ? null : target.dataset,
        // Mode 1 when the row names its staged row; mode 2 otherwise, which still
        // answers the freshness half.
      });
      if (cancelled) return;
      if (err) {
        // A failed read is SAID, not swallowed into "unknown provenance" — those
        // are different facts and conflating them would make every outage look
        // like missing lineage.
        setError(err.message ?? String(err));
        return;
      }
      setRow((Array.isArray(data) ? data[0] : data) ?? null);
    })();
    return () => { cancelled = true; };
  }, [open, target, userId]);
  return { row, error };
}

export function ValueChainPopover({
  target,
  provenance,
  displayed,
  substitution,
  superseded,
  userId,
  children,
}: {
  target: ValueChainTarget;
  provenance: ValueChainInput["provenance"];
  displayed: string;
  /** The sentence naming the substitution behind this cell, when there is one
   *  (`resolveEffective.ts::substitutionNote`) — §4 D165. */
  substitution?: string | null;
  /** True when an item-master column outranks this cell and the run ignores it. */
  superseded?: boolean;
  userId: string | null;
  children: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(false);
  const { row, error } = useValueChainRow(target, open, userId);
  const chain = buildValueChain({
    row,
    uploadable: target.dataset !== null,
    dataset: target.dataset ?? "",
    column: target.column,
    stage: target.stage,
    field: target.field,
    provenance,
    displayed,
    substitution,
    superseded,
  });

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align="end" className="w-[340px] p-0 text-[11px]">
        <div className="border-b border-[--zinc-border] px-3 py-2">
          <div className="text-[12px] font-medium">{chain.headline}</div>
          <div className="text-[10.5px] text-muted-foreground">
            {target.dataset ? `${target.dataset}.${target.column}` : `${target.stage} grid · ${target.field}`}
          </div>
        </div>
        {error && (
          <div className="border-b border-[--zinc-border] bg-amber-500/10 px-3 py-2 text-[10.5px]">
            The chain could not be read: {error}. This is a failed read, not an absence of
            provenance.
          </div>
        )}
        <div className="max-h-[60vh] overflow-y-auto">
          {ORDER.map((part) => {
            const steps = chain.steps.filter((s) => s.part === part);
            if (steps.length === 0) return null;
            return (
              <div key={part} className="border-b border-[--zinc-border] px-3 py-2 last:border-b-0">
                <div className="mb-1 text-[9.5px] uppercase tracking-wide text-muted-foreground">
                  {PART_LABEL[part]}
                </div>
                {steps.map((s) => (
                  <div key={s.key} className="mb-1 last:mb-0">
                    <div className="text-[10px] text-muted-foreground">{s.label}</div>
                    {s.value !== null ? (
                      <div className="font-mono text-[10.5px] break-words">{s.value}</div>
                    ) : (
                      /* An absence is rendered, italic and reasoned. A blank line
                         here would read as a complete chain that happens to be
                         short, which is exactly the over-claim T1 forbids. */
                      <div className="text-[10.5px] italic text-muted-foreground break-words">
                        not known — {s.absentBecause ?? "no reason recorded, which is itself a defect"}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
