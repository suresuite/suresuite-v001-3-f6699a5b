/**
 * SC Intelligences — mobile entry point (handoff, thread/proposal-inbox/
 * handoff-trace/unprompted-flag/chat-management pass).
 *
 * Retires the old MobileIntelligence tree's always-composer chat for a
 * pushed-view flow: a root plus push targets, each a real route under
 * /project-intelligence/* so `mobileRootRoutes.ts` can hide the tab bar on
 * every one of them the same way it already does for AdminUserAccess.
 * Sheets (attach, sources, intelligence & model, thread actions, rename)
 * never need a back arrow of their own and are not routes.
 */
import * as React from "react";
import { Routes, Route, Navigate, useNavigate, useParams, useLocation } from "react-router-dom";
import { toast } from "sonner";
import type { Thread, ChatFolder } from "@/hooks/useChatThreads";
import { useProposals } from "@/hooks/useProposals";
import type { UserFile, MemoryEntry } from "../SidebarPanels";
import { Root } from "./screens/Root";
import { NewQuestion } from "./screens/NewQuestion";
import { ThreadScreen } from "./screens/Thread";
import { Roster } from "./screens/Roster";
import { IntelligenceDetail } from "./screens/IntelligenceDetail";
import { ProposalScreen } from "./screens/ProposalScreen";
import { AllProposals } from "./screens/AllProposals";
import { FlagScreen } from "./screens/FlagScreen";
import { HandoffTraceScreen } from "./screens/HandoffTrace";
import { ChatsScreen } from "./screens/ChatsScreen";
import { FilesMemoryScreen } from "./screens/FilesMemoryScreen";
import type { AttachedItem } from "./screens/AttachContextSheet";
import { intelToPersonaId } from "./intel";
import { withAttachedContext } from "./format";
import { markProposalViewed } from "./viewedFlags";

/** The mobile Chats screen's own prop set — the same shape
 * `ProjectIntelligence.tsx`'s `sidebarProps` already exposes for the desktop
 * `ChatSidebar`, minus the desktop-only selection/collapse concerns a pushed
 * mobile screen has no use for. */
export interface ChatManagementBundle {
  folders: ChatFolder[];
  onCreateFolder: (name: string) => void;
  onDeleteFolder: (id: string) => void;
  onMoveToFolder: (threadId: string, folderId: string | null) => void;
  onDeleteThread: (id: string) => void;
  onRenameThread: (id: string, title: string) => void;
  onAttachProject: (id: string, projectId: string | null) => void;
  onTogglePin: (threadId: string, pinned: boolean) => void;
  onToggleArchive: (threadId: string, archived: boolean) => void;
  onBulkSetFlags: (ids: string[], flags: { pinned?: boolean | null; archived?: boolean | null }) => void;
  onBulkDelete: (ids: string[]) => void;
  memoryEnabled: boolean;
  memoryProjectId: string | null;
  filesEnabled: boolean;
  files: UserFile[];
  memoryEntries: MemoryEntry[];
  onDownloadFile: (id: string) => void;
  onKeepFile: (id: string) => void;
  onAddMemory: (content: string) => void;
  onArchiveMemory: (id: string) => void;
}

export interface ScIntelMobileProps {
  projects: Array<{ id: string; name: string }>;
  projectId: string | null;
  onProjectChange: (id: string | null) => void;
  threads: Thread[];
  model: string;
  onModelChange: (id: string) => void;
  newThread: (opts?: { projectId?: string | null; agentId?: string | null }) => string;
  updateThread: (id: string, patch: Partial<Thread>) => void;
  chat: ChatManagementBundle;
}

