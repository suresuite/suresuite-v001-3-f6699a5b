// BEFORE THE RUN: what capacity this run will use, and whether it is real.
//
// ── WHY THIS PANEL EXISTS (§4 D165) ─────────────────────────────────────────
//
// `products.production_capacity` is `recommended`, and its chain ends in a step
// that ALWAYS resolves: `twice_demand_floor_1000` — max(2 × demand, 1 000),
// chosen by the engine precisely so that capacity never binds. A project with
// no capacity anywhere therefore runs green, reports a fill rate, and answers
// "could we have made it?" with a yes that was assumed rather than computed.
// Nothing on either page said so.
//
// `suppliers.capacity_per_week` is the mirror image: `defaulted`, with an empty
// column DECLARED to mean unlimited. That is a legitimate modelling choice and
// this panel does not call it an error — but the registry states the cost, and
// a planner about to run a partial-magnitude supplier disruption needs to know
// that with no finite capacity it degrades to a full outage.
//
// Everything here is read from the engine's own declarations: the chain and its
// steps from `fallback_spec`, the meaning of a blank from `empty_means`. No
// order and no threshold is restated on this side.

import { useMemo } from "react";
import { Gauge } from "lucide-react";
import { cn } from "@/lib/utils";
import { reducerLabel } from "@/lib/policies/effectiveEconomics";
import { emptyMeansFor } from "@/lib/policies/registryAccess";
import { NON_BINDING_STEP, capacityReadiness } from "@/lib/sim/capacityReadiness";
import type { ProductRow, SupplierRow } from "@/hooks/useItemMasters";
import type { OverrideRow } from "@/lib/policies/resolve";
import type { PolicyBundle } from "@/lib/policies/schemas";

function Line({
  label, ids, note, tone,
}: {
  label: string;
  ids: string[];
  note: string;
  tone: "ok" | "soft" | "warn";
}) {
  if (ids.length === 0) return null;
  const dot =
    tone === "ok" ? "bg-emerald-500" : tone === "warn" ? "bg-amber-500" : "bg-sky-500";
  return (
    <div className="flex items-start gap-2 py-1">
      <span className={cn("mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full", dot)} />
      <div className="min-w-0">
        <div className="text-[11px]">
          <span className="font-medium tabular-nums">{ids.length}</span> {label}
        </div>
        <div className="text-[10px] leading-snug text-muted-foreground">{note}</div>
        {/* The names, because "3 products" is not something a planner can act
            on. Truncated at six with the count, never silently. */}
        <div className="truncate font-mono text-[10px] text-muted-foreground">
          {ids.slice(0, 6).join(", ")}
          {ids.length > 6 ? ` … +${ids.length - 6}` : ""}
        </div>
      </div>
    </div>
  );
}

export function CapacityReadinessPanel({
  products,
  suppliers,
  outbound,
  defaults,
  overrides,
  className,
}: {
  products: ProductRow[];
  suppliers: SupplierRow[];
  outbound: Record<string, unknown>[];
  defaults: PolicyBundle;
  overrides: OverrideRow[];
  className?: string;
}) {
  const r = useMemo(
    () => capacityReadiness({ products, suppliers, outbound, defaults, overrides }),
    [products, suppliers, outbound, defaults, overrides],
  );
  const supplierBlank = emptyMeansFor("suppliers.capacity_per_week");
  if (products.length === 0 && suppliers.length === 0) return null;

  return (
    <div className={cn("rounded-md border bg-card", className)}>
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
        <Gauge className="h-3.5 w-3.5 text-primary" />
        <span className="text-xs font-semibold">Capacity this run will use</span>
        <span className="text-[10px] text-muted-foreground">before dispatch</span>
      </div>
      <div className="px-3 py-2">
        <Line
          tone="ok"
          label={`product${r.fromMaster.length === 1 ? "" : "s"} from the item master`}
          ids={r.fromMaster}
          note="products.production_capacity, in units/week. The engine reads this first and the plant grid's line capacity is not applied."
        />
        <Line
          tone="ok"
          label={`product${r.fromPolicy.length === 1 ? "" : "s"} from the plant grid`}
          ids={r.fromPolicy}
          note={`No master capacity, so the engine derives it from ${reducerLabel("production_policy_capacity")}.`}
        />
        <Line
          tone="warn"
          label={`product${r.nonBinding.length === 1 ? "" : "s"} with NO capacity figure`}
          ids={r.nonBinding}
          note={`The engine substitutes ${reducerLabel(NON_BINDING_STEP)}. This run cannot tell you whether plant capacity would have been a constraint for them.`}
        />
        <Line
          tone="ok"
          label={`supplier${r.finiteSuppliers.length === 1 ? "" : "s"} with a finite weekly capacity`}
          ids={r.finiteSuppliers}
          note="These can throttle shipments, and a partial-magnitude disruption on them cuts capacity rather than stopping it."
        />
        <Line
          tone="soft"
          label={`supplier${r.unlimitedSuppliers.length === 1 ? "" : "s"} declared unlimited`}
          ids={r.unlimitedSuppliers}
          note={
            supplierBlank?.meaning ??
            "An empty suppliers.capacity_per_week means unlimited."
          }
        />
      </div>
    </div>
  );
}
