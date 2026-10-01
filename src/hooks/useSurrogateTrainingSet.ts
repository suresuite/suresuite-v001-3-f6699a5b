// The size of a project's surrogate training set (WP 10.8 · §4 D249) — one RPC,
// `surrogate_training_totals`, over `surrogate_training_runs`, which runs as its
// caller. Distinct counts, so a run several models cite counts once (§4 D254).
// `refreshKey` re-reads it when a run finishes.
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { TrainingTotals } from "@/lib/sim/surrogateTraining";

export function useSurrogateTrainingSet(projectId: string | null | undefined, refreshKey?: unknown): TrainingTotals | null {
  const [totals, setTotals] = useState<TrainingTotals | null>(null);
  useEffect(() => {
    if (!projectId) {
      setTotals(null);
      return;
    }
    let alive = true;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;
    void sb
      .rpc("surrogate_training_totals", { p_project_id: projectId })
      .then(({ data, error }: { data: TrainingTotals | null; error: unknown }) => {
        // A database without `20261001000015` (the deploy window): no line at all.
        if (alive) setTotals(error || !data || typeof data !== "object" ? null : data);
      });
    return () => {
      alive = false;
    };
  }, [projectId, refreshKey]);
  return totals;
}
