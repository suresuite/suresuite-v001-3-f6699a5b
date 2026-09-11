/**
 * SC Intelligences — mobile entry point (handoff, all 11 screens).
 *
 * Retires the old MobileIntelligence tree's always-composer chat for a
 * pushed-view flow: a root (02) plus five push targets, each a real route
 * under /project-intelligence/* so `mobileRootRoutes.ts` can hide the tab bar
 * on every one of them the same way it already does for AdminUserAccess.
 * Two of the eleven screens (04 attach, 07 sources) are sheets rather than
 * routes — they never need a back arrow of their own.
 */
import * as React from "react";
import { Routes, Route, Navigate, useNavigate, useParams, useLocation } from "react-router-dom";
import { toast } from "sonner";
import type { Thread } from "@/hooks/useChatThreads";
import { useProposals } from "@/hooks/useProposals";
import { Root } from "./screens/Root";
import { NewQuestion } from "./screens/NewQuestion";
import { ThreadScreen } from "./screens/Thread";
import { Roster } from "./screens/Roster";
import { IntelligenceDetail } from "./screens/IntelligenceDetail";
import { ProposalScreen } from "./screens/ProposalScreen";
import type { AttachedItem } from "./screens/AttachContextSheet";
import { intelToPersonaId } from "./intel";

export interface ScIntelMobileProps {
  projects: Array<{ id: string; name: string }>;
  projectId: string | null;
  onProjectChange: (id: string | null) => void;
  threads: Thread[];
  model: string;
  newThread: (opts?: { projectId?: string | null; agentId?: string | null }) => string;
  updateThread: (id: string, patch: Partial<Thread>) => void;
}

/** Folds an attach-context selection into the outgoing question as a plain
 *  context header — there is no separate context-payload field on the chat
 *  API today, so this is the honest way to make an attachment actually
 *  affect the answer rather than just decorate the composer. */
function withAttachedContext(text: string, attached: AttachedItem[]): string {
  if (attached.length === 0) return text;
  return `Context: ${attached.map((a) => a.label).join(", ")}\n\n${text}`;
}

export function ScIntelMobile({
  projects,
  projectId,
  onProjectChange,
  threads,
  model,
  newThread,
  updateThread,
}: ScIntelMobileProps) {
  const navigate = useNavigate();
  const { proposals } = useProposals(projectId);

  return (
    <Routes>
      <Route
        index
        element={
          <Root
            projects={projects}
            projectId={projectId}
            onProjectChange={onProjectChange}
            threads={threads}
            proposals={proposals}
            onOpenNew={() => navigate("new")}
            onOpenThread={(id) => navigate(`thread/${id}`)}
            onOpenRoster={() => navigate("roster")}
            onOpenProposal={(id) => navigate(`proposal/${id}`)}
          />
        }
      />

      <Route
        path="new"
        element={
          <NewQuestionRoute
            projectId={projectId}
            onSend={(text, intelId, attached) => {
              const id = newThread({ projectId, agentId: intelToPersonaId(intelId) });
              navigate(`/project-intelligence/thread/${id}`, {
                replace: true,
                state: { initialMessage: withAttachedContext(text, attached) },
              });
            }}
          />
        }
      />

      <Route
        path="thread/:threadId"
        element={
          <ThreadRoute
            threads={threads}
            model={model}
            updateThread={updateThread}
            onOpenProposal={(id) => navigate(`/project-intelligence/proposal/${id}`)}
            onHandOff={(intelId) => navigate("/project-intelligence/new", { state: { defaultIntelId: intelId } })}
          />
        }
      />

      <Route path="roster" element={<Roster onBack={() => navigate(-1)} onOpen={(id) => navigate(`roster/${id}`)} />} />

      <Route
        path="roster/:agentId"
        element={<IntelligenceDetailRoute proposals={proposals} navigate={navigate} />}
      />

      <Route
        path="proposal/:proposalId"
        element={
          <ProposalRoute
            navigate={navigate}
          />
        }
      />

      <Route path="*" element={<Navigate to="/project-intelligence" replace />} />
    </Routes>
  );
}

function NewQuestionRoute({
  projectId,
  onSend,
}: {
  projectId: string | null;
  onSend: (text: string, intelId: string, attached: AttachedItem[]) => void;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const defaultIntelId = (location.state as { defaultIntelId?: string } | null)?.defaultIntelId;
  return (
    <NewQuestion
      projectId={projectId}
      defaultIntelId={defaultIntelId}
      onBack={() => navigate("/project-intelligence")}
      onSend={onSend}
    />
  );
}

function ThreadRoute({
  threads,
  model,
  updateThread,
  onOpenProposal,
  onHandOff,
}: {
  threads: Thread[];
  model: string;
  updateThread: (id: string, patch: Partial<Thread>) => void;
  onOpenProposal: (id: string) => void;
  onHandOff: (intelId: string) => void;
}) {
  const { threadId } = useParams<{ threadId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const thread = threads.find((t) => t.id === threadId);
  const initialMessage = (location.state as { initialMessage?: string } | null)?.initialMessage ?? null;

  if (!threadId) return <Navigate to="/project-intelligence" replace />;

  return (
    <ThreadScreen
      threadId={threadId}
      thread={thread}
      model={model}
      onBack={() => navigate("/project-intelligence")}
      initialMessage={initialMessage}
      onConsumeInitialMessage={() => navigate(".", { replace: true, state: null })}
      onOpenProposal={onOpenProposal}
      onHandOff={(intelId) => {
        if (thread) updateThread(thread.id, { agentId: intelToPersonaId(intelId) });
        onHandOff(intelId);
      }}
    />
  );
}

function IntelligenceDetailRoute({
  proposals,
  navigate,
}: {
  proposals: ReturnType<typeof useProposals>["proposals"];
  navigate: ReturnType<typeof useNavigate>;
}) {
  const { agentId } = useParams<{ agentId: string }>();
  if (!agentId) return <Navigate to="/project-intelligence/roster" replace />;
  return (
    <IntelligenceDetail
      intelId={agentId}
      proposals={proposals}
      onBack={() => navigate(-1)}
      onAsk={() => navigate("/project-intelligence/new", { state: { defaultIntelId: agentId } })}
      onOpenProposal={(id) => navigate(`/project-intelligence/proposal/${id}`)}
    />
  );
}

function ProposalRoute({ navigate }: { navigate: ReturnType<typeof useNavigate> }) {
  const { proposalId } = useParams<{ proposalId: string }>();
  if (!proposalId) return <Navigate to="/project-intelligence" replace />;
  return (
    <ProposalScreen
      proposalId={proposalId}
      onBack={() => navigate(-1)}
      onRejected={() => navigate(-1)}
      onAccepted={(versionLabel) => {
        // The apply already wrote the new policy version (agent-apply →
        // apply_policy_bundle); the Lab root's own policy-version panel and
        // run queue (already built — policyVersionLabel/onSaveVersionAndRun)
        // pick it up live, which is exactly the "saved-version panel + queue
        // row" screen 11 asks for. Nothing new to build there, so this just
        // lands the loop back in the product instead of a toast over the
        // proposal (§8).
        toast.success(`Saved ${versionLabel}. Queue a run from the Lab.`);
        navigate("/simulation-lab");
      }}
    />
  );
}
