/**
 * §21.4 client resume plumbing (ai-agents.md, Phase H3): resumes are
 * CLIENT-caused turns — no server-side timer, queue, or background
 * continuation exists (D2/Q33). Two triggers post them:
 *
 *  1. the proposal card's approve flow (useProposals.tsx), after the apply
 *     response carries applied_result.run_id and the bound plan step has
 *     been advanced to awaiting_run;
 *  2. the run row's realtime status transition to done/failed (PlanCard's
 *     subscription) — debounced to ONE auto-resume per run id per
 *     transition; further transitions are no-ops.
 *
 * The active chat surface registers a poster per SERVER thread id
 * (useProjectChat); a trigger with no registered poster is a no-op — a
 * closed browser simply delays resume until the user returns (§21.4: the
 * plan and run are server state; nothing is lost).
 */

export type PlanResumePoster = (planId: string) => void | Promise<void>;

const posters = new Map<string, PlanResumePoster>();
const resumedRuns = new Set<string>();

/** Register the chat surface's resume poster for a server thread id.
 * Returns the unregister cleanup. Last registration wins (one visible chat
 * surface per thread). */
export function registerPlanResumePoster(serverThreadId: string, poster: PlanResumePoster): () => void {
  posters.set(serverThreadId, poster);
  return () => {
    if (posters.get(serverThreadId) === poster) posters.delete(serverThreadId);
  };
}

/** Post one resume turn into the thread's chat surface. Returns false when
 * no surface is mounted for that thread (the reload path recovers: the
 * checklist is server state and the next visit resumes). */
export function postPlanResume(serverThreadId: string, planId: string): boolean {
  const poster = posters.get(serverThreadId);
  if (!poster) return false;
  void poster(planId);
  return true;
}

/** §21.4 run resume: ONE debounced auto-resume per run-id transition to
 * done/failed. Safe to call from every realtime event — repeats no-op. */
export function resumeOnRunTransition(runId: string, serverThreadId: string, planId: string): void {
  if (resumedRuns.has(runId)) return;
  resumedRuns.add(runId);
  postPlanResume(serverThreadId, planId);
}

/** Test seam. */
export function _resetPlanResumeState(): void {
  posters.clear();
  resumedRuns.clear();
}
