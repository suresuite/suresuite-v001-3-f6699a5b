import type { ChatPart, ChatToolCall } from "@/hooks/useProjectChat";

/**
 * The §17.2 readability grammar (ai-agents.md, v1.2 Phase 2) — the SINGLE
 * source of the per-content-class visual treatment, consumed by MessageBubble
 * and the cards. The invariant the whole system rests on: color encodes the
 * CLASS of content (data / proposal / memory / file / error / activity),
 * never the agent — the grammar must absorb future agents without redesign.
 *
 * Tokens only: everything below is a semantic design-system class (state
 * palette families + the app's surface/border/destructive variables). No hex
 * literals; dark mode variants ride the same tokens.
 */

export type PartClass =
  | "data"      // table / kpi / bullets — slate rail on a surface card
  | "activity"  // tool activity — neutral, collapsed by default
  | "proposal"  // reviewable cards — amber rail
  | "memory"    // memory offers/saves — violet chip
  | "file"      // report/file cards (Phase 3 consumes this) — emerald rail
  | "error"     // errors & refusals — red-tinted card
  | "evidence"  // §22.2 citation list — slate rail, one line per citation
  | "plan";     // §21.2 task-plan checklist — indigo rail (Phase H3)

export interface PartTreatment {
  /** Card container: surface card with the class-colored left rail. */
  card: string;
  /** Accent text (labels, small headings) in the class color. */
  accent: string;
  /** Tinted chip/pill in the class color. */
  chip: string;
  /** Icon tint. */
  icon: string;
}

export const PART_TREATMENTS: Record<PartClass, PartTreatment> = {
  data: {
    card: "rounded-md border border-border border-l-2 border-l-slate-400 bg-surface-elevated dark:border-l-slate-500",
    accent: "text-slate-600 dark:text-slate-400",
    chip: "bg-slate-500/10 text-slate-700 dark:text-slate-300",
    icon: "text-slate-500 dark:text-slate-400",
  },
  activity: {
    card: "rounded-md border border-border bg-surface-elevated",
    accent: "text-muted-foreground",
    chip: "bg-muted text-muted-foreground",
    icon: "text-muted-foreground",
  },
  proposal: {
    card: "rounded-lg border border-border border-l-2 border-l-amber-500 bg-surface-elevated/50 dark:border-l-amber-400",
    accent: "text-amber-700 dark:text-amber-400",
    chip: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
    icon: "text-amber-600 dark:text-amber-400",
  },
  memory: {
    card: "rounded-lg border border-border border-l-2 border-l-violet-500 bg-surface-elevated/50 dark:border-l-violet-400",
    accent: "text-violet-700 dark:text-violet-400",
    chip: "bg-violet-500/10 text-violet-700 dark:text-violet-400",
    icon: "text-violet-600 dark:text-violet-400",
  },
  file: {
    card: "rounded-lg border border-border border-l-2 border-l-emerald-500 bg-surface-elevated/50 dark:border-l-emerald-400",
    accent: "text-emerald-700 dark:text-emerald-400",
    chip: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
    icon: "text-emerald-600 dark:text-emerald-400",
  },
  error: {
    card: "rounded-md border border-destructive/40 border-l-2 border-l-destructive bg-destructive/10",
    accent: "text-destructive",
    chip: "bg-destructive/10 text-destructive",
    icon: "text-destructive",
  },
  // §22.2 (Phase H1): evidence — the reply's numbered source list. Slate like
  // data (it IS the data's provenance), one line per citation, click resolves.
  evidence: {
    card: "rounded-md border border-border border-l-2 border-l-slate-400 bg-surface-elevated dark:border-l-slate-500",
    accent: "text-slate-600 dark:text-slate-400",
    chip: "bg-slate-500/10 text-slate-700 dark:text-slate-300",
    icon: "text-slate-500 dark:text-slate-400",
  },
  // §21.2 (Phase H3): plans — the live task checklist. Indigo, a new content
  // class (agent progress, neither data nor a reviewable mutation); the
  // status word is always printed next to the glyph, and waiting is a
  // visible plan state, never a hung spinner.
  plan: {
    card: "rounded-lg border border-border border-l-2 border-l-indigo-500 bg-surface-elevated/50 dark:border-l-indigo-400",
    accent: "text-indigo-700 dark:text-indigo-400",
    chip: "bg-indigo-500/10 text-indigo-700 dark:text-indigo-400",
    icon: "text-indigo-600 dark:text-indigo-400",
  },
};

