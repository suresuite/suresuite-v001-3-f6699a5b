// What the organization's plan leaves the signed-in member on this project —
// the pool and the role share, each with what it has used (WP 10.7 · §4 D247).
// One RPC, `get_my_capacity`, which reads the same state `create_simulation_run`
// admits against, so the Run card and the dispatcher cannot disagree about it.
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { CapacityState } from "@/lib/sim/labModel";

/** `refreshKey` re-reads it (a run queued or finished moves the figures). */
export function useMyCapacity(
  projectId: string | null | undefined,
  userId: string | null | undefined,
  refreshKey?: unknown,
): CapacityState | null {
  const [state, setState] = useState<CapacityState | null>(null);
  useEffect(() => {
    if (!projectId) {
      setState(null);
      return;
    }
    let alive = true;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;
    void sb
      .rpc("get_my_capacity", { p_project_id: projectId, _actor_user_id: userId ?? null })
      .then(({ data, error }: { data: CapacityState | null; error: unknown }) => {
        // A database without `20261001000012` (the deploy window): no figure,
        // and the card says the plan could not be read rather than inventing one.
        if (alive) setState(error ? null : data);
      });
    return () => {
      alive = false;
    };
  }, [projectId, userId, refreshKey]);
  return state;
}
