// The `DerivedMaps` a grid surface resolves its master columns against —
// assembled ONCE, for both the desktop grid and the mobile stage list.
//
// ── WHY THIS IS A HOOK AND NOT TWO `useMemo`s ────────────────────────────────
//
// `useItemMasters` already derives the three economics maps, because all three
// need only the logistics lanes. Capacity is the first chain that ALSO needs
// the policy bundle and its overrides: the engine builds a product's weekly
// capacity from the plant grid's `capacity_units_per_day × 7 ×
// utilization_cap_pct`, resolved per product through the composite
// `node:<plant>::<product>` override key (§4 D75).
//
// `useItemMasters` has neither, and both grid surfaces have both — so the
// obvious move is to compute it in each of them. That is exactly how
// `resolveCell` came to have two implementations (WP 6.2's note on it, and §4
// D26 for the cost): two copies of a resolution rule, carried in lockstep,
// until they are not. One hook, two callers.

import { useMemo } from "react";
import { derivedProductionCapacity } from "@/lib/policies/effectiveEconomics";
import type { DerivedEconomics, ProductRow } from "@/hooks/useItemMasters";
import type { DerivedMaps } from "@/lib/policies/resolveEffective";
import type { OverrideRow } from "@/lib/policies/resolve";
import type { PolicyBundle } from "@/lib/policies/schemas";

export function useDerivedMaps(args: {
  derived: DerivedEconomics;
  products: ProductRow[];
  /** RAW outbound lanes — the demand side of the `twice_demand_floor_1000` step. */
  outbound: Record<string, unknown>[];
  defaults: PolicyBundle;
  overrides: OverrideRow[];
}): DerivedMaps {
  const { derived, products, outbound, defaults, overrides } = args;
  const productionCapacity = useMemo(
    () =>
      derivedProductionCapacity(
        products as unknown as Record<string, unknown>[],
        outbound,
        defaults as unknown as Record<string, unknown>,
        overrides as unknown as Record<string, unknown>[],
      ),
    [products, outbound, defaults, overrides],
  );
  return useMemo(
    () => ({ ...derived, productionCapacity }),
    [derived, productionCapacity],
  );
}
