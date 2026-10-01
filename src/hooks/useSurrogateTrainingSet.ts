// The surrogate's training set for a project, grouped by Validated Model and
// Graph Version (WP 10.8 · §4 D249) — one RPC over `surrogate_training_runs`,
// which runs as its caller. `refreshKey` re-reads it when a run finishes.
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { TrainingGroup } from "@/lib/sim/surrogateTraining";

export function useSurrogateTrainingSet(projectId: string | null | undefined, refreshKey?: unknown): TrainingGroup[] | null {
  const [groups, setGroups] = useState<TrainingGroup[] | null>(null);
  useEffect(() => {
    if (!projectId) {
      setGroups(null);
      return;
    }
    let alive = true;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;
    void sb
      .rpc("surrogate_training_summary", { p_project_id: projectId })
      .then(({ data, error }: { data: TrainingGroup[] | null; error: unknown }) => {
        // A database without `20261001000012` (the deploy window): no line at all.
        if (alive) setGroups(error || !Array.isArray(data) ? null : data);
      });
    return () => {
      alive = false;
    };
  }, [projectId, refreshKey]);
  return groups;
}
