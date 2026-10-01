// The graph and policy version NUMBERS a Validated Model names — one row read
// each (WP 10.3 / 10.5). Shared by the summary card and the Lab's Model step.
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { ModelValidationCard } from "@/hooks/useModelValidation";
import type { VersionRefs } from "@/lib/sim/validatedModel";

/** Reads the two version numbers the card names (one row each). */
export function useVersionRefs(card: ModelValidationCard): VersionRefs {
  const [refs, setRefs] = useState<VersionRefs>({ graphVersionNo: null, policyVersionNo: null });
  useEffect(() => {
    let alive = true;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;
    void Promise.all([
      card.dataset_version_id
        ? sb.from("dataset_versions").select("version_no").eq("id", card.dataset_version_id).maybeSingle()
        : Promise.resolve({ data: null }),
      sb.from("policy_versions").select("version_no").eq("id", card.policy_version_id).maybeSingle(),
    ]).then(([ds, pv]: Array<{ data: { version_no?: number | null } | null }>) => {
      if (!alive) return;
      setRefs({ graphVersionNo: ds.data?.version_no ?? null, policyVersionNo: pv.data?.version_no ?? null });
    });
    return () => {
      alive = false;
    };
  }, [card.dataset_version_id, card.policy_version_id]);
  return refs;
}

