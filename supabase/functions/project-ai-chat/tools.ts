// Supply-chain tool registry for the AI chatbot.
// Each tool is scoped to a project, validates inputs, and returns a strict
// { kind, data, meta } envelope so the UI can pick a renderer.

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

export type ToolKind = "table" | "kpi" | "bullets" | "text";

export interface ToolEnvelope {
  kind: ToolKind;
  data: unknown;
  meta: { tool: string; row_count: number; note?: string };
}

export interface ToolContext {
  projectId: string;
  userId: string;
  supabase: SupabaseClient;
}

function envelope(
  tool: string,
  kind: ToolKind,
  data: unknown,
  row_count: number,
  note?: string,
): ToolEnvelope {
  return { kind, data, meta: { tool, row_count, note } };
}

function empty(tool: string, note = "No data available for this project."): ToolEnvelope {
  return envelope(tool, "text", note, 0, "empty");
}

// ---------- Gemini function declarations (server-side only) ----------

export const toolDeclarations = [
  {
    name: "list_project_entities",
    description:
      "List suppliers, customers, materials and plants known for the project. Use this FIRST when the user mentions an entity by name so you can resolve it to a canonical id before calling other tools.",
    parameters: {
      type: "object",
      properties: {
        entity_type: {
          type: "string",
          enum: ["supplier", "customer", "material", "plant", "all"],
          description: "Which kind of entity to list. Use 'all' if unsure.",
        },
        limit: { type: "number", description: "Max rows to return (1-100). Default 25." },
      },
      required: ["entity_type"],
    },
  },
  {
    name: "get_supplier_risk",
    description:
      "Return supplier risk scores and the top risk drivers for the project. Supports filtering by supplier name or tier.",
    parameters: {
      type: "object",
      properties: {
        supplier: { type: "string", description: "Optional supplier name to filter by." },
        tier: { type: "number", description: "Optional tier filter (1, 2 or 3)." },
        top_n: { type: "number", description: "Return only the top N suppliers by risk. Default 10." },
      },
    },
  },
  {
    name: "get_procurement_spend",
    description:
      "Aggregate procurement spend for the project, grouped by supplier or material. Useful for top-spend questions and concentration analysis.",
    parameters: {
      type: "object",
      properties: {
        group_by: {
          type: "string",
          enum: ["supplier", "material"],
          description: "Dimension to aggregate spend on.",
        },
        top_n: { type: "number", description: "Top N rows to return. Default 10." },
      },
      required: ["group_by"],
    },
  },
  {
    name: "get_material_risk",
    description:
      "Identify materials at risk: single-sourced, long lead-time, or critical in the BOM. Returns rows with risk drivers.",
    parameters: {
      type: "object",
      properties: {
        material: { type: "string", description: "Optional material name to filter on." },
        only_single_source: { type: "boolean", description: "If true, return only single-sourced materials." },
        top_n: { type: "number", description: "Top N rows. Default 15." },
      },
    },
  },
  {
    name: "recommend_disruption_strategy",
    description:
      "Given a disruption (target node id/name and disruption type), return ranked recovery playbooks with rationale. Use when the user describes a hypothetical outage, shortage, or shock.",
    parameters: {
      type: "object",
      properties: {
        target: { type: "string", description: "Node id, supplier name, or material affected." },
        disruption_type: {
          type: "string",
          enum: ["supplier_outage", "material_shortage", "lead_time_shock", "demand_surge", "nexus_attack"],
        },
        magnitude_pct: { type: "number", description: "Severity 0-100. Default 50." },
      },
      required: ["disruption_type"],
    },
  },
] as const;

// ---------- Handlers ----------

type Handler = (args: Record<string, unknown>, ctx: ToolContext) => Promise<ToolEnvelope>;

const clamp = (n: unknown, fallback: number, min = 1, max = 100): number => {
  const v = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(v)));
};

