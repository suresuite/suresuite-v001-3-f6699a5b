// Intent router — the SEAM lands in Stage 0, classification activates in
// Stage 1 (ai-agents.md §6). With AGENT_ROUTER_ENABLED unset/false every
// message routes "advisory" without any LLM call, which restores Layer A
// byte-for-byte (§3.3). All fallbacks/tie-breaks below are deterministic and
// unit-tested in eval/ (§6.5 tier 1).

export type Route = "advisory" | "artifact" | "mixed";

export interface RouteDecision {
  route: Route;
  agent_id:
    | "data-steward"
    | "policy-configurator"
    | "vv-analyst"
    | "experiment-designer"
    | "explainer"
    | null; // null for advisory
  intent: string | null; // the §5 intent label, e.g. "steward.fill_missing"
  confidence: number; // [0,1]
  advisory_part: string | null; // for mixed: the question portion, verbatim
  artifact_part: string | null; // for mixed: the actionable portion, verbatim
}

export interface RouterContext {
  personaId: string | null;
  hasProject: boolean;
  enabledAgents: string[];
  modelId: string;
}

/** The route decision plus why it was (or wasn't) short-circuited — the
 * router.decision telemetry payload shape (§7.1). */
export interface RoutedDecision extends RouteDecision {
  short_circuit: string | null;
}

/** One classification call through the session's own model (bridge 1 loop,
 * 0 tool hops, temperature 0, ≤300 output tokens — §6.2 step 2). Stage 0
 * ships no implementation; Stage 1 wires it. Tests inject mocks. */
export type ClassifierCall = (prompt: string) => Promise<string>;

export const ROUTER_CONFIDENCE_MIN = 0.70; // DEFAULT (§6.2 step 3)

// §6.2 step 4 tie-break: dependency order — upstream artifacts first.
export const AGENT_PRECEDENCE = [
  "data-steward",
  "policy-configurator",
  "vv-analyst",
  "experiment-designer",
  "explainer",
] as const;

export type AgentSlug = (typeof AGENT_PRECEDENCE)[number];

// One line per agent: slug + the §5 mission sentence; the classification
// prompt's agent list and the tie-break instruction are the same fact (§6.3).
export const AGENT_ROSTER: Record<AgentSlug, { mission: string; intents: string[] }> = {
  "data-steward": {
    mission:
      "completes and corrects item-master data (materials, products, suppliers) as reviewable diffs",
    intents: ["steward.fill_missing", "steward.explain_gaps", "steward.correct_values"],
  },
  "policy-configurator": {
    mission:
      "turns natural-language intent into a reviewable policy-configuration change (defaults + overrides)",
    intents: ["policy.configure", "policy.intent_to_bundle", "policy.run_ready"],
  },
  "vv-analyst": {
    mission:
      "interprets verification & validation evidence and drafts model-validation cards",
    intents: ["vv.interpret", "vv.adopt", "vv.next_steps"],
  },
  "experiment-designer": {
    mission:
      "compiles decision questions into reviewable, gate-checked experiment specifications",
    intents: ["exp.design", "exp.brief"],
  },
  explainer: {
    mission:
      "answers \"why did the model do that?\" from recorded decision traces with mandatory citations",
    intents: ["explain.decision", "explain.policy_effect"],
  },
};

export function routerEnabled(): boolean {
  return (Deno.env.get("AGENT_ROUTER_ENABLED") ?? "").trim().toLowerCase() === "true";
}

/** Deployment-wide kill switch: AGENT_ENABLED_IDS comma list (§9.2). */
export function deploymentEnabledAgents(): string[] {
  const raw = Deno.env.get("AGENT_ENABLED_IDS") ?? "";
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => (AGENT_PRECEDENCE as readonly string[]).includes(s));
}

const ADVISORY: RouteDecision = {
  route: "advisory",
  agent_id: null,
  intent: null,
  confidence: 0,
  advisory_part: null,
  artifact_part: null,
};

function advisory(short_circuit: string | null): RoutedDecision {
  return { ...ADVISORY, short_circuit };
}

