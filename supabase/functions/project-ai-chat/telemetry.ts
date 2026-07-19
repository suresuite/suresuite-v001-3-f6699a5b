// Typed telemetry writer for ai_chat_events (ai-agents.md §7.1).
// Fire-and-forget with the same never-throws posture as logAiUsage: a failed
// or disabled telemetry write must never affect a chat response. §7.5 privacy
// boundary: ids and lengths only — never message text, emails, or raw args
// (tool arguments are sha256-hashed, not stored).

export type ChatEventKind =
  | "chat.request"
  | "chat.reply"
  | "tool.call"
  | "router.decision"
  | "proposal.created"
  | "proposal.viewed"
  | "proposal.approved"
  | "proposal.rejected"
  | "proposal.applied"
  | "proposal.apply_failed"
  | "proposal.expired"
  // §15 modes + §17.3 suggestions (§16.3 usage-learning kinds; CHECK extended
  // in 20260721000001_chat_modes_and_ui_events.sql):
  | "mode.changed"
  | "mode.blocked_intent"
  | "suggestion.shown"
  | "suggestion.clicked"
  // §16.3 report/file kinds — landed with their Phase-3 surfaces (CHECK
  // extended in 20260723000001_reports_and_file_workspace.sql). file.kept /
  // file.expired are RPC-emitted (set_file_retained / sweep_expired_files);
  // report.rendered / report.downloaded are server-emitted:
  | "report.rendered"
  | "report.downloaded"
  | "file.kept"
  | "file.expired"
  // §22.3 pre-send verifier (Phase H1; CHECK extended in
  // 20260724000001_verifier_event.sql). Payload: violation counts by class +
  // retried flag — ids and counts only, never reply text (§7.5).
  | "verifier.blocked_reply"
  // §21.3 plan lifecycle (Phase H3; CHECK extended in
  // 20260726000001_chat_plans.sql). Payload: plan_id, step counts by status,
  // resume_count — ids and counts only, never step labels (§7.5).
  | "plan.created"
  | "plan.step_changed"
  | "plan.closed";

// Structural client type so this module never imports the supabase-js bundle.
export interface TelemetryDb {
  // deno-lint-ignore no-explicit-any
  from(table: string): any;
}

export interface TelemetryAttribution {
  user_id?: string | null;
  org_id?: string | null;
  project_id?: string | null;
  thread_id?: string | null;
  request_id?: string | null;
  persona_id?: string | null;
  agent_id?: string | null;
  model_code?: string | null;
  provider_code?: string | null;
}

export interface Telemetry {
  enabled: boolean;
  emit(
    kind: ChatEventKind,
    payload?: Record<string, unknown>,
    extra?: { proposal_id?: string | null; latency_ms?: number | null },
  ): Promise<void>;
}

export function telemetryEnabled(): boolean {
  return (Deno.env.get("AGENT_TELEMETRY_ENABLED") ?? "").trim().toLowerCase() === "true";
}

export function makeTelemetry(db: TelemetryDb | null, base: TelemetryAttribution): Telemetry {
  const enabled = telemetryEnabled() && db !== null;
  return {
    enabled,
    async emit(kind, payload = {}, extra = {}) {
      if (!enabled || !db) return;
      try {
        const { error } = await db.from("ai_chat_events").insert({
          user_id: base.user_id ?? null,
          org_id: base.org_id ?? null,
          project_id: base.project_id ?? null,
          thread_id: base.thread_id ?? null,
          request_id: base.request_id ?? null,
          persona_id: base.persona_id ?? null,
          agent_id: base.agent_id ?? null,
          model_code: base.model_code ?? null,
          provider_code: base.provider_code ?? null,
          event_kind: kind,
          proposal_id: extra.proposal_id ?? null,
          payload,
          latency_ms: extra.latency_ms ?? null,
        });
        if (error) console.warn("[telemetry] insert failed:", error?.message ?? error);
      } catch (e) {
        console.warn("[telemetry] emit failed:", e instanceof Error ? e.message : e);
      }
    },
  };
}

/** sha256 hex digest — used to hash tool arguments before logging (§7.5). */
export async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Key-sorted JSON so hashes of semantically equal args are stable. */
export function canonicalJson(value: unknown): string {
  const sort = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sort);
    if (v && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(v as Record<string, unknown>).sort()) {
        out[k] = sort((v as Record<string, unknown>)[k]);
      }
      return out;
    }
    return v;
  };
  return JSON.stringify(sort(value));
}
