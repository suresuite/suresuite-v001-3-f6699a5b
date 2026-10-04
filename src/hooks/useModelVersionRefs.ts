// The snapshot, simulation-inputs and policy versions a Validated Model names
// (WP 10.3 / 10.5; simulation inputs since WP 11.3; their CODES since the WP 10.5
// follow-up). Shared by the summary card and the Lab's Model step.
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { ModelValidationCard } from "@/hooks/useModelValidation";
import type { VersionRefs } from "@/lib/sim/validatedModel";
import { tupleNumbers } from "@/lib/trust/graphLevels";
import { dataRef, policyRef } from "@/lib/versions/versionLabels";

type CardRefs = Pick<ModelValidationCard, "id" | "dataset_version_id" | "policy_version_id" | "simulation_version_id">;

/** The simulation level's code from a `dataset_version_tuple` payload. */
function simulationCode(raw: unknown): string | null {
  const sim = (raw as { simulation?: { version_code?: unknown } | null } | null)?.simulation;
  return sim && typeof sim.version_code === "string" ? sim.version_code : null;
}

/** One card's refs, read through ONE tuple read (`dataset_version_tuple` — the level
 *  table itself refuses an unidentified browser, D28) and its policy version row. */
async function readRefs(card: CardRefs): Promise<VersionRefs> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any;
  const [ds, pv] = (await Promise.all([
    card.dataset_version_id
      ? sb.rpc("dataset_version_tuple", { p_dataset_version_id: card.dataset_version_id })
          .then(async (r: { data: unknown; error: unknown }) =>
            // A database before `20261001000021` (the deploy window): the snapshot's
            // own number the way it was read before, and no level numbers.
            r.error
              ? sb.from("dataset_versions").select("version_no").eq("id", card.dataset_version_id).maybeSingle()
              : r)
      : Promise.resolve({ data: null }),
    sb.from("policy_versions").select("version_no,version_code").eq("id", card.policy_version_id).maybeSingle()
      .then(async (r: { data: unknown; error: unknown }) =>
        // Before `20261004000002` there is no code column: the number alone.
        r.error ? sb.from("policy_versions").select("version_no").eq("id", card.policy_version_id).maybeSingle() : r),
  ])) as Array<{ data: unknown }>;
  const t = tupleNumbers(ds.data);
  const policy = pv.data as { version_no?: number | null; version_code?: string | null } | null;
  // The card's own version id is the authority; the tuple's is the same row.
  const hasSim = !!card.simulation_version_id;
  return {
    graphVersionNo: t.snapshot,
    policyVersionNo: policy?.version_no ?? null,
    simulationVersionNo: hasSim ? t.simulation ?? null : null,
    policyCode: policy?.version_code ?? null,
    simulationCode: hasSim ? simulationCode(ds.data) : null,
  };
}

const EMPTY: VersionRefs = { graphVersionNo: null, policyVersionNo: null, simulationVersionNo: null };

export function useVersionRefs(card: ModelValidationCard): VersionRefs {
  const [refs, setRefs] = useState<VersionRefs>(EMPTY);
  useEffect(() => {
    let alive = true;
    void readRefs(card).then((r) => {
      if (alive) setRefs(r);
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card.id, card.dataset_version_id, card.policy_version_id, card.simulation_version_id]);
  return refs;
}

/** "Data 20260915" / "Policy 20261004" for every model in a picker, by card id. */
export function useModelCodes(cards: CardRefs[]): Record<string, { data: string | null; policy: string | null }> {
  const [codes, setCodes] = useState<Record<string, { data: string | null; policy: string | null }>>({});
  const key = useMemo(
    () => cards.map((c) => `${c.id}:${c.dataset_version_id}:${c.policy_version_id}:${c.simulation_version_id}`).join("|"),
    [cards],
  );
  useEffect(() => {
    let alive = true;
    void Promise.all(cards.map(async (c) => [c.id, await readRefs(c)] as const)).then((all) => {
      if (!alive) return;
      setCodes(
        Object.fromEntries(
          all.map(([id, r]) => [
            id,
            {
              data: dataRef({ version_code: r.simulationCode, version_no: r.simulationVersionNo }),
              policy: policyRef({ version_code: r.policyCode, version_no: r.policyVersionNo }),
            },
          ]),
        ),
      );
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return codes;
}
