import type { PresetDefinition, ProjectContext } from "../resolvePreset";
import type { PolicyFamily } from "../schemas";
import { STAGES, type StageKey } from "../stages";
import { ALL_PRESETS } from "./index";

function scoped(base: PresetDefinition, stage: StageKey, label: string, blurb: string): PresetDefinition {
  const families = STAGES.find((s) => s.key === stage)!.families;
  return {
    ...base,
    slug: `${stage}:${base.slug}`,
    name: label,
    description: blurb,
    derive: (ctx: ProjectContext) => {
      const full = base.derive(ctx);
      const out: Partial<Record<PolicyFamily, ReturnType<typeof base.derive>[PolicyFamily]>> = {};
      for (const f of families) if (full[f]) out[f] = full[f];
      return out;
    },
  };
}

function find(slug: string): PresetDefinition {
  const p = ALL_PRESETS.find((x) => x.slug === slug);
  if (!p) throw new Error(`Missing preset: ${slug}`);
  return p;
}

/**
 * Curated, minimal stage presets. Three meaningful, distinct options per stage.
 */
export const STAGE_PRESETS: Record<StageKey, PresetDefinition[]> = {
  supplier: [
    scoped(find("resilient"), "supplier",
      "Dual-source resilient",
      "70/30 dual sourcing, reliability floor 0.95, intermodal transport."),
    scoped(find("cost_optimized"), "supplier",
      "Lowest-cost single source",
      "Consolidate on cheapest supplier, weekly orders, LTL milk-run."),
    scoped(find("lean_jit"), "supplier",
      "JIT inbound",
      "Single trusted supplier, daily orders, direct FTL — minimal buffer."),
  ],
  plant: [
    scoped(find("make_to_stock"), "plant",
      "Make-to-stock",
      "Build to forecast, larger safety stock, high utilization cap."),
    scoped(find("make_to_order"), "plant",
      "Make-to-order",
      "Build to confirmed demand, minimal FG inventory, lot-for-lot."),
    scoped(find("lean_jit"), "plant",
      "Lean pull",
      "Daily review, low safety stock, 80% utilization cap, FIFO."),
  ],
  customer: [
    scoped(find("service_first"), "customer",
      "Premium service",
      "High α service level, SLA-tier allocation, no backorder."),
    scoped(find("cost_optimized"), "customer",
      "Cost-first fulfillment",
      "Lower α, FIFO allocation, accept backorder to cut inventory cost."),
    scoped(find("agile_high_mix"), "customer",
      "Agile high-mix",
      "Short forecast horizon, priority allocation, flexible mix."),
  ],
  run_validate: [],
};

export function getStagePresets(stage: StageKey): PresetDefinition[] {
  return STAGE_PRESETS[stage];
}
