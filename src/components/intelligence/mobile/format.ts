/** Small formatting helpers shared across the SC Intelligences mobile screens. */
import type { AttachedItem } from "./screens/AttachContextSheet";

/** Folds an attach-context selection into the outgoing question as a plain
 *  context header — there is no separate context-payload field on the chat
 *  API today, so this is the honest way to make an attachment actually
 *  affect the answer rather than just decorate the composer. */
export function withAttachedContext(text: string, attached: AttachedItem[]): string {
  if (attached.length === 0) return text;
  return `Context: ${attached.map((a) => a.label).join(", ")}\n\n${text}`;
}

const CONTEXT_PREFIX_RE = /^Context: (.+)\n\n([\s\S]*)$/;

/** The inverse of `withAttachedContext`, for rendering a sent turn (§6.1):
 *  the attached-context line renders as its own mono line beneath the
 *  bubble rather than inside the question's own prose. */
export function splitAttachedContext(content: string): { context: string | null; text: string } {
  const m = content.match(CONTEXT_PREFIX_RE);
  if (!m) return { context: null, text: content };
  return { context: m[1], text: m[2] };
}

/** "2h", "3d" — the root's Open-section elapsed mark (§5.2). */
export function formatElapsed(fromMs: number, nowMs: number = Date.now()): string {
  const ms = Math.max(0, nowMs - fromMs);
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

/** A version transition label ("v12 → v13") from a 1-based ordinal — the
 *  handoff's numbering convention for a project's saved policy versions,
 *  since `PolicyVersion` carries no numeric field of its own. `versions` is
 *  expected newest-first (as `usePolicies` returns it). */
export function versionOrdinal(versions: Array<{ id: string }>, versionId: string | null): number | null {
  if (!versionId) return null;
  const idx = versions.findIndex((v) => v.id === versionId);
  if (idx === -1) return null;
  // Oldest = v1: the last element of a newest-first list.
  return versions.length - idx;
}
