/**
 * SC Intelligences — unprompted-flag read state (mobile handoff, Unprompted
 * flag).
 *
 * "Raised by this project" proposals (no owning thread — §Root) are the
 * unprompted-flag surface. The dot on the SC Intel tab, the bold unread row
 * and the amber left rule all clear "on read, not on decision" (the flag
 * screen's own note). The proposals table carries no per-user viewed flag the
 * list RPC exposes back to the client (`record_proposal_viewed` is
 * write-only telemetry), so this is tracked client-side — an honest
 * approximation of "seen", scoped to this browser, rather than a fabricated
 * server-backed read receipt.
 */

const KEY = "scIntel.viewedFlags.v1";

function readSet(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(KEY);
    const arr = raw ? (JSON.parse(raw) as string[]) : [];
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

function writeSet(ids: Set<string>) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify([...ids]));
  } catch {
    /* ignore */
  }
}

export function isProposalViewed(id: string): boolean {
  return readSet().has(id);
}

export function markProposalViewed(id: string) {
  const set = readSet();
  if (set.has(id)) return;
  set.add(id);
  writeSet(set);
}

/** Whether any raised (unprompted, thread-less) proposal in this project is
 *  still unread — drives the 6px amber dot on the SC Intel tab icon. */
export function hasUnreadRaisedFlag(
  proposals: Array<{ id: string; project_id: string; thread_id: string | null }>,
  projectId: string | null,
): boolean {
  const viewed = readSet();
  return proposals.some(
    (p) => (!projectId || p.project_id === projectId) && !p.thread_id && !viewed.has(p.id),
  );
}
