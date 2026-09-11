/**
 * SC Intelligences — mobile handoff §1/§2/§4.
 *
 * The fixed inventory of five intelligences, plus the bridge between them and
 * the two identity systems the rest of the app already has:
 *
 *   - the CHAT PERSONA picker (`lib/chat/agents.ts` — risk-analyst,
 *     simulation-modeler, inventory-strategist, logistics-planner, general),
 *     which a thread carries as `agentId` and which biases the system prompt;
 *   - the SPECIALIST AGENT roster the server routes to and files proposals
 *     under (`proposals.agent_id` — disruption-sentinel, vv-analyst,
 *     policy-configurator, network-cartographer, data-steward, plus
 *     cost-estimator, experiment-designer, report-builder, none of which
 *     have a badge here).
 *
 * `SC_INTEL[].id` is the specialist agent_id, because that is what
 * `proposals.agent_id` actually stores — filtering "this intelligence's open
 * proposals" (screen 09) or attributing a proposal's badge (screen 02/06/10)
 * needs no translation. A thread with no filed proposal yet has no specialist
 * attribution from the server, so `personaToIntelId` gives its persona the
 * closest of the five badges instead of inventing a sixth.
 */

export interface ScIntel {
  /** = the specialist agent_id proposals.agent_id stores for this intelligence. */
  id: string;
  badge: string;
  name: string;
  remit: string;
  reads: string;
  fg: string;
  bg: string;
}

export const SC_INTEL: ScIntel[] = [
  {
    id: "disruption-sentinel",
    badge: "RA",
    name: "Risk analyst",
    remit: "Finds single-source exposure and ranks it by what it would cost you.",
    reads: "firm graph · disruption schedules",
    fg: "#bf2330",
    bg: "rgba(191,35,48,0.10)",
  },
  {
    id: "vv-analyst",
    badge: "SM",
    name: "Simulation modeller",
    remit: "Reads completed runs and says which strategy actually held up.",
    reads: "runs · KPI series",
    fg: "#0f8c95",
    bg: "rgba(20,184,196,0.12)",
  },
  {
    id: "policy-configurator",
    badge: "PO",
    name: "Policy optimiser",
    remit: "Proposes policy parameter changes; you accept or reject each one.",
    reads: "policies · run outcomes",
    fg: "#6d28d9",
    bg: "rgba(124,58,237,0.12)",
  },
  {
    id: "network-cartographer",
    badge: "NM",
    name: "Network mapper",
    remit: "Answers structural questions across the three lenses and names nexus nodes.",
    reads: "firm · product · process levels",
    fg: "#8a5a06",
    bg: "rgba(224,147,11,0.14)",
  },
  {
    id: "data-steward",
    badge: "DQ",
    name: "Data quality",
    remit: "Explains why a run was rejected and traces each gap to its item master.",
    reads: "item masters · imports",
    fg: "#525252",
    bg: "#f0f0f0",
  },
];

export const DEFAULT_INTEL_ID = "data-steward";

export function getIntel(id: string | null | undefined): ScIntel {
  return SC_INTEL.find((a) => a.id === id) ?? SC_INTEL[SC_INTEL.length - 1];
}

/** Some specialists share a badge (experiment-designer reads like the V&V
 *  analyst's "which strategy held up" remit). Anything ungrouped falls
 *  through to the id-equality check in `getIntel`. */
const SPECIALIST_ALIASES: Record<string, string> = {
  "experiment-designer": "vv-analyst",
};

export function specialistToIntelId(agentId: string | null | undefined): string {
  if (!agentId) return DEFAULT_INTEL_ID;
  const resolved = SPECIALIST_ALIASES[agentId] ?? agentId;
  return SC_INTEL.some((a) => a.id === resolved) ? resolved : DEFAULT_INTEL_ID;
}

/** Legacy persona (`thread.agentId`, from `lib/chat/agents.ts`) → the closest
 *  of the five badges. A thread picks its intelligence through this table
 *  until routing itself carries a specialist id end to end (open, §14.2). */
const PERSONA_TO_INTEL: Record<string, string> = {
  "risk-analyst": "disruption-sentinel",
  "simulation-modeler": "vv-analyst",
  "inventory-strategist": "policy-configurator",
  "logistics-planner": "network-cartographer",
  general: "data-steward",
};

export function personaToIntelId(personaId: string | null | undefined): string {
  if (!personaId) return DEFAULT_INTEL_ID;
  return PERSONA_TO_INTEL[personaId] ?? DEFAULT_INTEL_ID;
}

/** The reverse of `personaToIntelId` — picking an intelligence in the new
 *  composer still has to set the thread's persona, which is what actually
 *  biases the system prompt today (§14.2's open question, not this pass's). */
const INTEL_TO_PERSONA: Record<string, string> = {
  "disruption-sentinel": "risk-analyst",
  "vv-analyst": "simulation-modeler",
  "policy-configurator": "inventory-strategist",
  "network-cartographer": "logistics-planner",
  "data-steward": "general",
};

export function intelToPersonaId(intelId: string): string {
  return INTEL_TO_PERSONA[intelId] ?? "general";
}

/* ── status recipe (§4) — do not improvise ──────────────────────────────── */

export type CredibilityStatus = "validated" | "stale" | "rejected" | "neutral";

export const STATUS: Record<CredibilityStatus, { bg: string; border: string | null; text: string }> = {
  validated: { bg: "rgba(16,185,129,0.10)", border: "rgba(16,185,129,0.30)", text: "#047857" },
  stale: { bg: "rgba(224,147,11,0.12)", border: "rgba(224,147,11,0.30)", text: "#8a5a06" },
  rejected: { bg: "rgba(191,35,48,0.10)", border: "rgba(191,35,48,0.30)", text: "#bf2330" },
  neutral: { bg: "#f0f0f0", border: null, text: "#525252" },
};