/** §6.3 classification prompt, verbatim template. */
export function buildClassifierPrompt(message: string, enabledAgents: string[]): string {
  const ordered = AGENT_PRECEDENCE.filter((a) => enabledAgents.includes(a));
  const agentLines = ordered.map((a) => `- "${a}": ${AGENT_ROSTER[a].mission}`).join("\n");
  const intentLabels = ordered.flatMap((a) => AGENT_ROSTER[a].intents).join(", ");
  return `You are an intent classifier for a supply-chain platform assistant.
Classify the USER MESSAGE into exactly one route.

Routes:
- "advisory": the user wants an answer or analysis.
- "artifact": the user wants a change made or a formal artifact produced.
- "mixed": the message contains both.

If artifact or mixed, pick exactly ONE owner from this list (these are the
ONLY valid agent ids):
${agentLines}
When more than one could own it, prefer the earliest in the list order given.

Also pick the closest intent label from: ${intentLabels}

Reply with ONLY a JSON object, no prose:
{"route": "...", "agent_id": "... or null", "intent": "... or null",
 "confidence": 0.0-1.0,
 "advisory_part": "... or null", "artifact_part": "... or null"}

USER MESSAGE:
${message}`;
}

/** Strict parse of the classifier reply (§6.2 steps 3–4). Returns null on any
 * malformation — the caller falls back to advisory. If the model disobeys and
 * returns an array, the first valid element wins (tie-break rule). */
export function parseClassifierResponse(raw: string): RouteDecision | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.trim());
  } catch {
    // tolerate a fenced code block around the JSON, nothing else
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try {
      parsed = JSON.parse(m[0]);
    } catch {
      return null;
    }
  }
  const candidates = Array.isArray(parsed) ? parsed : [parsed];
  for (const c of candidates) {
    const d = validateDecision(c);
    if (d) return d;
  }
  return null;
}

function validateDecision(c: unknown): RouteDecision | null {
  if (!c || typeof c !== "object") return null;
  const o = c as Record<string, unknown>;
  const route = o.route;
  if (route !== "advisory" && route !== "artifact" && route !== "mixed") return null;
  const agentId = o.agent_id ?? null;
  if (agentId !== null && !(AGENT_PRECEDENCE as readonly string[]).includes(String(agentId))) return null;
  if ((route === "artifact" || route === "mixed") && agentId === null) return null;
  const confidence = typeof o.confidence === "number" ? o.confidence : Number(o.confidence);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) return null;
  return {
    route,
    agent_id: (agentId as RouteDecision["agent_id"]) ?? null,
    intent: typeof o.intent === "string" ? o.intent : null,
    confidence,
    advisory_part: typeof o.advisory_part === "string" ? o.advisory_part : null,
    artifact_part: typeof o.artifact_part === "string" ? o.artifact_part : null,
  };
}

/**
 * The §6.2 decision function: deterministic wrapper around one (injected)
 * LLM classification call. Returns the decision plus the short-circuit reason
 * for the router.decision telemetry event. Never throws.
 */
export async function decideRoute(
  message: string,
  ctx: RouterContext,
  classify?: ClassifierCall | null,
): Promise<RoutedDecision> {
  if (!routerEnabled()) return advisory("router_disabled");
  if (ctx.enabledAgents.length === 0) return advisory("no_enabled_agents");
  if (!ctx.hasProject) return advisory("no_project");
  if (!classify) return advisory("classifier_unavailable"); // Stage 0: no classifier is wired

  const clamped = String(message).slice(0, 4000); // same clamp as chat (§6.2 step 1)
  let raw: string;
  try {
    raw = await classify(buildClassifierPrompt(clamped, ctx.enabledAgents));
  } catch {
    return advisory("classifier_error");
  }
  const decision = parseClassifierResponse(raw);
  if (!decision) return advisory("parse_failure");
  if (decision.route === "advisory") return { ...decision, agent_id: null, short_circuit: null };
  if (!decision.agent_id || !ctx.enabledAgents.includes(decision.agent_id)) {
    return advisory("agent_not_enabled");
  }
  if (decision.confidence < ROUTER_CONFIDENCE_MIN) return advisory("low_confidence");
  return { ...decision, short_circuit: null };
}

/** §6.1 contract. Delegates to decideRoute; the telemetry-only
 * short_circuit field is stripped. */
export async function classifyIntent(
  message: string,
  ctx: RouterContext,
  classify?: ClassifierCall | null,
): Promise<RouteDecision> {
  const { short_circuit: _sc, ...decision } = await decideRoute(message, ctx, classify);
  return decision;
}
