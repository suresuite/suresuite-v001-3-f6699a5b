// Supply-chain tool registry for the AI chatbot.
// Each tool is scoped to a project, validates inputs, and returns a strict
// { kind, data, meta } envelope so the UI can pick a renderer.

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

// "proposal" is the Layer B draft-tool envelope kind (ai-agents.md §4.5):
// rendered by ProposalCard; no Stage 0 tool emits it yet.
export type ToolKind = "table" | "kpi" | "bullets" | "text" | "proposal";

export interface ToolEnvelope {
  kind: ToolKind;
  data: unknown;
  meta: { tool: string; row_count: number; note?: string };
}

/** Attribution + authorization the draft_* tool family needs beyond the read
 * scope (ai-agents.md §4.5, §13.2 checkpoint 3). Layer A persona turns never
 * set it — a draft handler invoked without it refuses `agent_disabled`. */
export interface DraftAttribution {
  userEmail: string | null;
  threadId: string | null;
  modelCode: string | null;
  providerCode: string | null;
  /** `agent_proposals` capability resolved server-side (checkpoint 3). */
  canProposals: boolean;
  /** The routed utterance — cited on user_supplied rows (kind user_message). */
  utterance: string;
  /** The thread's §15 interaction mode — lets the one ask-mode-routable
   * agent (report-builder, §16.1) phrase its refusals per mode. Absent ⇒
   * 'review' (the pre-§15 behavior). */
  mode?: "ask" | "review";
}

