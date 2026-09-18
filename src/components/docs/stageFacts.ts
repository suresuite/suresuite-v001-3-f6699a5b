// The policy-grid facts behind §6.3 section 5's stage pages — WP 5.2c.
//
// Functions, not components, for the reason `tableFacts.ts` exists: a module
// exporting both breaks fast refresh for everything that imports it.

import { CHAINS, type PolicyChain } from "@/components/docs/generated/policy.generated";
import { STAGE_TABLE_SPEC, type ColSpec } from "@/lib/policies/columnSpecs";
import type { StageKey } from "@/lib/policies/stages";

/** The grid's own columns for a stage, minus the synthetic grouping cells. */
export function stageColumns(stage: StageKey): ColSpec[] {
  // A synthetic column is a grouping CELL, not a field — `__inv_params` renders
  // a row's replenishment parameters as one vector. Asking what it reaches is a
  // question about nothing, and WP 6.1's first draft reported two of them as
  // broken chains before that was noticed.
  return (STAGE_TABLE_SPEC[stage].cols as (ColSpec & { synthetic?: boolean })[]).filter(
    (c) => !c.synthetic,
  );
}

export const chainFor = (stage: string, field: string): PolicyChain | undefined =>
  CHAINS.find((c) => c.stage === stage && c.field === field);
