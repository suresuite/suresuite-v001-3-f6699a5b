// The snapshot, simulation-inputs and policy version NUMBERS a Validated Model names
// (WP 10.3 / 10.5; simulation inputs since WP 11.3). Shared by the summary card
// and the Lab's Model step.
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { ModelValidationCard } from "@/hooks/useModelValidation";
import type { VersionRefs } from "@/lib/sim/validatedModel";
import { tupleNumbers } from "@/lib/trust/graphLevels";

/** Reads the version numbers the card names: its snapshot and the snapshot's
 *  simulation-inputs version through ONE read (`dataset_version_tuple` — the level
 *  table itself refuses an unidentified browser, D28), and its policy version. */
export function useVersionRefs(card: ModelValidationCard): VersionRefs {
  const [refs, setRefs] = useState<VersionRefs>({ graphVersionNo: null, policyVersionNo: null, simulationVersionNo: null });
  useEffect(() => {
    let alive = true;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;
    void Promise.all([
      card.dataset_version_id
        ? sb.rpc("dataset_version_tuple", { p_dataset_version_id: card.dataset_version_id })
            .then(async (r: { data: unknown; error: unknown }) =>
              // A database before `20261001000021` (the deploy window): the snapshot's
              // own number the way it was read before, and no level numbers.
              r.error
                ? sb.from("dataset_versions").select("version_no").eq("id", card.dataset_version_id).maybeSingle()
                : r)
        : Promise.resolve({ data: null }),
      sb.from("policy_versions").select("version_no").eq("id", card.policy_version_id).maybeSingle(),
    ]).then(([ds, pv]: Array<{ data: unknown }>) => {
      if (!alive) return;
      const t = tupleNumbers(ds.data);
      setRefs({
        graphVersionNo: t.snapshot,
        policyVersionNo: (pv.data as { version_no?: number | null } | null)?.version_no ?? null,
        // The card's own version id is the authority; the tuple's is the same row.
        simulationVersionNo: card.simulation_version_id ? t.simulation ?? null : null,
      });
    });
    return () => {
      alive = false;
    };
  }, [card.dataset_version_id, card.policy_version_id, card.simulation_version_id]);
  return refs;
}
