import { useMemo } from "react";
import type { ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import type { ChatMessage } from "@/hooks/useProjectChat";
import {
  ARTIFACT_AGENT_NAMES,
  LONG_REPLY_CHARS,
  partSourceNotes,
} from "@/lib/chat/partStyles";
import { DataTable } from "./DataTable";
import { KpiCards } from "./KpiCards";
import { BulletList } from "./BulletList";
import { ActivityGroup } from "./ActivityGroup";
import { ProposalCard } from "./ProposalCard";
import { PlanCard, type PlanPartData } from "./PlanCard";
import { MemoryChip, type MemoryOfferData } from "./MemoryChip";
import { ModeNotice, type ModeNoticeData } from "./ModeNotice";
import { EvidenceList } from "./EvidenceList";

/**
 * MessageBubble renders the §17.2 readability grammar (ai-agents.md v1.2
 * Phase 2): prose stays plain (it's the voice), tool activity collapses into
 * one ActivityGroup line, data parts sit on slate-railed cards with their
 * source note, proposals/memory/errors carry their class rails, an agent turn
 * renders under a labeled divider, and replies longer than ~3 screens gain
 * sticky section anchors from their markdown headings. All treatments come
 * from src/lib/chat/partStyles.ts — color encodes the CLASS of content,
 * never the agent.
 */

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
}

