/**
 * SC Intelligences — thread (screens 05 working / 06 answer, handoff §6/§7).
 *
 * One screen because the two states are the same conversation at different
 * moments: working while `loading`, answer once the assistant turn lands.
 * Composer stays live here (thread views only, §3) so a follow-up question
 * is a normal send rather than a new thread.
 */
import * as React from "react";
import { ArrowUp } from "lucide-react";
import { MobilePageHeader } from "@/components/mobile";
import { useProjectChat, type ChatMessage } from "@/hooks/useProjectChat";
import type { Thread as ThreadRecord } from "@/hooks/useChatThreads";
import { IntelBadge, ReadStrip } from "../primitives";
import { getIntel, personaToIntelId, SC_INTEL } from "../intel";
import { WorkingState } from "./WorkingState";
import { SourcesSheet, type SourceCitation } from "./SourcesSheet";
import { MessagePart } from "../../MessageParts";
import { cn } from "@/lib/utils";

function citationsOf(msg: ChatMessage): SourceCitation[] {
  const evidence = msg.parts?.find((p) => p.kind === "evidence");
  const data = evidence?.data as { citations?: SourceCitation[] } | undefined;
  return Array.isArray(data?.citations) ? data.citations : [];
}

/** Splits assistant prose on inline `[1]`-style marks into tappable
 *  citation superscripts (§6.3), numbered in order of first appearance. */
function AnswerProse({ text, onOpenSources }: { text: string; onOpenSources: () => void }) {
  const segments = text.split(/(\[\d+\])/g);
  return (
    <p className="text-[14.5px] leading-[1.55] text-[#3f3f46] [text-wrap:pretty]">
      {segments.map((seg, i) => {
        const m = seg.match(/^\[(\d+)\]$/);
        if (!m) return <React.Fragment key={i}>{seg}</React.Fragment>;
        return (
          <sup
            key={i}
            role="button"
            tabIndex={0}
            onClick={onOpenSources}
            className="cursor-pointer pl-0.5 font-mono text-[9px] font-semibold text-[#bf2330]"
          >
            {m[1]}
          </sup>
        );
      })}
    </p>
  );
}

function AnswerBlock({
  msg,
  intelId,
  onOpenSources,
  onOpenProposal,
  onHandOff,
}: {
  msg: ChatMessage;
  intelId: string;
  onOpenSources: () => void;
  onOpenProposal: (proposalId: string) => void;
  onHandOff: () => void;
}) {
  const intel = getIntel(intelId);
  const citations = citationsOf(msg);
  const proposalPart = msg.parts?.find((p) => p.kind === "proposal");
  const proposalId = proposalPart ? (proposalPart.data as { proposal_id?: string })?.proposal_id : undefined;

  const readItems = citations.slice(0, 6).map((c) => ({ label: c.label ?? c.ref ?? c.kind ?? "source" }));

  const other = SC_INTEL.find((a) => a.id !== intelId) ?? SC_INTEL[0];

  return (
    <div className="mt-4">
      {/* 1 · agent header */}
      <div className="flex items-center gap-2">
        <IntelBadge id={intelId} size={22} />
        <span className="font-mono text-[10px] uppercase tracking-[0.2em]" style={{ color: intel.fg }}>
          {intel.name}
        </span>
      </div>

      {/* 2-3 · the answer, with tappable citation marks */}
      <div className="mt-2">
        <AnswerProse text={msg.content} onOpenSources={onOpenSources} />
      </div>

      {/* 4 · other parts (kpi/table/bullets/plan) — the existing part cards. */}
      {(msg.parts ?? [])
        .filter((p) => p.kind !== "evidence" && p.kind !== "proposal")
        .map((part, i) => (
          <MessagePart key={i} part={part} />
        ))}

      {/* 5 · read strip */}
      <ReadStrip items={readItems} />

      {/* 6 · action list — three at most. */}
      <div className="mt-2.5 overflow-hidden rounded-[4px] border border-[#d4d4d4]">
        {citations.length > 0 && (
          <button
            type="button"
            onClick={onOpenSources}
            className="flex w-full min-h-11 items-center justify-between border-b border-[#e8e8ea] px-3 text-[13px] font-medium text-[#171717] last:border-b-0"
          >
            Sources · {citations.length}
            <span aria-hidden className="text-[#6b6b6b]">›</span>
          </button>
        )}
        {proposalId && (
          <button
            type="button"
            onClick={() => onOpenProposal(proposalId)}
            className="flex w-full min-h-11 items-center justify-between border-b border-[#e8e8ea] px-3 text-[13px] font-medium text-[#171717] last:border-b-0"
          >
            See the proposal
            <span aria-hidden className="text-[#6b6b6b]">›</span>
          </button>
        )}
        <button
          type="button"
          onClick={onHandOff}
          className="flex w-full min-h-11 items-center justify-between px-3 text-[13px] font-medium text-[#171717]"
        >
          Ask the {other.name.toLowerCase()}
          <span aria-hidden className="text-[#6b6b6b]">›</span>
        </button>
      </div>
    </div>
  );
}