/** Tables longer than this collapse to the first rows + "Show all N" (§17.2). */
export const TABLE_COLLAPSE_ROWS = 10;

/** Replies longer than this (~3 screens of chat prose) gain sticky section
 * anchors from their markdown headings (§17.2 turn-level structure). */
export const LONG_REPLY_CHARS = 4500;

/** Artifact type → the drafting agent's display name, for the agent-turn
 * divider ("Data Steward drafted a proposal"). Keyed on artifact_type because
 * that is what the mechanically-attached proposal part carries (§4.5) — the
 * artifact↔agent pairing is 1:1 by the proposals DDL (§4.1). */
export const ARTIFACT_AGENT_NAMES: Record<string, string> = {
  item_master_diff: "Data Steward",
  policy_bundle_diff: "Policy Configurator",
  model_card_draft: "V&V Analyst",
  experiment_spec: "Experiment Designer",
  trace_explanation: "Explainer",
  decision_report: "Report Builder",
  risk_alert: "Disruption Sentinel",
};

export function agentTurnLabel(artifactType: string | undefined): string | null {
  if (!artifactType) return null;
  const name = ARTIFACT_AGENT_NAMES[artifactType];
  return name ? `${name} drafted a proposal` : null;
}

/** Typed error/refusal codes (§4.5 envelopes, §4.2 apply bookkeeping) → the
 * one-line remedy the red-tinted card carries (§17.2 "Errors & refusals"). */
export const ERROR_REMEDIES: Record<string, string> = {
  not_grounded: "Ask again so the agent can re-read the data it cites.",
  stale_values: "The project changed under this draft — ask for a fresh draft against current data.",
  invalid_params: "Rephrase with values the policy schema accepts.",
  dependency_missing: "Provide the named prerequisite first, then ask again.",
  gate_blocked: "Fix the blocking findings in the linked room, then retry.",
  quota_exceeded: "The run quota is reached — retry after current runs finish.",
  forbidden: "Your account lacks the required capability — contact an administrator.",
  too_large: "Reduce open proposals (or split the request) and try again.",
  agent_disabled: "This agent isn't enabled here — contact an administrator.",
};

/** Extract a typed code from an error string shaped "code: detail" when the
 * code is one this platform emits; null otherwise (free-text errors get the
 * red card without a code chip). */
export function typedErrorCode(text: string | null | undefined): string | null {
  if (!text) return null;
  const m = /^([a-z_]+)\s*:/.exec(text.trim());
  return m && m[1] in ERROR_REMEDIES ? m[1] : null;
}

export function errorRemedy(code: string | null): string | null {
  return code ? ERROR_REMEDIES[code] ?? null : null;
}

/**
 * §17.2 "every card carries its source note (meta.tool)": stored parts don't
 * persist the envelope's meta (the golden-transcript contract freezes the
 * server's part shape), so the note is derived client-side by aligning the
 * message's parts to its tool calls — both arrive in call order, and a part
 * is emitted exactly for the calls that returned rows. Alignment is applied
 * only when the counts match exactly; on any ambiguity (mixed/agent turns
 * that drop intermediate parts) every note is null — never a wrong source.
 */
export function partSourceNotes(
  parts: ChatPart[] | undefined,
  toolCalls: ChatToolCall[] | undefined,
): Array<string | null> {
  const list = parts ?? [];
  const toolKinds = new Set(["table", "kpi", "bullets", "text", "proposal"]);
  const toolPartIdx = list
    .map((p, i) => (toolKinds.has(p.kind) ? i : -1))
    .filter((i) => i >= 0);
  const producing = (toolCalls ?? []).filter((c) => c.row_count > 0);
  const notes: Array<string | null> = list.map(() => null);
  if (toolPartIdx.length === 0 || toolPartIdx.length !== producing.length) return notes;
  toolPartIdx.forEach((partIdx, i) => {
    notes[partIdx] = producing[i].name;
  });
  return notes;
}
