// Suggested actions v0 — the guidance engine (ai-agents.md §17.3).
//
// Deterministic, server-computed, capability-filtered. `project-ai-chat`
// mode:"suggest" calls buildSuggestions and returns ≤ 4 suggestions
// {label, utterance, agent_hint, reason}, rendered as chips above the
// composer and as starter prompts on empty threads.
//
// Rule order is FIXED in v0 (DEFAULT): data gaps > validation > decision
// experiments > reports > memory hygiene. Telemetry re-ranking (§16.3)
// replaces rule order only when click data exists.
//
// Honesty rules (§17.3): a suggestion never names an action the caller's
// capabilities can't perform (capability ∩ deployment-flag filtered); it
// never suggests Review-mode actions in an Ask thread without saying
// "switch to Review"; every utterance is a plain sentence the user could
// have typed.
//
// Flag: SUGGESTED_ACTIONS_ENABLED (server, §9 conventions). Off ⇒ no chips,
// no suggest mode, byte-identical pre-§17.3 behavior.

import { loadGateDataset } from "../_shared/validationGate.ts";
import { flattenFindings } from "../_shared/grading.ts";
import { gradeDataset, loadPolicyDefaults } from "../_shared/itemMasterCandidates.ts";
import type { ChatMode } from "./modes.ts";

export function suggestionsEnabled(): boolean {
  return (Deno.env.get("SUGGESTED_ACTIONS_ENABLED") ?? "").trim().toLowerCase() === "true";
}

export const MAX_SUGGESTIONS = 4;

/** v0 rule order (§17.3, DEFAULT) — the array IS the precedence. */
export const SUGGESTION_RULE_ORDER = [
  "data_gaps",
  "validation",
  "experiment",
  "report",
  "memory_hygiene",
] as const;

export type SuggestionRule = (typeof SUGGESTION_RULE_ORDER)[number];

export interface SuggestedAction {
  label: string;
  utterance: string;
  agent_hint: string | null;
  reason: string;
  /** The §17.3 rule that produced it — the telemetry id (§7.5: codes, not text). */
  rule: SuggestionRule;
}

export interface SuggestionCaller {
  /** deployment flags ∩ capability grants, resolved server-side (§13.2). */
  enabledAgents: string[];
  features: Record<string, boolean>;
  isSuper: boolean;
  mode: ChatMode;
  memoryOn: boolean;
}

// deno-lint-ignore no-explicit-any
type Db = { from(table: string): any; rpc(fn: string, args?: Record<string, unknown>): any };

const feature = (caller: SuggestionCaller, key: string): boolean =>
  caller.isSuper || caller.features[key] === true;

/** §17.3 honesty rule: a Review-only action offered in an Ask thread must say
 * "switch to Review". */
function reviewGated(caller: SuggestionCaller, s: SuggestedAction): SuggestedAction {
  if (caller.mode !== "ask") return s;
  return { ...s, reason: `${s.reason} — switch to Review to do this` };
}

/**
 * Compute ≤ 4 suggestions for one project + caller, rule-ordered per §17.3.
 * Deterministic: same project state + same caller ⇒ same chips. Any rule that
 * cannot read its state contributes nothing (a broken read must never take
 * the chat surface down).
 */
