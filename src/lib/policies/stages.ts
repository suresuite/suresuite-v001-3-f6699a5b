import type { PolicyFamily } from "./schemas";

export type StageKey = "supplier" | "plant" | "customer" | "run_validate";

export interface StageDef {
  key: StageKey;
  title: string;
  role: string;
  families: PolicyFamily[];
  overrideFamilies: PolicyFamily[];
}

export const STAGES: StageDef[] = [
  {
    key: "supplier",
    title: "Supplier",
    role: "Per supplier × material: sourcing, inbound transport & MOQ.",
    families: ["sourcing", "transport", "inventory", "production"],
    overrideFamilies: ["sourcing", "transport", "inventory"],
  },
  {
    key: "plant",
    title: "Focal plant",
    role: "Per product: capacity, production cost, lead time (inventory if MTS).",
    families: ["production", "inventory", "fulfillment"],
    overrideFamilies: ["production", "inventory"],
  },
  {
    key: "customer",
    title: "Customer",
    role: "Per customer × product: demand, sourcing firm, price, service level.",
    families: ["demand", "fulfillment"],
    overrideFamilies: ["demand", "fulfillment"],
  },
  {
    key: "run_validate",
    title: "Run & validate",
    role: "Verify, detect warm-up, set replications, then launch the simulation.",
    families: [],
    overrideFamilies: [],
  },
];

export function getStage(key: StageKey): StageDef {
  return STAGES.find((s) => s.key === key)!;
}

export function stageForFamily(family: PolicyFamily): StageKey {
  for (const s of STAGES) if (s.families.includes(family)) return s.key;
  return "plant";
}
