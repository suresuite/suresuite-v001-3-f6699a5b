// Pre-dispatch validation gate — Phase A / G6 / §8.1–8.2.
//
// Thin edge adapter over the ONE grading module (grading.ts): loads the raw
// project tables and delegates manifest compilation + grading to the same
// code the browser verification runs, so the two surfaces cannot disagree.
// The registry snapshot is the generated mirror kept in sync by
// scsim/scripts/gen_frontend_registry.py (CI drift gate).
//
//   block          → run rejected (engine hard failures, unresolvable required)
//   warn           → rejected unless payload.acknowledge_warnings (the
//                    /policies verification stage sets it after displaying
//                    findings; the Lab offers "Run anyway")
//   info           → never gates
//
// The engine's MappingWarning stream remains the final tripwire; a project
// that passes this gate maps with no warn-level fallbacks (gate E1, §3).

import registry from "./registry.generated.json" with { type: "json" };
import bridge from "./engineBridge.json" with { type: "json" };
import {
  flattenFindings,
  gradeManifest,
  num,
  type BridgeTables,
  type GradingDataset,
  type RegistryPayload,
} from "./grading.ts";

export interface GateFinding {
  severity: "block" | "warn" | "info";
  field: string;
  policy: string;
  rows: string[];
  message: string;
}

export interface GateResult {
  status: "blocked" | "ack_required";
  findings: GateFinding[];
}

export type { GradingDataset as GateDataset };

/**
 * Load the raw tables the grader reads. MUST be called with the service-role
 * client: grading is a read-only completeness check, and the app's custom
 * RLS context never reaches a pooled edge connection (the same reason the
 * project-existence check in sim-command uses the service role).
 */
// deno-lint-ignore no-explicit-any
export async function loadGateDataset(sb: any, projectId: string): Promise<GradingDataset> {
  const [materials, products, suppliers, inbound, outbound, bomSingle, bomMulti] = await Promise.all([
    sb.from("materials").select("material_id,cost,moq,holding_cost_pct").eq("project_id", projectId),
    sb.from("products").select("product_id,sell_price,demand_mean,production_capacity,demand_cv").eq("project_id", projectId),
    sb.from("suppliers").select("supplier_id,capacity_per_week,reliability_score").eq("project_id", projectId),
    sb.from("inbound_logistics").select("supplier_id,material_id,unit_price,lead_time,volume,time_unit").eq("project_id", projectId),
    sb.from("outbound_logistics").select("product_id,customer_id,unit_price,volume,time_unit").eq("project_id", projectId),
    sb.from("bom_single_level").select("product_id,material_id").eq("project_id", projectId),
    sb.from("bom_multi_level").select("material_id,higher_level_component_id").eq("project_id", projectId),
  ]);
  // Multi-level rows win when they exist — the same rule the engine's
  // datamap and the frontend lanes apply — graded through the single-level
  // manifest shape (the parent component stands in for product_id). Grading
  // the wrong (empty) table once let a run through the gate only to die in
  // the engine with "bom too_short".
  // deno-lint-ignore no-explicit-any
  const multiRows = (bomMulti.data ?? []) as any[];
  const bom = multiRows.length > 0
    ? multiRows.map((r) => ({
        product_id: r.higher_level_component_id,
        material_id: r.material_id,
      }))
    : bomSingle.data ?? [];
  return {
    materials: materials.data ?? [],
    products: products.data ?? [],
    suppliers: suppliers.data ?? [],
    inbound: inbound.data ?? [],
    outbound: outbound.data ?? [],
    bom,
  };
}

export function runValidationGate(args: {
  dataset: GradingDataset;
  snapshotDefaults: Record<string, unknown>;
  disruptionSchedule: Array<Record<string, unknown>>;
  acknowledgeWarnings: boolean;
}): GateResult | null {
  const { dataset, snapshotDefaults, disruptionSchedule, acknowledgeWarnings } = args;

  const graded = gradeManifest(
    dataset,
    snapshotDefaults,
    registry as unknown as RegistryPayload,
    bridge as unknown as BridgeTables,
  );
  const findings: GateFinding[] = flattenFindings(graded).map(
    ({ severity, field, policy, rows, message }) =>
      ({ severity, field, policy, rows, message }),
  );

  // Scenario-conditional (not a manifest field): a partial-magnitude supplier
  // disruption needs a finite supplier capacity to throttle — else the mapper
  // degrades it to a full outage (project_map.py::_map_events).
  const capBySupplier = new Map(
    dataset.suppliers.map((s) => [String(s.supplier_id ?? ""), num(s.capacity_per_week)]),
  );
  for (const ev of disruptionSchedule ?? []) {
    const magnitude = num(ev.magnitude_pct ?? ev.magnitude ?? 100);
    if (magnitude >= 100) continue;
    const raw = String(ev.target ?? ev.target_id ?? "");
    const target = raw.includes(":") ? raw.slice(raw.lastIndexOf(":") + 1) : raw;
    if (!capBySupplier.has(target)) continue; // plant/unknown targets: not this check
    if ((capBySupplier.get(target) ?? 0) <= 0) {
      findings.push({
        severity: "warn",
        field: "suppliers.capacity_per_week",
        policy: "engine",
        rows: [target],
        message:
          `Scenario cuts supplier "${target}" to ${magnitude}% capacity, but the supplier ` +
          `has no capacity_per_week — the engine will degrade this to a full outage.`,
      });
    }
  }

  const blocks = findings.filter((f) => f.severity === "block");
  const warns = findings.filter((f) => f.severity === "warn");
  if (blocks.length > 0) return { status: "blocked", findings };
  if (warns.length > 0 && !acknowledgeWarnings) return { status: "ack_required", findings };
  return null;
}