export function ScIntelMobile({
  projects,
  projectId,
  onProjectChange,
  threads,
  model,
  onModelChange,
  newThread,
  updateThread,
  chat,
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
            onOpenAllProposals={() => navigate("proposals")}
            onOpenFlag={(id) => navigate(`flag/${id}`)}
            onOpenChats={() => navigate("chats")}
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
            onModelChange={onModelChange}
            updateThread={updateThread}
            onOpenProposal={(id) => navigate(`/project-intelligence/proposal/${id}`)}
          />
        }
      />

      <Route
        path="thread/:threadId/trace"
        element={<HandoffTraceRoute threads={threads} proposals={proposals} navigate={navigate} />}
      />

      <Route path="roster" element={<Roster onBack={() => navigate(-1)} onOpen={(id) => navigate(`roster/${id}`)} />} />

      <Route
        path="roster/:agentId"
        element={<IntelligenceDetailRoute proposals={proposals} navigate={navigate} />}
      />

      <Route
        path="proposals"
        element={
          <AllProposals
            proposals={proposals}
            onBack={() => navigate(-1)}
            onOpen={(id) => navigate(`/project-intelligence/proposal/${id}`)}
          />
        }
      />

      <Route
        path="proposal/:proposalId"
        element={<ProposalRoute navigate={navigate} />}
      />

      <Route
        path="flag/:proposalId"
        element={
          <FlagRoute
            proposals={proposals}
            navigate={navigate}
          />
        }
      />

      <Route
        path="chats"
        element={<ChatsScreen threads={threads} projects={projects} onBack={() => navigate(-1)} onOpenThread={(id) => navigate(`/project-intelligence/thread/${id}`)} onOpenFiles={() => navigate("chats/files")} {...chat} />}
      />

      <Route path="chats/files" element={<FilesMemoryScreen onBack={() => navigate(-1)} {...chat} />} />

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
  onModelChange,
  updateThread,
  onOpenProposal,
}: {
  threads: Thread[];
  model: string;
  onModelChange: (id: string) => void;
  updateThread: (id: string, patch: Partial<Thread>) => void;
  onOpenProposal: (id: string) => void;
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
      onModelChange={onModelChange}
      onBack={() => navigate("/project-intelligence")}
      initialMessage={initialMessage}
      onConsumeInitialMessage={() => navigate(".", { replace: true, state: null })}
      onOpenProposal={onOpenProposal}
      onOpenTrace={() => navigate(`/project-intelligence/thread/${threadId}/trace`)}
      // A handoff's next turn keeps answering in THIS thread (mobile handoff
      // D1/§7) — no new thread, no navigation. Persisting it onto the thread
      // record just keeps the thread's own default in step with whichever
      // intelligence most recently answered, for the next time it's opened.
      onUpdateAgent={(intelId) => thread && updateThread(thread.id, { agentId: intelToPersonaId(intelId) })}
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

function FlagRoute({
  proposals,
  navigate,
}: {
  proposals: ReturnType<typeof useProposals>["proposals"];
  navigate: ReturnType<typeof useNavigate>;
}) {
  const { proposalId } = useParams<{ proposalId: string }>();
  const proposal = proposals.find((p) => p.id === proposalId);
  if (!proposalId) return <Navigate to="/project-intelligence" replace />;
  return (
    <FlagScreen
      proposal={proposal}
      onBack={() => navigate(-1)}
      onDismiss={() => {
        markProposalViewed(proposalId);
        navigate(-1);
      }}
      onSeeProposal={() => {
        markProposalViewed(proposalId);
        navigate(`/project-intelligence/proposal/${proposalId}`);
      }}
    />
  );
}

function HandoffTraceRoute({
  threads,
  proposals,
  navigate,
}: {
  threads: Thread[];
  proposals: ReturnType<typeof useProposals>["proposals"];
  navigate: ReturnType<typeof useNavigate>;
}) {
  const { threadId } = useParams<{ threadId: string }>();
  const thread = threads.find((t) => t.id === threadId);
  if (!thread) return <Navigate to="/project-intelligence" replace />;
  return (
    <HandoffTraceScreen
      thread={thread}
      proposals={proposals.filter((p) => p.thread_id === thread.id)}
      onBack={() => navigate(-1)}
    />
  );
}
