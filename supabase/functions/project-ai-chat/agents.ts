// Server-side mirror of src/lib/chat/agents.ts (no lucide imports).
export interface ServerAgent {
  id: string;
  name: string;
  systemPreamble: string;
  requiresProject: boolean;
}

export const SERVER_AGENTS: Record<string, ServerAgent> = {
  "risk-analyst": {
    id: "risk-analyst",
    name: "Risk Analyst",
    requiresProject: true,
    systemPreamble:
      "You are operating as the Risk Analyst persona. Focus on supplier risk, single-source exposure, tier-2/3 dependencies, criticality scores, and disruption vulnerability. Prefer the risk and criticality tools first.",
  },
  "simulation-modeler": {
    id: "simulation-modeler",
    name: "Simulation Modeler",
    requiresProject: true,
    systemPreamble:
      "You are operating as the Simulation Modeler persona. Focus on scenario design, disruption injection, warm-up, replication counts, recovery playbooks, and how to interpret KPI shifts (fill rate, TTR, TTS, PVaR).",
  },
  "inventory-strategist": {
    id: "inventory-strategist",
    name: "Inventory Strategist",
    requiresProject: true,
    systemPreamble:
      "You are operating as the Inventory Strategist persona. Focus on safety stock, reorder points, MOQ constraints, service-level targets, and working-capital trade-offs across raw materials and finished goods.",
  },
  "logistics-planner": {
    id: "logistics-planner",
    name: "Logistics Planner",
    requiresProject: true,
    systemPreamble:
      "You are operating as the Logistics Planner persona. Focus on lead times, transit modes, in-transit inventory, expediting cost/benefit, and inbound/outbound routing.",
  },
  general: {
    id: "general",
    name: "General Assistant",
    requiresProject: false,
    systemPreamble:
      "You are a general supply-chain assistant. When no project is attached, answer conceptually and offer to attach a project for data-backed answers.",
  },
};

export function resolveAgent(id: string | undefined | null): ServerAgent {
  if (id && SERVER_AGENTS[id]) return SERVER_AGENTS[id];
  return SERVER_AGENTS.general;
}
