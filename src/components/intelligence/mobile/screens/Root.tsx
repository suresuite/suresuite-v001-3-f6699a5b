/**
 * SC Intelligences — root (screen 02, handoff §5).
 *
 * Four sections, in this order, and no fifth: compose row · Open · Proposals
 * · Raised by this project. No live composer here — that is what screen 03
 * is for (§5's whole point: two stacked bottom bars is the defect this
 * replaces).
 */
import * as React from "react";
import { Plus } from "lucide-react";
import { MobilePageHeader, MobilePanel, MobileRow, ProjectChip } from "@/components/mobile";
import { IntelBadge } from "../primitives";
import { getIntel, personaToIntelId } from "../intel";
import { formatElapsed } from "../format";
import { isProposalViewed } from "../viewedFlags";
import type { Thread } from "@/hooks/useChatThreads";
import type { Proposal } from "@/hooks/useProposals";

export interface RootProps {
  projects: Array<{ id: string; name: string }>;
  projectId: string | null;
  onProjectChange: (id: string | null) => void;
  threads: Thread[];
  proposals: Proposal[];
  onOpenNew: () => void;
  onOpenThread: (id: string) => void;
  onOpenRoster: () => void;
  onOpenProposal: (id: string) => void;
  onOpenAllProposals: () => void;
  /** Raised (unprompted) proposals open their own flag screen, not the
   *  normal proposal review — opening it is what clears its unread dot. */
  onOpenFlag: (id: string) => void;
  onOpenChats: () => void;
}

function lastAssistant(t: Thread) {
  for (let i = t.messages.length - 1; i >= 0; i--) {
    if (t.messages[i].role === "assistant") return t.messages[i];
  }
  return null;
}

function sourceCount(msg: Thread["messages"][number] | null): number {
  const evidence = msg?.parts?.find((p) => p.kind === "evidence");
  const citations = (evidence?.data as { citations?: unknown[] } | undefined)?.citations;
  return Array.isArray(citations) ? citations.length : 0;
}

export function Root({
  projects,
  projectId,
  onProjectChange,
  threads,
  proposals,
  onOpenNew,
  onOpenThread,
  onOpenRoster,
  onOpenProposal,
  onOpenAllProposals,
  onOpenFlag,
  onOpenChats,
}: RootProps) {
  const scoped = React.useMemo(
    () => threads.filter((t) => !projectId || t.projectId === projectId).filter((t) => t.messages.length > 0),
    [threads, projectId],
  );
  const open = React.useMemo(() => [...scoped].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 12), [scoped]);

  const scopedProposals = React.useMemo(
    () => proposals.filter((p) => !projectId || p.project_id === projectId),
    [proposals, projectId],
  );
  const awaiting = scopedProposals.filter((p) => p.status === "proposed" || p.status === "draft");
  // A proposal with no owning thread was filed without a question ever being
  // asked — the honest signal for "the intelligences raised this on their
  // own" rather than something a client-side flag has to invent.
  const raised = scopedProposals.filter((p) => !p.thread_id);
  const raisedUnreadCount = raised.filter((p) => !isProposalViewed(p.id)).length;

  return (
    <>
      <MobilePageHeader
        variant="root"
        title="SC Intelligences"
        meta={
          <button
            type="button"
            onClick={onOpenRoster}
            className="font-mono text-[11px] text-[#525252]"
          >
            all 5
          </button>
        }
      >
        <ProjectChip projects={projects} selectedId={projectId} onSelect={onProjectChange} />
      </MobilePageHeader>

      <div className="flex flex-col gap-4 px-[var(--m-gutter)] pb-4">
        {/* 1 · compose row — a link, not an input (§5). */}
        <button
          type="button"
          onClick={onOpenNew}
          className="flex min-h-[46px] w-full items-center gap-2 rounded-[4px] border border-[#18181b] bg-white px-3 text-left"
        >
          <Plus className="h-4 w-4 shrink-0 text-[#18181b]" />
          <span className="flex-1 text-[14px] font-medium text-[#18181b]">Ask about this project</span>
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[#525252]">new</span>
        </button>

        {/* 2 · Open */}
        <MobilePanel label="Open" counter={open.length || undefined}>
          {open.length === 0 && (
            <div className="px-3 py-4 text-[13.5px] text-[#525252]">
              No questions yet. Ask about this project above.
            </div>
          )}
          {open.map((t) => {
            const intelId = personaToIntelId(t.agentId);
            const last = lastAssistant(t);
            const answered = Boolean(last);
            const status = answered
              ? `answer ready · ${sourceCount(last)} sources · ${formatElapsed(t.updatedAt)}`
              : "awaiting reply";
            return (
              <MobileRow
                key={t.id}
                onClick={() => onOpenThread(t.id)}
                leading={<IntelBadge id={intelId} />}
                label={t.title}
                sub={status}
              />
            );
          })}
          <MobileRow onClick={onOpenChats} label="Manage all chats" chevron />
        </MobilePanel>

        {/* 3 · Proposals · N — only when N > 0. */}
        {awaiting.length > 0 && (
          <MobilePanel label="Proposals" counter={awaiting.length}>
            {awaiting.map((p) => (
              <MobileRow
                key={p.id}
                onClick={() => onOpenProposal(p.id)}
                leading={<IntelBadge id={p.agent_id} />}
                label={p.title}
                sub="awaiting your decision"
              />
            ))}
            <MobileRow onClick={onOpenAllProposals} label={`All proposals · ${scopedProposals.length}`} chevron />
          </MobilePanel>
        )}

        {/* 4 · Raised by this project — unprompted findings, never generic
            sample questions (§5). Amber-accented: this is the unprompted-flag
            surface, and the first unread row carries its own dot. */}
        {raised.length > 0 && (
          <MobilePanel label="Raised by this project" counter={raised.length} accent="#e0930b">
            {raised.map((p) => {
              const intel = getIntel(p.agent_id);
              const domain = intel.reads.split(" · ")[0];
              const unread = !isProposalViewed(p.id);
              return (
                <MobileRow
                  key={p.id}
                  onClick={() => onOpenFlag(p.id)}
                  dot={unread ? "#e0930b" : undefined}
                  leading={<IntelBadge id={p.agent_id} />}
                  label={unread ? <span className="font-semibold">{p.title}</span> : p.title}
                  sub={`${intel.badge} · from ${domain}`}
                />
              );
            })}
          </MobilePanel>
        )}
      </div>
    </>
  );
}