export interface ToolContext {
  projectId: string;
  userId: string;
  supabase: SupabaseClient;
  draft?: DraftAttribution;
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

// Shape of one function declaration as the providers send it. Layer B agent
// turns pass least-privilege subsets of these through runChat's optional
// `tools` parameter (bridge 1, ai-agents.md §3.2).
export interface ToolDeclaration {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

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
      "Rank suppliers by risk for the project, computed from procurement (inbound) logistics and node criticality: how many materials each supplier provides, how many of those it is the SOLE source for, its average lead time and total spend, plus any critical-node flag/score. Optionally filter by supplier id.",
    parameters: {
      type: "object",
      properties: {
        supplier: { type: "string", description: "Optional supplier id/name fragment to filter by." },
        top_n: { type: "number", description: "Return only the top N suppliers by risk. Default 10." },
      },
    },
  },
  {
    name: "get_procurement_spend",
    description:
      "Aggregate procurement spend (inbound volume × unit price) for the project, grouped by supplier or material. Useful for top-spend questions and concentration analysis. If the project has no unit prices, falls back to ranking by purchased volume.",
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
      "Identify materials at risk from inbound logistics: number of distinct suppliers (single-sourced = high risk), average lead time, and spend, with criticality enrichment when available. Returns rows ranked by risk.",
    parameters: {
      type: "object",
      properties: {
        material: { type: "string", description: "Optional material id/name fragment to filter on." },
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

// Collect distinct string values of a column for the project (Supabase JS has no DISTINCT).
async function distinctCol(ctx: ToolContext, table: string, col: string): Promise<string[]> {
  const { data, error } = await ctx.supabase
    .from(table)
    .select(col)
    .eq("project_id", ctx.projectId)
    .limit(10000);
  if (error) throw error;
  const set = new Set<string>();
  for (const row of (data ?? []) as Record<string, unknown>[]) {
    const v = row[col];
    if (v != null && String(v).trim() !== "") set.add(String(v));
  }
  return [...set];
}

async function listProjectEntities(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolEnvelope> {
  const entityType = String(args.entity_type ?? "all");
  const limit = clamp(args.limit, 25, 1, 100);
  const want = (t: string) => entityType === "all" || entityType === t;
  const out: Array<{ type: string; id: string; label: string }> = [];

  try {
    // Prefer the canonical node_list (carries node_type) when it has rows.
    const { data: nodes } = await ctx.supabase
      .from("node_list")
      .select("node_id, node_type, node_group")
      .eq("project_id", ctx.projectId)
      .limit(2000);

    if (nodes && nodes.length > 0) {
      for (const n of nodes as Record<string, unknown>[]) {
        const t = String(n.node_type ?? "node").toLowerCase();
        if (want(t)) out.push({ type: t, id: String(n.node_id), label: String(n.node_id) });
      }
    } else {
      // Fall back to the source-of-truth logistics/BOM tables.
      if (want("supplier")) for (const id of await distinctCol(ctx, "inbound_logistics", "supplier_id")) out.push({ type: "supplier", id, label: id });
      if (want("customer")) for (const id of await distinctCol(ctx, "outbound_logistics", "customer_id")) out.push({ type: "customer", id, label: id });
      if (want("material")) {
        const mats = new Set<string>([
          ...await distinctCol(ctx, "inbound_logistics", "material_id"),
          ...await distinctCol(ctx, "bom_multi_level", "material_id").catch(() => []),
        ]);
        for (const id of mats) out.push({ type: "material", id, label: id });
      }
      if (want("product")) for (const id of await distinctCol(ctx, "outbound_logistics", "product_id")) out.push({ type: "product", id, label: id });
      if (want("plant")) for (const id of await distinctCol(ctx, "node_list", "plant_name").catch(() => [])) out.push({ type: "plant", id, label: id });
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

// Shared loader: all inbound procurement rows for the project.
interface InboundRow { supplier_id: string; material_id: string; volume: number; unit_price: number; lead_time: number | null }
async function loadInbound(ctx: ToolContext): Promise<InboundRow[]> {
  const { data, error } = await ctx.supabase
    .from("inbound_logistics")
    .select("supplier_id, material_id, volume, unit_price, lead_time")
    .eq("project_id", ctx.projectId)
    .limit(10000);
  if (error) throw error;
  return (data ?? []).map((r: any) => ({
    supplier_id: String(r.supplier_id ?? "unknown"),
    material_id: String(r.material_id ?? "unknown"),
    volume: Number(r.volume ?? 0) || 0,
    unit_price: Number(r.unit_price ?? 0) || 0,
    lead_time: r.lead_time == null ? null : Number(r.lead_time),
  }));
}

// Map node_id -> critical info, for a given node_type, from node_list.
async function criticalityMap(ctx: ToolContext, nodeType: string): Promise<Map<string, { critical: boolean; score: number | null }>> {
  const map = new Map<string, { critical: boolean; score: number | null }>();
  try {
    const { data } = await ctx.supabase
      .from("node_list")
      .select("node_id, node_type, is_critical_node, critical_node_score")
      .eq("project_id", ctx.projectId)
      .eq("node_type", nodeType)
      .limit(5000);
    for (const n of (data ?? []) as any[]) {
      map.set(String(n.node_id), { critical: Boolean(n.is_critical_node), score: n.critical_node_score == null ? null : Number(n.critical_node_score) });
    }
  } catch { /* enrichment is best-effort */ }
  return map;
}

async function getSupplierRisk(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolEnvelope> {
  const supplier = args.supplier ? String(args.supplier).toLowerCase() : null;
  const topN = clamp(args.top_n, 10, 1, 50);

  try {
    const inbound = await loadInbound(ctx);
    if (inbound.length === 0) return empty("get_supplier_risk");

    // Suppliers per material (to find sole-sourced materials).
    const suppliersByMaterial = new Map<string, Set<string>>();
    for (const r of inbound) {
      if (!suppliersByMaterial.has(r.material_id)) suppliersByMaterial.set(r.material_id, new Set());
      suppliersByMaterial.get(r.material_id)!.add(r.supplier_id);
    }

    interface Agg { materials: Set<string>; leadSum: number; leadN: number; spend: number }
    const agg = new Map<string, Agg>();
    for (const r of inbound) {
      const a = agg.get(r.supplier_id) ?? { materials: new Set(), leadSum: 0, leadN: 0, spend: 0 };
      a.materials.add(r.material_id);
      a.spend += r.volume * r.unit_price;
      if (r.lead_time != null && Number.isFinite(r.lead_time)) { a.leadSum += r.lead_time; a.leadN += 1; }
      agg.set(r.supplier_id, a);
    }

    const crit = await criticalityMap(ctx, "supplier");

    let rows = [...agg.entries()].map(([sid, a]) => {
      const sole = [...a.materials].filter((m) => (suppliersByMaterial.get(m)?.size ?? 0) <= 1).length;
      const c = crit.get(sid);
      return {
        supplier: sid,
        critical: c?.critical ? "Yes" : "-",
        score: c?.score ?? null,
        materials: a.materials.size,
        sole,
        avgLead: a.leadN ? a.leadSum / a.leadN : null,
        spend: a.spend,
      };
    });

    if (supplier) rows = rows.filter((r) => r.supplier.toLowerCase().includes(supplier));
    // Rank: most sole-sourced exposure first, then criticality score, then spend.
    rows.sort((x, y) => y.sole - x.sole || (y.score ?? 0) - (x.score ?? 0) || y.spend - x.spend);
    rows = rows.slice(0, topN);
    if (rows.length === 0) return empty("get_supplier_risk");

    return envelope("get_supplier_risk", "table", {
      columns: ["Supplier", "Critical", "Score", "# Materials", "# Sole-sourced", "Avg Lead Time", "Spend"],
      rows: rows.map((r) => [
        r.supplier,
        r.critical,
        r.score == null ? "-" : Number(r.score.toFixed(3)),
        r.materials,
        r.sole,
        r.avgLead == null ? "-" : Number(r.avgLead.toFixed(1)),
        Math.round(r.spend),
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
    const inbound = await loadInbound(ctx);
    if (inbound.length === 0) return empty("get_procurement_spend");

    const agg = new Map<string, { spend: number; volume: number; orders: number }>();
    for (const r of inbound) {
      const key = groupBy === "supplier" ? r.supplier_id : r.material_id;
      const cur = agg.get(key) ?? { spend: 0, volume: 0, orders: 0 };
      cur.spend += r.volume * r.unit_price;
      cur.volume += r.volume;
      cur.orders += 1;
      agg.set(key, cur);
    }

    const totalSpend = [...agg.values()].reduce((s, v) => s + v.spend, 0);
    const label = groupBy === "supplier" ? "Supplier" : "Material";

    // No price data anywhere → rank by purchased volume instead of spend.
    if (totalSpend === 0) {
      const sorted = [...agg.entries()].sort((a, b) => b[1].volume - a[1].volume).slice(0, topN);
      const totalVol = [...agg.values()].reduce((s, v) => s + v.volume, 0);
      return envelope("get_procurement_spend", "table", {
        columns: [label, "Volume", "Orders", "% of Volume"],
        rows: sorted.map(([k, v]) => [k, Math.round(v.volume), v.orders, totalVol ? `${((v.volume / totalVol) * 100).toFixed(1)}%` : "-"]),
      }, sorted.length, "No unit prices on file — ranked by purchased volume instead of spend.");
    }

    const sorted = [...agg.entries()].sort((a, b) => b[1].spend - a[1].spend).slice(0, topN);
    return envelope("get_procurement_spend", "table", {
      columns: [label, "Spend", "Orders", "% of Total"],
      rows: sorted.map(([k, v]) => [
        k,
        Math.round(v.spend),
        v.orders,
        `${((v.spend / totalSpend) * 100).toFixed(1)}%`,
      ]),
    }, sorted.length, `Total procurement spend across project: ${Math.round(totalSpend)}`);
  } catch (e) {
    console.warn("get_procurement_spend failed:", (e as Error).message);
    return empty("get_procurement_spend");
  }
}

async function getMaterialRisk(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolEnvelope> {
  const material = args.material ? String(args.material).toLowerCase() : null;
  const onlySingle = Boolean(args.only_single_source);
  const topN = clamp(args.top_n, 15, 1, 50);

  try {
    const inbound = await loadInbound(ctx);
    if (inbound.length === 0) return empty("get_material_risk");

    interface Agg { suppliers: Set<string>; leadSum: number; leadN: number; spend: number }
    const agg = new Map<string, Agg>();
    for (const r of inbound) {
      const a = agg.get(r.material_id) ?? { suppliers: new Set(), leadSum: 0, leadN: 0, spend: 0 };
      a.suppliers.add(r.supplier_id);
      a.spend += r.volume * r.unit_price;
      if (r.lead_time != null && Number.isFinite(r.lead_time)) { a.leadSum += r.lead_time; a.leadN += 1; }
      agg.set(r.material_id, a);
    }

    const crit = await criticalityMap(ctx, "material");

    let rows = [...agg.entries()].map(([mid, a]) => ({
      material: mid,
      suppliers: a.suppliers.size,
      single: a.suppliers.size <= 1,
      avgLead: a.leadN ? a.leadSum / a.leadN : null,
      spend: a.spend,
      score: crit.get(mid)?.score ?? null,
    }));

    if (material) rows = rows.filter((r) => r.material.toLowerCase().includes(material));
    if (onlySingle) rows = rows.filter((r) => r.single);
    // Rank: single-sourced first, then longer lead time, then higher spend.
    rows.sort((x, y) =>
      Number(y.single) - Number(x.single) ||
      (y.avgLead ?? 0) - (x.avgLead ?? 0) ||
      y.spend - x.spend
    );
    rows = rows.slice(0, topN);
    if (rows.length === 0) return empty("get_material_risk");

    return envelope("get_material_risk", "table", {
      columns: ["Material", "Suppliers", "Single-source", "Avg Lead Time", "Spend", "Criticality"],
      rows: rows.map((r) => [
        r.material,
        r.suppliers,
        r.single ? "Yes" : "-",
        r.avgLead == null ? "-" : Number(r.avgLead.toFixed(1)),
        Math.round(r.spend),
        r.score == null ? "-" : Number(r.score.toFixed(3)),
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
    // Project-specific playbooks plus the shared system playbooks.
    const { data, error } = await ctx.supabase
      .from("recovery_playbooks")
      .select("name, description, config, is_system, project_id")
      .or(`project_id.eq.${ctx.projectId},is_system.eq.true`)
      .limit(100);
    if (error) throw error;

    const cfgNum = (cfg: any, key: string): number | null => {
      const v = cfg?.[key];
      return v == null || !Number.isFinite(Number(v)) ? null : Number(v);
    };
    let rows = ((data ?? []) as any[]).map((r) => {
      const cfg = r.config ?? {};
      const responses = Array.isArray(cfg.responses) ? cfg.responses : [];
      return {
        name: r.name,
        responses: responses.length ? responses.join(", ") : "—",
        recovery: cfgNum(cfg, "recovery_target_days"),
        cost: cfgNum(cfg, "cost_cap"),
        detection: cfgNum(cfg, "detection_lag_days"),
        description: r.description ?? "",
      };
    });
    // Fastest target recovery first (nulls — e.g. baseline — last).
    rows.sort((a, b) => (a.recovery ?? Number.POSITIVE_INFINITY) - (b.recovery ?? Number.POSITIVE_INFINITY));
    rows = rows.slice(0, 8);

    if (rows.length === 0) {
      // Fall back to generic playbooks so the AI still has something to reason about.
      const generic = genericPlaybooks(disruptionType, magnitude, target);
      return envelope("recommend_disruption_strategy", "bullets", generic, generic.length,
        "No project-specific playbooks found; returning canonical recovery patterns.");
    }

    return envelope("recommend_disruption_strategy", "table", {
      columns: ["Playbook", "Responses", "Target Recovery (d)", "Cost Cap", "Detection Lag (d)"],
      rows: rows.map((r) => [
        r.name,
        r.responses,
        r.recovery ?? "—",
        r.cost ?? "—",
        r.detection ?? "—",
      ]),
    }, rows.length, `Ranked by fastest target recovery for a ${disruptionType || "disruption"}.`);
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

export type ToolHandler = Handler;

/** Registration seam for the staged Layer B tools (ai-agents.md §3.2 bridge 2,
 * §9.2): draftTools.ts registers `get_data_completeness` and the draft_* family
 * here so the shared runChat loop dispatches them through the same
 * executeTool path. Layer A behavior is untouched — the new tools are never in
 * `toolDeclarations`, so no persona turn can call them. */
export function registerToolHandler(name: string, handler: Handler): void {
  handlers[name] = handler;
}

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
