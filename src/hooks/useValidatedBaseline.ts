import { useMemo } from "react";
import type { Scenario } from "@/hooks/useScenarios";
import type { Credibility, ModelValidationCard, UseModelValidationResult } from "@/hooks/useModelValidation";
import { findValidationBaseline } from "@/lib/sim/validationBaseline";
import { worldOf, type SeedWorld } from "@/lib/sim/scenarioSeed";

/**
 * The validated baseline, its card and the world a new scenario starts in
 * (WP 9.4 slice 5). Shared by the Lab and the network pages' disruption
 * dialog, so a scenario born on either door starts in the same world.
 *
 * Takes the page's `useModelValidation` result rather than opening a second
 * subscription to the same table.
 */
export function useValidatedBaseline(args: {
  scenarios: Scenario[];
  cred: Pick<UseModelValidationResult, "cards" | "resolveScenario">;
  policyVersionId: string | null | undefined;
  dirty?: boolean;
}): {
  baseline: Scenario | null;
  /** the card whose world new scenarios take, or null */
  card: ModelValidationCard | null;
  world: SeedWorld;
  credibility: Credibility;
} {
  const { scenarios, cred, policyVersionId, dirty } = args;
  const baseline = useMemo(() => findValidationBaseline(scenarios), [scenarios]);

  const card = useMemo(() => {
    const validated = cred.cards
      .filter((c) => c.verdict === "validated" && c.status === "active")
      .sort((a, b) => (a.validated_at < b.validated_at ? 1 : -1));
    // The card on the policy version in force first; otherwise the newest — its
    // world is still the one that was certified, and the badge says the rest.
    return validated.find((c) => c.policy_version_id === policyVersionId) ?? validated[0] ?? null;
  }, [cred.cards, policyVersionId]);

  const world = useMemo(() => worldOf(baseline, card?.scenario_fingerprint), [baseline, card]);
  const credibility = cred.resolveScenario(policyVersionId, baseline, { dirty });

  return { baseline, card, world, credibility };
}
