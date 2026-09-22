// "What capacity will this run use, and is it real?" — the pure split behind
// `CapacityReadinessPanel`, kept out of the component file so it can be tested
// without React (and so the panel file exports a component and nothing else).
//
// Every rule here is read from the engine's declarations: which step resolved a
// product's capacity comes from `fallback_spec` through `derivedProductionCapacity`,
// and the meaning of an empty supplier capacity from `empty_means`. The one
// constant is the NAME of the engine's give-up step, which is a registry
// identifier rather than a threshold (§4 D165).

import { derivedProductionCapacity } from "@/lib/policies/effectiveEconomics";
import type { ProductRow, SupplierRow } from "@/hooks/useItemMasters";
import type { OverrideRow } from "@/lib/policies/resolve";
import type { PolicyBundle } from "@/lib/policies/schemas";

/** The step the engine uses when it has no capacity figure at all. */
export const NON_BINDING_STEP = "twice_demand_floor_1000";

export interface CapacityReadiness {
  /** Products whose capacity the master states outright. */
  fromMaster: string[];
  /** Products whose capacity the plant grid supplies (units/day × 7 × cap). */
  fromPolicy: string[];
  /** Products the engine will give a non-binding default. */
  nonBinding: string[];
  /** Suppliers that declare a finite weekly capacity. */
  finiteSuppliers: string[];
  /** Suppliers whose empty capacity DECLARES unlimited. */
  unlimitedSuppliers: string[];
}

export function capacityReadiness(args: {
  products: ProductRow[];
  suppliers: SupplierRow[];
  outbound: Record<string, unknown>[];
  defaults: PolicyBundle;
  overrides: OverrideRow[];
}): CapacityReadiness {
  const { products, suppliers, outbound, defaults, overrides } = args;
  const derived = derivedProductionCapacity(
    products as unknown as Record<string, unknown>[],
    outbound,
    defaults as unknown as Record<string, unknown>,
    overrides as unknown as Record<string, unknown>[],
  );
  const out: CapacityReadiness = {
    fromMaster: [], fromPolicy: [], nonBinding: [],
    finiteSuppliers: [], unlimitedSuppliers: [],
  };
  for (const p of products) {
    if (p.production_capacity != null && Number(p.production_capacity) > 0) {
      out.fromMaster.push(p.product_id);
      continue;
    }
    const step = derived.get(p.product_id);
    if (step?.via === NON_BINDING_STEP || step === undefined) out.nonBinding.push(p.product_id);
    else out.fromPolicy.push(p.product_id);
  }
  for (const s of suppliers) {
    if (s.capacity_per_week != null && Number(s.capacity_per_week) > 0) {
      out.finiteSuppliers.push(s.supplier_id);
    } else {
      out.unlimitedSuppliers.push(s.supplier_id);
    }
  }
  return out;
}