/** Markdown headings (outside code fences) for the sticky anchor bar. */
function extractHeadings(md: string): string[] {
  const withoutCode = md.replace(/```[\s\S]*?```/g, "");
  const out: string[] = [];
  const re = /^#{1,4}\s+(.+?)\s*$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(withoutCode))) {
    const text = m[1].replace(/[*_`#[\]]/g, "").trim();
    if (text) out.push(text);
  }
  return out;
}

function nodeText(children: ReactNode): string {
  if (typeof children === "string" || typeof children === "number") return String(children);
  if (Array.isArray(children)) return children.map(nodeText).join("");
  if (children && typeof children === "object" && "props" in children) {
    return nodeText((children as { props: { children?: ReactNode } }).props.children);
  }
  return "";
}

function AgentTurnDivider({ artifactType }: { artifactType: string | undefined }) {
  const name = artifactType ? ARTIFACT_AGENT_NAMES[artifactType] : undefined;
  if (!name) return null;
  return (
    <div className="mt-3 flex items-center gap-2" role="separator" aria-label={`${name} drafted a proposal`}>
      <span className="h-px flex-1 bg-border" />
      <span className="text-[11px] text-muted-foreground">
        <span className="font-semibold text-foreground">{name}</span> drafted a proposal
      </span>
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}

interface MessageBubbleProps {
  message: ChatMessage;
  /** §17.4: lets cards offer a follow-up utterance (prefilled into the
   * composer — e.g. the post-apply "save this decision" suggestion). */
  onSuggestUtterance?: (utterance: string) => void;
}

export function MessageBubble({ message, onSuggestUtterance }: MessageBubbleProps) {
  const isUser = message.role === "user";

  // Sticky section anchors for long replies (§17.2 turn-level structure).
  const anchors = useMemo(() => {
    if (isUser || (message.content?.length ?? 0) <= LONG_REPLY_CHARS) return [];
    const headings = extractHeadings(message.content ?? "");
    return headings.length >= 2 ? headings : [];
  }, [isUser, message.content]);

  const mdComponents = useMemo(() => {
    if (anchors.length === 0) return undefined;
    const heading = (Tag: "h1" | "h2" | "h3" | "h4") => {
      const H = ({ children }: { children?: ReactNode }) => (
        <Tag id={`${message.id}-${slugify(nodeText(children))}`}>{children}</Tag>
      );
      H.displayName = `Anchored${Tag}`;
      return H;
    };
    return { h1: heading("h1"), h2: heading("h2"), h3: heading("h3"), h4: heading("h4") };
  }, [anchors.length, message.id]);

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-sm bg-foreground px-3.5 py-2 text-[14px] leading-relaxed text-background">
          <div className="whitespace-pre-wrap">{message.content}</div>
        </div>
      </div>
    );
  }

  // §17.2 source notes: parts don't persist the envelope meta, so meta.tool
  // is derived by aligning parts to tool calls (null on any ambiguity).
  const sourceNotes = partSourceNotes(message.parts, message.toolCalls);
  // The agent-turn divider sits before the first agent-output part (§17.2:
  // persona voice above, agent output below).
  const firstProposalIdx = message.parts?.findIndex((p) => p.kind === "proposal") ?? -1;

  return (
    <div className="flex justify-start">
      <div className="w-full max-w-full text-[14px] leading-relaxed text-foreground">
        {anchors.length > 0 && (
          <nav
            aria-label="Sections in this reply"
            className="sticky top-0 z-10 mb-1.5 flex flex-wrap gap-1 rounded-md border border-border bg-background/95 px-2 py-1 backdrop-blur"
          >
            {anchors.map((h, i) => (
              <button
                key={i}
                type="button"
                onClick={() =>
                  document
                    .getElementById(`${message.id}-${slugify(h)}`)
                    ?.scrollIntoView({ behavior: "smooth", block: "start" })
                }
                className="rounded px-1.5 py-0.5 text-[11px] text-muted-foreground transition hover:bg-muted hover:text-foreground"
              >
                {h}
              </button>
            ))}
          </nav>
        )}
        <div className="prose prose-sm max-w-none dark:prose-invert prose-p:my-1.5 prose-ul:my-1.5 prose-li:my-0.5 prose-headings:mt-3 prose-headings:mb-1.5 prose-pre:bg-surface-elevated prose-pre:border prose-pre:border-border prose-code:before:content-none prose-code:after:content-none prose-code:rounded prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-code:text-[12.5px] prose-code:font-mono">
          <ReactMarkdown components={mdComponents}>{message.content || "_(no response)_"}</ReactMarkdown>
        </div>
        {message.parts?.map((p, i) => {
          const divider = i === firstProposalIdx
            ? <AgentTurnDivider artifactType={(p.data as { artifact_type?: string })?.artifact_type} />
            : null;
          if (p.kind === "table") return <DataTable key={i} data={p.data} sourceTool={sourceNotes[i]} />;
          if (p.kind === "kpi") return <KpiCards key={i} data={p.data} sourceTool={sourceNotes[i]} />;
          if (p.kind === "bullets") return <BulletList key={i} data={p.data} sourceTool={sourceNotes[i]} />;
          if (p.kind === "proposal") {
            return (
              <div key={i}>
                {divider}
                <ProposalCard
                  proposalId={(p.data as { proposal_id?: string })?.proposal_id}
                  onSuggestUtterance={onSuggestUtterance}
                />
              </div>
            );
          }
          // M2 (ai-agents.md §14.4): the server-emitted memory chip offer —
          // nothing is stored until the user clicks Save. memory_saved parts
          // need no card: the reply text already carries the confirmation.
          if (p.kind === "memory_offer") {
            return <MemoryChip key={i} offer={p.data as MemoryOfferData} />;
          }
          // §15: the Ask-mode refusal — rendered in the §17.2 errors-and-
          // refusals treatment with the one-click "Switch to Review" remedy.
          if (p.kind === "mode_notice") {
            return <ModeNotice key={i} data={p.data as ModeNoticeData} />;
          }
          // H1 (§22.2): the verified reply's source list — the "grounded —
          // N sources" chip; verifier fallbacks take the error treatment.
          if (p.kind === "evidence") {
            return <EvidenceList key={i} data={p.data} />;
          }
          // H3 (§21.2): the live task-plan checklist — the part carries a
          // snapshot; the card subscribes to the chat_plans row.
          if (p.kind === "plan") {
            return <PlanCard key={i} data={p.data as PlanPartData} />;
          }
          return null;
        })}
        {message.toolCalls && message.toolCalls.length > 0 && (
          <ActivityGroup calls={message.toolCalls} />
        )}
      </div>
    </div>
  );
}