async function listProjectEntities(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolEnvelope> {
  const entityType = String(args.entity_type ?? "all");
  const limit = clamp(args.limit, 25, 1, 100);
  const out: Array<{ type: string; id: string; label: string }> = [];

  try {
    if (entityType === "supplier" || entityType === "customer" || entityType === "all") {
      const { data: nodes } = await ctx.supabase
        .from("network_nodes")
        .select("node_id, node_name, node_type")
        .eq("project_id", ctx.projectId)
        .limit(limit * 2);
      for (const n of nodes ?? []) {
        const t = String(n.node_type ?? "").toLowerCase();
        if (entityType === "all" || t === entityType) {
          out.push({ type: t || "node", id: String(n.node_id ?? n.node_name), label: String(n.node_name ?? n.node_id) });
        }
      }
    }
    if (entityType === "material" || entityType === "all") {
      const { data: bom } = await ctx.supabase
        .from("bom_multi_level")
        .select("material_id, material_name")
        .eq("project_id", ctx.projectId)
        .limit(limit);
      for (const m of bom ?? []) {
        out.push({ type: "material", id: String(m.material_id), label: String(m.material_name ?? m.material_id) });
      }
    }
  } catch (e) {
    console.warn("list_project_entities query failed:", (e as Error).message);
  }

  if (out.length === 0) return empty("list_project_entities");

  const rows = out.slice(0, limit);
  return envelope("list_project_entities", "table", {
    columns: ["type", "id", "label"],
    rows: rows.map((r) => [r.type, r.id, r.label]),
  }, rows.length);
}

async function getSupplierRisk(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolEnvelope> {
  const supplier = args.supplier ? String(args.supplier) : null;
  const tier = args.tier ? clamp(args.tier, 1, 1, 3) : null;
  const topN = clamp(args.top_n, 10, 1, 50);

  try {
    let q = ctx.supabase
      .from("risk_data")
      .select("supplier_id, supplier_name, risk_score, tier, risk_drivers")
      .eq("project_id", ctx.projectId);
    if (supplier) q = q.ilike("supplier_name", `%${supplier}%`);
    if (tier) q = q.eq("tier", tier);
    const { data, error } = await q.order("risk_score", { ascending: false }).limit(topN);
    if (error) throw error;
    const rows = data ?? [];
    if (rows.length === 0) return empty("get_supplier_risk");

    return envelope("get_supplier_risk", "table", {
      columns: ["Supplier", "Tier", "Risk Score", "Top Drivers"],
      rows: rows.map((r: any) => [
        r.supplier_name ?? r.supplier_id,
        r.tier ?? "-",
        r.risk_score ?? "-",
        Array.isArray(r.risk_drivers) ? r.risk_drivers.slice(0, 3).join(", ") : (r.risk_drivers ?? "-"),
      ]),
    }, rows.length);
  } catch (e) {
    console.warn("get_supplier_risk failed:", (e as Error).message);
    return empty("get_supplier_risk");
  }
}

async function getProcurementSpend(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolEnvelope> {
  const groupBy = String(args.group_by ?? "supplier") === "material" ? "material" : "supplier";
  const topN = clamp(args.top_n, 10, 1, 50);

  try {
    const { data, error } = await ctx.supabase
      .from("supply_chain_data")
      .select("from_location, to_location, material_id, quantity, unit_cost, total_cost")
      .eq("project_id", ctx.projectId)
      .limit(5000);
    if (error) throw error;
    const rows = data ?? [];
    if (rows.length === 0) return empty("get_procurement_spend");

    const agg = new Map<string, { spend: number; orders: number }>();
    for (const r of rows as any[]) {
      const key = groupBy === "supplier"
        ? String(r.from_location ?? "unknown")
        : String(r.material_id ?? "unknown");
      const spend = Number(r.total_cost ?? (Number(r.quantity ?? 0) * Number(r.unit_cost ?? 0))) || 0;
      const cur = agg.get(key) ?? { spend: 0, orders: 0 };
      cur.spend += spend;
      cur.orders += 1;
      agg.set(key, cur);
    }
    const sorted = [...agg.entries()].sort((a, b) => b[1].spend - a[1].spend).slice(0, topN);
    const totalSpend = [...agg.values()].reduce((s, v) => s + v.spend, 0);

    if (sorted[0]?.[1].spend === 0) return empty("get_procurement_spend", "Project has rows but no cost data.");

    return envelope("get_procurement_spend", "table", {
      columns: [groupBy === "supplier" ? "Supplier" : "Material", "Spend", "Orders", "% of Total"],
      rows: sorted.map(([k, v]) => [
        k,
        Math.round(v.spend),
        v.orders,
        totalSpend ? `${((v.spend / totalSpend) * 100).toFixed(1)}%` : "-",
      ]),
    }, sorted.length, `Total spend across project: ${Math.round(totalSpend)}`);
  } catch (e) {
    console.warn("get_procurement_spend failed:", (e as Error).message);
    return empty("get_procurement_spend");
  }
}

async function getMaterialRisk(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolEnvelope> {
  const material = args.material ? String(args.material) : null;
  const onlySingle = Boolean(args.only_single_source);
  const topN = clamp(args.top_n, 15, 1, 50);

  try {
    let q = ctx.supabase
      .from("bom_multi_level")
      .select("material_id, material_name, supplier_count, lead_time_days, criticality")
      .eq("project_id", ctx.projectId);
    if (material) q = q.ilike("material_name", `%${material}%`);
    const { data, error } = await q.limit(500);
    if (error) throw error;
    let rows = (data ?? []) as any[];
    if (onlySingle) rows = rows.filter((r) => Number(r.supplier_count ?? 1) <= 1);
    rows.sort((a, b) =>
      (Number(b.criticality ?? 0) - Number(a.criticality ?? 0)) ||
      (Number(b.lead_time_days ?? 0) - Number(a.lead_time_days ?? 0))
    );
    rows = rows.slice(0, topN);
    if (rows.length === 0) return empty("get_material_risk");

    return envelope("get_material_risk", "table", {
      columns: ["Material", "Suppliers", "Lead Time (d)", "Criticality"],
      rows: rows.map((r) => [
        r.material_name ?? r.material_id,
        r.supplier_count ?? "-",
        r.lead_time_days ?? "-",
        r.criticality ?? "-",
      ]),
    }, rows.length);
  } catch (e) {
    console.warn("get_material_risk failed:", (e as Error).message);
    return empty("get_material_risk");
  }
}

async function recommendDisruptionStrategy(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolEnvelope> {
  const disruptionType = String(args.disruption_type ?? "");
  const target = args.target ? String(args.target) : null;
  const magnitude = clamp(args.magnitude_pct, 50, 0, 100);

  try {
    let q = ctx.supabase
      .from("recovery_playbooks")
      .select("name, applies_to_disruption, description, expected_recovery_days, estimated_cost, effectiveness_score")
      .eq("project_id", ctx.projectId);
    if (disruptionType) q = q.contains("applies_to_disruption", [disruptionType]);
    const { data, error } = await q.limit(50);
    if (error) throw error;
    let rows = (data ?? []) as any[];
    rows.sort((a, b) => Number(b.effectiveness_score ?? 0) - Number(a.effectiveness_score ?? 0));
    rows = rows.slice(0, 5);

    if (rows.length === 0) {
      // Fall back to generic playbooks so the AI still has something to reason about.
      const generic = genericPlaybooks(disruptionType, magnitude, target);
      return envelope("recommend_disruption_strategy", "bullets", generic, generic.length,
        "No project-specific playbooks found; returning canonical recovery patterns.");
    }

    return envelope("recommend_disruption_strategy", "table", {
      columns: ["Playbook", "Effectiveness", "Est. Recovery (d)", "Est. Cost", "Rationale"],
      rows: rows.map((r) => [
        r.name,
        r.effectiveness_score ?? "-",
        r.expected_recovery_days ?? "-",
        r.estimated_cost ?? "-",
        r.description ?? "-",
      ]),
    }, rows.length);
  } catch (e) {
    console.warn("recommend_disruption_strategy failed:", (e as Error).message);
    const generic = genericPlaybooks(disruptionType, magnitude, target);
    return envelope("recommend_disruption_strategy", "bullets", generic, generic.length,
      "No project playbooks available; returning canonical patterns.");
  }
}

function genericPlaybooks(disruption: string, magnitude: number, target: string | null): string[] {
  const t = target ? ` for ${target}` : "";
  const sev = magnitude >= 70 ? "high-severity" : magnitude >= 30 ? "moderate" : "low-severity";
  switch (disruption) {
    case "supplier_outage":
      return [
        `Activate qualified backup suppliers${t} — prioritize those already approved in the AVL.`,
        `Increase safety stock by ${Math.round(magnitude / 2)}% for the affected SKUs during the recovery window.`,
        `Engage logistics to expedite in-transit inventory; consider air freight for ${sev} disruption.`,
        `Open dual-sourcing RFQ within 5 business days to prevent recurrence.`,
      ];
    case "material_shortage":
      return [
        `Substitute with approved alternate materials${t}; verify BOM compatibility first.`,
        `Reallocate constrained material to highest-margin or strategic-customer orders.`,
        `Negotiate long-term contract with secondary source to de-risk the category.`,
      ];
    case "lead_time_shock":
      return [
        `Shift to closer-shore suppliers${t} for the affected category.`,
        `Pre-position inventory at distribution centers near top-demand regions.`,
        `Communicate revised promise dates to customers within 24 hours.`,
      ];
    case "demand_surge":
      return [
        `Activate overtime / second-shift capacity at the focal plant.`,
        `Pull-in open POs and request expedites from top tier-1 suppliers.`,
        `Temporarily lift order limits on strategic SKUs; throttle non-strategic SKUs.`,
      ];
    case "nexus_attack":
      return [
        `Isolate impacted hub${t}; re-route flows through redundant nexus nodes.`,
        `Stand up a temporary cross-dock at the next-best logistics node.`,
        `Increase monitoring cadence to daily for upstream suppliers feeding the nexus.`,
      ];
    default:
      return [`No predefined playbook for disruption type "${disruption}". Run a scenario in the Simulation Lab to evaluate options.`];
  }
}

const handlers: Record<string, Handler> = {
  list_project_entities: listProjectEntities,
  get_supplier_risk: getSupplierRisk,
  get_procurement_spend: getProcurementSpend,
  get_material_risk: getMaterialRisk,
  recommend_disruption_strategy: recommendDisruptionStrategy,
};

export async function executeTool(
  name: string,
  rawArgs: Record<string, unknown> | undefined,
  ctx: ToolContext,
): Promise<ToolEnvelope> {
  const handler = handlers[name];
  if (!handler) {
    return envelope(name, "text", `Unknown tool: ${name}`, 0, "unknown_tool");
  }
  try {
    return await handler(rawArgs ?? {}, ctx);
  } catch (e) {
    console.error(`Tool ${name} threw:`, e);
    return envelope(name, "text", "Tool execution failed.", 0, "error");
  }
}

export function makeToolContext(projectId: string, userId: string): ToolContext {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    { auth: { persistSession: false } },
  );
  return { projectId, userId, supabase };
}
