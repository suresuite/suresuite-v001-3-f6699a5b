import type { PresetDefinition } from "../resolvePreset";
import { leanJit } from "./lean_jit";
import { resilient } from "./resilient";
import { costOptimized } from "./cost_optimized";
import { serviceFirst } from "./service_first";
import { sustainable } from "./sustainable";
import { agileHighMix } from "./agile_high_mix";
import { makeToStock } from "./make_to_stock";
import { makeToOrder } from "./make_to_order";

export const ALL_PRESETS: PresetDefinition[] = [
  makeToStock,
  makeToOrder,
  leanJit,
  resilient,
  serviceFirst,
  costOptimized,
  agileHighMix,
  sustainable,
];

export function getPreset(slug: string): PresetDefinition | undefined {
  return ALL_PRESETS.find((p) => p.slug === slug);
}