export interface ThreadScreenProps {
  threadId: string;
  thread: ThreadRecord | undefined;
  model: string;
  onBack: () => void;
  initialMessage?: string | null;
  onConsumeInitialMessage: () => void;
  onOpenProposal: (proposalId: string) => void;
  onHandOff: (intelId: string) => void;
}

export function ThreadScreen({
  threadId,
  thread,
  model,
  onBack,
  initialMessage,
  onConsumeInitialMessage,
  onOpenProposal,
  onHandOff,
}: ThreadScreenProps) {
  const { messages, loading, error, send } = useProjectChat(threadId);
  const [input, setInput] = React.useState("");
  const [sourcesFor, setSourcesFor] = React.useState<ChatMessage | null>(null);
  const [stopped, setStopped] = React.useState(false);
  const sentInitial = React.useRef(false);

  const intelId = personaToIntelId(thread?.agentId);

  React.useEffect(() => {
    if (!initialMessage || sentInitial.current) return;
    sentInitial.current = true;
    onConsumeInitialMessage();
    void send(initialMessage, { model, projectId: thread?.projectId ?? null, agentId: thread?.agentId ?? null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialMessage]);

  const submit = () => {
    const text = input.trim();
    if (!text || loading) return;
    setInput("");
    setStopped(false);
    void send(text, { model, projectId: thread?.projectId ?? null, agentId: thread?.agentId ?? null });
  };

  const title = thread?.title && thread.title !== "New chat" ? thread.title : messages[0]?.content || "New chat";
  const subtitle = `${getIntel(intelId).badge} · ${getIntel(intelId).name.toLowerCase()}`;
  const showWorking = loading && !stopped;

  return (
    <div className="flex h-[calc(100svh-var(--pi-chrome,170px))] min-h-[420px] flex-col overflow-hidden bg-white">
      <MobilePageHeader variant="detail" title={title} subtitle={subtitle} onBack={onBack} />

      <div className="min-h-0 flex-1 overflow-y-auto px-[var(--m-gutter)] pb-4">
        {messages
          .filter((m) => m.role === "assistant")
          .map((m) => (
            <AnswerBlock
              key={m.id}
              msg={m}
              intelId={intelId}
              onOpenSources={() => setSourcesFor(m)}
              onOpenProposal={onOpenProposal}
              onHandOff={() => onHandOff(SC_INTEL.find((a) => a.id !== intelId)?.id ?? SC_INTEL[0].id)}
            />
          ))}

        {showWorking && <WorkingState intelId={intelId} onStop={() => setStopped(true)} />}

        {error && !showWorking && (
          <div className="mt-3 rounded-[4px] border border-[#f0c7cb] bg-[#fdf2f3] px-3 py-2 text-[12.5px] text-[#8a2a30]">
            {error}
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-[#ebebeb] bg-[#f6f6f6] px-4 pb-[14px] pt-[9px]">
        <div className="flex items-end gap-2">
          <textarea
            rows={1}
            value={input}
            disabled={showWorking}
            onChange={(e) => setInput(e.target.value)}
            placeholder={showWorking ? "Answering…" : `Ask the ${getIntel(intelId).name.toLowerCase()}…`}
            className={cn(
              "min-h-11 flex-1 resize-none rounded-[4px] border border-[#d4d4d4] px-3 py-[11px] text-[14px] leading-[1.4] text-[#171717] outline-none placeholder:text-[#9a9a9a]",
              showWorking ? "bg-[#f0f0f0]" : "bg-white",
            )}
          />
          <button
            type="button"
            onClick={submit}
            disabled={!input.trim() || showWorking}
            aria-label="Send"
            className={cn(
              "grid h-11 w-11 shrink-0 place-items-center rounded-[4px]",
              input.trim() && !showWorking ? "bg-[#18181b] text-white" : "bg-[#e4e4e4] text-[#9a9a9a]",
            )}
          >
            <ArrowUp className="h-4 w-4" />
          </button>
        </div>
      </div>

      <SourcesSheet
        open={Boolean(sourcesFor)}
        citations={sourcesFor ? citationsOf(sourcesFor) : []}
        onClose={() => setSourcesFor(null)}
      />
    </div>
  );
}