export async function buildSuggestions(
  db: Db,
  projectId: string,
  caller: SuggestionCaller,
): Promise<SuggestedAction[]> {
  const out: SuggestedAction[] = [];
  const canDraft = feature(caller, "agent_proposals");

  // Shared state reads (each guarded; used by several rules).
  let gapCount = 0;
  try {
    if (caller.enabledAgents.includes("data-steward") && canDraft) {
      const [dataset, defaults] = await Promise.all([
        loadGateDataset(db, projectId),
        loadPolicyDefaults(db, projectId),
      ]);
      // Every graded finding is the Steward's value surface — including the
      // info-severity derivable fields ("cost is derived via cheapest
      // inbound"), which are exactly the gaps the §17.3 example names.
      gapCount = flattenFindings(gradeDataset(dataset, defaults)).length;
    }
  } catch { /* rule contributes nothing */ }

  let doneRuns = 0;
  try {
    const { data } = await db
      .from("simulation_runs")
      .select("id,status")
      .eq("project_id", projectId)
      .eq("status", "done")
      .limit(1);
    doneRuns = Array.isArray(data) ? data.length : 0;
  } catch { /* rule contributes nothing */ }

  let hasActiveValidatedCard = false;
  try {
    const { data: cards } = await db.rpc("list_model_validations", { p_project_id: projectId });
    hasActiveValidatedCard = (Array.isArray(cards) ? cards : []).some(
      (c: Record<string, unknown>) => c.status === "active" && c.verdict === "validated",
    );
  } catch { /* rule contributes nothing */ }

  let savedVersions = 0;
  try {
    const { data } = await db.from("policy_versions").select("id").eq("project_id", projectId).limit(1);
    savedVersions = Array.isArray(data) ? data.length : 0;
  } catch { /* rule contributes nothing */ }

  // 1 — data gaps (§17.3 rule 1).
  if (gapCount > 0) {
    out.push(reviewGated(caller, {
      rule: "data_gaps",
      label: `Fill ${gapCount} missing data ${gapCount === 1 ? "field" : "fields"} — I'll draft the values`,
      utterance: "Fill in the missing item-master data for me",
      agent_hint: "data-steward",
      reason: `The data-completeness grader found ${gapCount} ${gapCount === 1 ? "gap" : "gaps"} that block or degrade runs`,
    }));
  }

  // 2 — validation (§17.3 rule 2): evidence exists but no active validated card.
  if (
    caller.enabledAgents.includes("vv-analyst") && canDraft &&
    doneRuns > 0 && !hasActiveValidatedCard
  ) {
    out.push(reviewGated(caller, {
      rule: "validation",
      label: "Your model isn't validated — adopt the evidence",
      utterance: "Adopt the validation evidence from my latest completed run",
      agent_hint: "vv-analyst",
      reason: "A completed run exists but no active validated model card governs the Lab",
    }));
  }

  // 3 — decision experiments (§17.3 rule 3): a saved version to bind.
  if (caller.enabledAgents.includes("experiment-designer") && canDraft && savedVersions > 0) {
    let supplier: string | null = null;
    try {
      // Deterministic top-risk pick: the supplier sole-sourcing the most
      // materials (the get_supplier_risk ranking's leading term); ties and
      // no-inbound projects fall back to the first supplier id.
      const { data: inbound } = await db
        .from("inbound_logistics")
        .select("supplier_id,material_id")
        .eq("project_id", projectId);
      const rows = (inbound ?? []) as Array<{ supplier_id: string; material_id: string }>;
      const materialSuppliers = new Map<string, Set<string>>();
      for (const r of rows) {
        if (!materialSuppliers.has(r.material_id)) materialSuppliers.set(r.material_id, new Set());
        materialSuppliers.get(r.material_id)!.add(String(r.supplier_id));
      }
      const soleCounts = new Map<string, number>();
      for (const suppliers of materialSuppliers.values()) {
        if (suppliers.size === 1) {
          const s = [...suppliers][0];
          soleCounts.set(s, (soleCounts.get(s) ?? 0) + 1);
        }
      }
      supplier = [...soleCounts.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null;
      if (!supplier) {
        const { data: sup } = await db
          .from("suppliers")
          .select("supplier_id")
          .eq("project_id", projectId)
          .limit(50);
        const ids = ((sup ?? []) as Array<{ supplier_id: string }>).map((s) => String(s.supplier_id)).sort();
        supplier = ids[0] ?? null;
      }
    } catch { /* falls back to the generic phrasing */ }
    out.push(reviewGated(caller, {
      rule: "experiment",
      label: supplier ? `Stress-test an outage of supplier ${supplier}` : "Stress-test a disruption with a simulation",
      utterance: supplier
        ? `Test a 6-week outage of supplier ${supplier} with 30 replications`
        : "Set up a disruption stress-test run on my saved policy version",
      agent_hint: "experiment-designer",
      reason: supplier
        ? `${supplier} is your most single-sourced supplier and a saved policy version is ready to bind`
        : "A saved policy version is ready to bind to a scenario run",
    }));
  }

  // 4 — reports (§17.3 rule 4): B6 ships in Phase 3; the capability filter
  // keeps this rule silent until report-builder exists in the enabled set.
  if (caller.enabledAgents.includes("report-builder") && feature(caller, "reports")) {
    out.push({
      rule: "report",
      label: "Generate a risk-posture report for this project",
      utterance: "Generate a risk-posture report for this project",
      agent_hint: "report-builder",
      reason: "Reports turn the project's persisted data and runs into a document you can circulate",
    });
  }

  // 5 — memory hygiene (§17.3 rule 5): an applied decision worth remembering.
  if (caller.memoryOn && feature(caller, "project_memory")) {
    try {
      const { data } = await db
        .from("proposals")
        .select("id,title,status")
        .eq("project_id", projectId)
        .eq("status", "applied")
        .order("applied_at", { ascending: false })
        .limit(1);
      const applied = ((data ?? []) as Array<{ title: string }>)[0];
      if (applied) {
        out.push({
          rule: "memory_hygiene",
          label: "Save this decision to project memory",
          utterance: `Remember that we applied "${String(applied.title).slice(0, 120)}"`,
          agent_hint: null,
          reason: "An applied change is the decision most worth keeping — memory is cited whenever it grounds later work",
        });
      }
    } catch { /* rule contributes nothing */ }
  }

  return out.slice(0, MAX_SUGGESTIONS);
}
