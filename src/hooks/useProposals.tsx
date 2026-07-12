import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

/**
 * Proposal fabric client hooks (ai-agents.md §4.6): fetch via the
 * list_agent_proposals RPC (which lazily expires stale cards), live updates
 * via the realtime publication on public.proposals, actions via
 * review_agent_proposal + the agent-apply edge function (Stage 1).
 */

export type ProposalStatus = "draft" | "proposed" | "approved" | "applied" | "rejected" | "expired";

export interface Proposal {
  id: string;
  project_id: string;
  agent_id: string;
  artifact_type: string;
  schema_version: number;
  title: string;
  payload: Record<string, unknown>;
  citations: Array<Record<string, unknown>>;
  provenance: "deterministic" | "llm_drafted" | "user_supplied";
  grounding: Record<string, unknown>;
  status: ProposalStatus;
  status_reason: string | null;
  expires_at: string;
  apply_attempts: number;
  apply_error: string | null;
  applied_result: Record<string, unknown> | null;
  applied_at: string | null;
  thread_id: string | null;
  model_code: string | null;
  provider_code: string | null;
  created_by: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Apply retry cap — after this many failed applies the card offers Reject
 * only (DEFAULT 3, ai-agents.md §4.2). */
export const APPLY_RETRY_CAP = 3;

// The proposals table/RPCs postdate the generated supabase types.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

interface ProposalActions {
  approve: (id: string) => Promise<string | null>;
  reject: (id: string, note?: string) => Promise<string | null>;
  retryApply: (id: string) => Promise<string | null>;
  recordViewed: (id: string) => void;
}

function useProposalActions(onChanged?: () => void): ProposalActions & { applyingIds: Set<string> } {
  const { user } = useAuth();
  const [applyingIds, setApplyingIds] = useState<Set<string>>(new Set());
  const viewedRef = useRef<Set<string>>(new Set());

  const invokeApply = useCallback(async (id: string): Promise<string | null> => {
    setApplyingIds((prev) => new Set(prev).add(id));
    try {
      // agent-apply ships in Stage 1; until then approved cards simply wait.
      const { data, error } = await db.functions.invoke("agent-apply", {
        body: { proposalId: id, userId: user?.id, userEmail: user?.email },
      });
      if (error) return error.message ?? "Apply failed.";
      if (data?.error) return String(data.error);
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : "Apply failed.";
    } finally {
      setApplyingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      onChanged?.();
    }
  }, [user?.id, user?.email, onChanged]);

  const approve = useCallback(async (id: string): Promise<string | null> => {
    const { error } = await db.rpc("review_agent_proposal", {
      p_proposal_id: id,
      p_action: "approve",
      p_user_id: user?.id ?? null,
      p_user_email: user?.email ?? null,
    });
    if (error) return error.message ?? "Approve failed.";
    onChanged?.();
    // §4.2: approval immediately POSTs agent-apply.
    return invokeApply(id);
  }, [user?.id, user?.email, invokeApply, onChanged]);

  const reject = useCallback(async (id: string, note?: string): Promise<string | null> => {
    const { error } = await db.rpc("review_agent_proposal", {
      p_proposal_id: id,
      p_action: "reject",
      p_user_id: user?.id ?? null,
      p_user_email: user?.email ?? null,
      p_note: note ?? null,
    });
    onChanged?.();
    return error ? error.message ?? "Reject failed." : null;
  }, [user?.id, user?.email, onChanged]);

  const retryApply = useCallback((id: string) => invokeApply(id), [invokeApply]);

  const recordViewed = useCallback((id: string) => {
    if (viewedRef.current.has(id)) return;
    viewedRef.current.add(id);
    db.rpc("record_proposal_viewed", { p_proposal_id: id, p_user_id: user?.id ?? null })
      .then(({ error }: { error: { message: string } | null }) => {
        if (error) console.warn("[proposals] view event failed:", error.message);
      });
  }, [user?.id]);

  return { approve, reject, retryApply, recordViewed, applyingIds };
}

/** All proposals of one project (list RPC + realtime refresh). */
export function useProposals(projectId: string | null) {
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!projectId) { setProposals([]); return; }
    setLoading(true);
    try {
      const { data, error } = await db.rpc("list_agent_proposals", { p_project_id: projectId });
      if (!error && Array.isArray(data)) setProposals(data as Proposal[]);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    if (!projectId) return;
    const channel = db
      .channel(`proposals-${projectId}`)
      .on("postgres_changes",
        { event: "*", schema: "public", table: "proposals", filter: `project_id=eq.${projectId}` },
        () => refresh())
      .subscribe();
    return () => { db.removeChannel(channel); };
  }, [projectId, refresh]);

  const actions = useProposalActions(refresh);
  return { proposals, loading, refresh, ...actions };
}

/** One proposal by id — what a ProposalCard anchored in a thread renders.
 * Live-updates on realtime status changes, including from another tab (§4.6). */
export function useProposal(proposalId: string | null) {
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [loading, setLoading] = useState(Boolean(proposalId));

  const refresh = useCallback(async () => {
    if (!proposalId) { setProposal(null); return; }
    const { data, error } = await db
      .from("proposals").select("*").eq("id", proposalId).maybeSingle();
    if (!error) setProposal((data as Proposal) ?? null);
    setLoading(false);
  }, [proposalId]);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    if (!proposalId) return;
    const channel = db
      .channel(`proposal-${proposalId}`)
      .on("postgres_changes",
        { event: "UPDATE", schema: "public", table: "proposals", filter: `id=eq.${proposalId}` },
        (payload: { new: Proposal }) => setProposal(payload.new))
      .subscribe();
    return () => { db.removeChannel(channel); };
  }, [proposalId]);

  const actions = useProposalActions(refresh);
  const applying = proposalId ? actions.applyingIds.has(proposalId) : false;
  return { proposal, loading, refresh, applying, ...actions };
}
