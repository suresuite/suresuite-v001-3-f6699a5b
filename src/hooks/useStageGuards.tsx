// The 4-step guardrail behind PolicySetupBar's step track.
//
// Loads the lines of every setup stage once at the page level and derives —
// per render, never stored — how many lines each step still needs input on.
// The active stage's rows are handed straight to the grid (and to stage 4's
// verification), so the page fetches each stage exactly once.
import { useMemo } from "react";
import { useStageRows, type StageRow } from "@/hooks/useStageRows";
import { effectivePolicy, type OverrideRow } from "@/lib/policies/resolve";
import { flattenBundle } from "@/lib/policies/columnSpecs";
import { stageNeedsCount } from "@/lib/policies/stageGuards";
import type { StageGuard } from "@/components/policies/PolicySetupBar";
import type { PolicyBundle } from "@/lib/policies/schemas";
import type { StageKey } from "@/lib/policies/stages";

export interface StageRowsQuery {
  rows: StageRow[];
  loading: boolean;
  fallback: boolean;
  /** D20: lane tables whose read hit `LANE_ROW_CEILING`. The stage renders it
   *  (`LaneTruncationNotice`) — these rows are a slice when it is non-empty. */
  truncated: string[];
  reload: () => void;
}

interface Args {
  projectId: string | null | undefined;
  plantName: string | null | undefined;
  defaults: PolicyBundle;
  overrides: OverrideRow[];
  /** Stage 4 evidence: a run has completed replications and a warm-up cut. */
  evidence?: boolean;
}

export function useStageGuards({ projectId, plantName, defaults, overrides, evidence }: Args): {
  guards: StageGuard[];
  rowsByStage: Record<Exclude<StageKey, "run_validate">, StageRowsQuery>;
} {
  const supplier = useStageRows({ projectId, plantName, stage: "supplier" });
  const plant = useStageRows({ projectId, plantName, stage: "plant" });
  const customer = useStageRows({ projectId, plantName, stage: "customer" });

  // Saved-state resolver — project data first, then the effective bundle
  // (override → default), mirroring the grid minus its unsaved drafts.
  const resolve = useMemo(() => {
    const cache = new Map<string, Record<string, unknown>>();
    return (row: Record<string, unknown>, field: string): unknown => {
      if (row[field] !== undefined && row[field] !== null) return row[field];
      const key = String(row.key);
      let flat = cache.get(key);
      if (!flat) {
        flat = flattenBundle(effectivePolicy(defaults, overrides, "node", key));
        cache.set(key, flat);
      }
      return flat[field];
    };
  }, [defaults, overrides]);

  const guards = useMemo<StageGuard[]>(() => {
    const supplierNeeds = stageNeedsCount("supplier", supplier.rows, resolve);
    const plantNeeds = stageNeedsCount("plant", plant.rows, resolve);
    const customerNeeds = stageNeedsCount("customer", customer.rows, resolve);
    return [
      { id: "supplier", title: "Supplier", total: supplier.rows.length, needs: supplierNeeds },
      { id: "plant", title: "Focal plant", total: plant.rows.length, needs: plantNeeds },
      { id: "customer", title: "Customer", total: customer.rows.length, needs: customerNeeds },
      {
        id: "run_validate",
        title: "Run & validate",
        total: 0,
        needs: supplierNeeds + plantNeeds + customerNeeds,
        evidence: !!evidence,
      },
    ];
  }, [supplier.rows, plant.rows, customer.rows, resolve, evidence]);

  return { guards, rowsByStage: { supplier, plant, customer } };
}
