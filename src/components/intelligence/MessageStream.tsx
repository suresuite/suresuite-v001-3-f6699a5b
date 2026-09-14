/**
 * MessageStream — the turn list, extracted verbatim from ChatWorkspace so the
 * desktop workspace and the mobile tree render ONE implementation of the nine
 * message-part kinds instead of two that drift.
 *
 * Nothing about the markup changed in the move: the desktop wrapper passes the
 * classes it used inline, so a 1280px render is byte-identical to what
 * ChatWorkspace produced before. The mobile tree passes its own gutter.
 */
import React, { useEffect, useRef, useState } from "react";
import type { ChatMessage } from "@/hooks/useProjectChat";
import { ActivityGroup, AgentDivider, MessagePart, MetaRow } from "./MessageParts";
import { ProposalCard } from "@/components/chat/ProposalCard";
import { MobileProse } from "@/components/mobile";
import { useProseLines } from "@/hooks/useViewport";
import { cn } from "@/lib/utils";

interface MessageStreamProps {
  messages: ChatMessage[];
  loading: boolean;
  error: string | null;
  threadMode: "ask" | "review";
  onModeChange: (m: "ask" | "review") => void;
  /** Scroll container classes. */
  className?: string;
  /** Inner column classes — the max-width and gutter differ per platform. */
  containerClassName?: string;
  /**
   * The user turn's bubble. Omit it and the desktop bubble renders exactly as
   * it always has; the mobile tree passes the skin's 16px bubble (spec §7,
   * which reserves that radius for a sheet and a chat bubble and nothing
   * else). It is a class override rather than a branch so there is still one
   * implementation of the nine part kinds.
   */
  userBubbleClassName?: string;
  /** Wear the mobile skin (v2 §4C) in the parts this stream renders itself —
   *  today that is the proposal card. Desktop passes nothing. */
  skin?: boolean;
  /**
   * Fold the grounding chip and the activity accordion into one MetaRow
   * (v1b space pass). Opt-in rather than default: the phone tree has the
   * vertical budget for two blocks and no 28px chrome band to pay for, so it
   * keeps the stacked pair and this stream stays one implementation of the
   * nine part kinds either way.
   */
  mergedMeta?: boolean;
}

export function MessageStream({
  messages,
  loading,
  error,
  threadMode,
  onModeChange,
  className,
  containerClassName,
  userBubbleClassName,
  skin = false,
  mergedMeta = false,
}: MessageStreamProps) {
  const streamRef = useRef<HTMLDivElement | null>(null);
  const proseLines = useProseLines();
  const [, setSavedMemory] = useState<Record<string, boolean>>({});

  // Keep the newest turn in view without scrollIntoView.
  useEffect(() => {
    const el = streamRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, loading]);

  return (
    <div ref={streamRef} className={cn("min-h-0 flex-1 overflow-y-auto overflow-x-hidden", className)}>
      <div className={cn("flex flex-col gap-4", containerClassName)}>
        {messages.map((m) => {
          if (m.role === "user") {
            return (
              <div key={m.id} className="flex justify-end">
                <div
                  className={cn(
                    "max-w-[78%] whitespace-pre-wrap rounded-sm bg-foreground px-3 py-2 text-[14px] leading-[1.55] text-background",
                    userBubbleClassName,
                  )}
                >
                  {m.content}
                </div>
              </div>
            );
          }
          // The merged row owns the evidence part, so it must not also render
          // as a standalone chip further up the stack.
          const parts = m.parts ?? [];
          const evidence = mergedMeta ? parts.find((p) => p.kind === "evidence") : undefined;
          const bodyParts = evidence ? parts.filter((p) => p !== evidence) : parts;
          return (
            <div key={m.id}>
              {m.content &&
                (skin ? (
                  // Agent prose clamps by lines on a phone (v2 §5.4): a long
                  // reply shows what the device can hold and expands in place.
                  // Nothing is deferred and nothing is lost.
                  <MobileProse lines={proseLines}>{m.content}</MobileProse>
                ) : (
                  <div className="whitespace-pre-wrap text-[14px] leading-[1.65] text-foreground">
                    {m.content}
                  </div>
                ))}
              {bodyParts.map((part, i) => {
                // Proposals render via ProposalCard in the app (they need
                // the proposals hook for approve/apply state).
                if (part.kind === "proposal") {
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  const d = part.data as any;
                  return (
                    <React.Fragment key={i}>
                      {d?.agent && <AgentDivider agentName={d.agent} />}
                      {/* The container resolves the proposal (approve/
                          apply state) and renders ProposalCardView. */}
                      <ProposalCard proposalId={d.proposal_id} skin={skin} />
                    </React.Fragment>
                  );
                }
                const key = m.id + ":" + i;
                return (
                  <MessagePart
                    key={key}
                    part={part}
                    onSwitchToReview={threadMode === "ask" ? () => onModeChange("review") : undefined}
                    onSaveMemory={() => setSavedMemory((s) => ({ ...s, [key]: true }))}
                    onDismissMemory={() => setSavedMemory((s) => ({ ...s, [key]: false }))}
                  />
                );
              })}
              {mergedMeta ? (
                <MetaRow toolCalls={m.toolCalls ?? []} evidence={evidence?.data} />
              ) : (
                m.toolCalls && m.toolCalls.length > 0 && <ActivityGroup toolCalls={m.toolCalls} />
              )}
            </div>
          );
        })}

        {loading && (
          <div className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-foreground" /> Thinking…
          </div>
        )}
        {error && (
          <div className="rounded-sm border border-[#f0c7cb] bg-[#fdf2f3] px-3 py-2 text-[12.5px] text-[#8a2a30]">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
