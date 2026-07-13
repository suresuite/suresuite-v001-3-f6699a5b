// Interaction modes — Ask / Review (ai-agents.md §15, decision §10 Q23).
//
// Two live positions, per thread, SERVER-enforced at §13.2 checkpoint 2 —
// never a client-side cosmetic. 'auto' does not exist behaviorally: the
// chat_threads.mode CHECK deliberately excludes it (unlocking Auto is a
// migration + a §10 Q6 decision, never a UI change).
//
// Enforcement shape: the router still CLASSIFIES with the full capability-
// resolved agent set (so a blocked mutation ask is detected, named to the
// user, and recorded as mode.blocked_intent — §15 voice: never silently drop
// an intent), then the mode SUBTRACTS at the routing decision: in Ask mode
// only the §15 allowlist ({report-builder}) may execute. Modes only subtract
// capability; they never grant anything §13 doesn't.
//
// Flag: CHAT_MODES_ENABLED (server, §9 conventions). Off ⇒ the switch does
// not render, every thread behaves as 'review', byte-identical to pre-§15
// behavior.

import type { RoutedDecision } from "./router.ts";

export type ChatMode = "ask" | "review";

export const DEFAULT_CHAT_MODE: ChatMode = "review";

/** §15: in Ask mode, router artifact routes are disabled for the turn except
 * report-builder (B6, Phase 3) — rendering a report mutates no project state. */
export const ASK_MODE_AGENT_ALLOWLIST: readonly string[] = ["report-builder"];

export function modesEnabled(): boolean {
  return (Deno.env.get("CHAT_MODES_ENABLED") ?? "").trim().toLowerCase() === "true";
}

export function parseMode(v: unknown): ChatMode | null {
  return v === "ask" || v === "review" ? v : null;
}

// deno-lint-ignore no-explicit-any
type Db = { from(table: string): any };

const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Resolve the mode governing this request (§15 storage contract):
 *  - synced threads: the chat_threads.mode column is the source of truth —
 *    the request body is never trusted over the stored row;
 *  - unsynced/localStorage threads carry the mode in the request body and the
 *    server STILL enforces it;
 *  - anything else (flag off, no thread, malformed) ⇒ 'review' (the DEFAULT —
 *    the shipped v1.1 behavior).
 */
export async function resolveThreadMode(
  db: Db | null,
  threadId: string | null,
  bodyMode: unknown,
): Promise<ChatMode> {
  if (!modesEnabled()) return DEFAULT_CHAT_MODE;
  if (db && threadId && uuidRe.test(threadId)) {
    try {
      const { data } = await db.from("chat_threads").select("mode").eq("id", threadId).maybeSingle();
      const stored = parseMode((data as { mode?: unknown } | null)?.mode);
      if (stored) return stored;
    } catch { /* fall through to the body-carried mode */ }
  }
  return parseMode(bodyMode) ?? DEFAULT_CHAT_MODE;
}

export function modeAllowsAgent(mode: ChatMode, agentId: string): boolean {
  return mode !== "ask" || ASK_MODE_AGENT_ALLOWLIST.includes(agentId);
}

export interface ModeGateResult {
  decision: RoutedDecision;
  /** Set when the mode subtracted a routed agent — the mode.blocked_intent
   * telemetry payload (§15). */
  blocked: { agent_id: string; intent: string | null } | null;
}

/** §13.2 checkpoint 2, mode half: subtract what the mode disallows from an
 * already-classified decision. Advisory routes pass through untouched. */
export function applyModeToRoute(decision: RoutedDecision, mode: ChatMode): ModeGateResult {
  if (decision.route === "advisory" || !decision.agent_id) return { decision, blocked: null };
  if (modeAllowsAgent(mode, decision.agent_id)) return { decision, blocked: null };
  return {
    decision: {
      route: "advisory",
      agent_id: null,
      intent: null,
      confidence: decision.confidence,
      advisory_part: null,
      artifact_part: null,
      short_circuit: "mode_ask",
    },
    blocked: { agent_id: decision.agent_id, intent: decision.intent },
  };
}

/** §15 voice — appended by the SERVER (never the model) when a mutation ask
 * was subtracted, alongside the one-click "Switch to Review" chip part. */
export const MODE_NOTICE_TEXT =
  "You're in Decision Support (Ask) mode, so I won't change anything in the project — " +
  "the answer above is advice only. Switch this thread to Review and ask again to get a " +
  "reviewable proposal.";

export interface ModeNoticeData {
  mode: "ask";
  blocked_agent_id: string;
  blocked_intent: string | null;
  action: "switch_to_review";
  label: string;
}

export function modeNoticePart(blocked: { agent_id: string; intent: string | null }): {
  kind: "mode_notice";
  data: ModeNoticeData;
} {
  return {
    kind: "mode_notice",
    data: {
      mode: "ask",
      blocked_agent_id: blocked.agent_id,
      blocked_intent: blocked.intent,
      action: "switch_to_review",
      label: "Switch to Review",
    },
  };
}
