/**
 * SC Intelligences — thread (screens 05 working / 06 answer / 06c
 * intelligence & model sheet, mobile handoff pass).
 *
 * One screen because the two states are the same conversation at different
 * moments: working while `loading`, answer once the assistant turn lands.
 * Composer stays live here (thread views only) so a follow-up question is a
 * normal send rather than a new thread — including a handoff: "ask the
 * other" changes which intelligence the NEXT turn in this same thread routes
 * to (D-fix: a handoff used to open a brand new thread, which is why there
 * was never a single conversation to trace).
 *
 * D1: the previous version filtered `messages` down to `role === "assistant"`
 * only, so the user's own question was never rendered — the single biggest
 * defect in the review. This version renders every turn, user and assistant,
 * in order.
 */
import * as React from "react";
import { ArrowUp, ChevronDown, Paperclip, Square } from "lucide-react";
import { MobilePageHeader } from "@/components/mobile";
import { useProjectChat, type ChatMessage } from "@/hooks/useProjectChat";
import type { Thread as ThreadRecord } from "@/hooks/useChatThreads";
import { getModelLabel } from "@/components/chat/ModelPicker";
import { IntelBadge, ReadStrip } from "../primitives";
import { getIntel, personaToIntelId, intelToPersonaId, SC_INTEL } from "../intel";
import { withAttachedContext, splitAttachedContext } from "../format";
import { WorkingState } from "./WorkingState";
import { SourcesSheet, type SourceCitation } from "./SourcesSheet";
import { IntelModelSheet } from "./IntelModelSheet";
import { AttachContextSheet, type AttachedItem } from "./AttachContextSheet";
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
    <p className="text-[14px] leading-[1.35] text-[#3f3f46] [text-wrap:pretty]">
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

/** The user's own turn — right-aligned bubble, no label, no avatar, no
 *  timestamp (D1). Attached context, if any, renders as its own mono line
 *  beneath rather than inside the question's prose. */
function UserTurn({ msg }: { msg: ChatMessage }) {
  const { context, text } = splitAttachedContext(msg.content);
  return (
    <div className="flex flex-shrink-0 flex-col items-end gap-1">
      <div
        className="max-w-[86%] rounded-[16px] px-3 py-2 text-[14px] leading-[1.32] text-[#171717]"
        style={{ background: "#e9e9ec" }}
      >
        {text}
      </div>
      {context && <span className="font-mono text-[10.5px] text-[#525252]">{context}</span>}
    </div>
  );
}

/** The centred marker between two intelligences in one thread (handoff
 *  trace §Handoff): two badges around an arrow, then what carried over. */
function HandoffMarker({
  fromId,
  toId,
  carried,
}: {
  fromId: string;
  toId: string;
  carried: string[];
}) {
  return (
    <div className="flex flex-shrink-0 flex-col items-center gap-2.5 py-1">
      <div className="flex w-full items-center gap-3">
        <span aria-hidden className="h-px flex-1 bg-[#e8e8ea]" />
        <div className="flex items-center gap-1.5">
          <IntelBadge id={fromId} size={18} />
          <span aria-hidden className="text-[11px] text-[#9a9a9a]">→</span>
          <IntelBadge id={toId} size={18} />
        </div>
        <span aria-hidden className="h-px flex-1 bg-[#e8e8ea]" />
      </div>
      <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#8a8a8a]">handed over</span>
      {carried.length > 0 && (
        <div className="w-full overflow-hidden rounded-[4px] border border-[#d4d4d4]">
          <div className="border-b border-[#d4d4d4] bg-[#fafafa] px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-[#525252]">
            carried over
          </div>
          {carried.map((item, i) => (
            <div
              key={i}
              className="border-b border-[#e8e8ea] px-3 py-1.5 text-[12.5px] text-[#3f3f46] last:border-b-0"
            >
              {item}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AnswerBlock({
  msg,
  intelId,
  showTrace,
  onOpenSources,
  onOpenProposal,
  onOpenTrace,
  onHandOff,
}: {
  msg: ChatMessage;
  intelId: string;
  /** Only the thread's last answer offers "Read the trace", and only once a
   *  handoff has actually happened. */
  showTrace: boolean;
  onOpenSources: () => void;
  onOpenProposal: (proposalId: string) => void;
  onOpenTrace: () => void;
  onHandOff: () => void;
}) {
  const citations = citationsOf(msg);
  const proposalPart = msg.parts?.find((p) => p.kind === "proposal");
  const proposalId = proposalPart ? (proposalPart.data as { proposal_id?: string })?.proposal_id : undefined;

  const readItems = citations.slice(0, 6).map((c) => ({ label: c.label ?? c.ref ?? c.kind ?? "source" }));

  const other = SC_INTEL.find((a) => a.id !== intelId) ?? SC_INTEL[0];

  return (
    <div className="flex flex-shrink-0 flex-col gap-3">
      <AnswerProse text={msg.content} onOpenSources={onOpenSources} />

      {/* other parts (kpi/table/bullets/plan) — the existing part cards. */}
      {(msg.parts ?? [])
        .filter((p) => p.kind !== "evidence" && p.kind !== "proposal")
        .map((part, i) => (
          <MessagePart key={i} part={part} />
        ))}

      <ReadStrip items={readItems} className="mt-0" />

      <div className="overflow-hidden rounded-[4px] border border-[#d4d4d4]">
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
          className="flex w-full min-h-11 items-center justify-between border-b border-[#e8e8ea] px-3 text-[13px] font-medium text-[#171717] last:border-b-0"
        >
          Ask the {other.name.toLowerCase()}
          <span aria-hidden className="text-[#6b6b6b]">›</span>
        </button>
        {showTrace && (
          <button
            type="button"
            onClick={onOpenTrace}
            className="flex w-full min-h-11 items-center justify-between px-3 text-[13px] font-medium text-[#171717]"
          >
            Read the trace
            <span aria-hidden className="text-[#6b6b6b]">›</span>
          </button>
        )}
      </div>
    </div>
  );
}

export interface ThreadScreenProps {
  threadId: string;
  thread: ThreadRecord | undefined;
  model: string;
  onModelChange: (id: string) => void;
  onBack: () => void;
  initialMessage?: string | null;
  onConsumeInitialMessage: () => void;
  onOpenProposal: (proposalId: string) => void;
  onOpenTrace: () => void;
  onUpdateAgent: (intelId: string) => void;
}

export function ThreadScreen({
  threadId,
  thread,
  model,
  onModelChange,
  onBack,
  initialMessage,
  onConsumeInitialMessage,
  onOpenProposal,
  onOpenTrace,
  onUpdateAgent,
}: ThreadScreenProps) {
  const { messages, loading, error, send } = useProjectChat(threadId);
  const [input, setInput] = React.useState("");
  const [focused, setFocused] = React.useState(false);
  const [sourcesFor, setSourcesFor] = React.useState<ChatMessage | null>(null);
  const [stopped, setStopped] = React.useState(false);
  const [turnStartedAt, setTurnStartedAt] = React.useState<number | null>(null);
  const [attachOpen, setAttachOpen] = React.useState(false);
  const [attached, setAttached] = React.useState<AttachedItem[]>([]);
  const [intelSheetOpen, setIntelSheetOpen] = React.useState(false);
  const [activeIntelId, setActiveIntelId] = React.useState(() => personaToIntelId(thread?.agentId));
  const sentInitial = React.useRef(false);
  const taRef = React.useRef<HTMLTextAreaElement | null>(null);

  React.useLayoutEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "22px";
    el.style.height = Math.min(120, Math.max(22, el.scrollHeight)) + "px";
  }, [input]);

  React.useEffect(() => {
    if (!initialMessage || sentInitial.current) return;
    sentInitial.current = true;
    onConsumeInitialMessage();
    setTurnStartedAt(Date.now());
    void send(initialMessage, {
      model,
      projectId: thread?.projectId ?? null,
      agentId: intelToPersonaId(activeIntelId),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialMessage]);

  const submit = () => {
    const text = input.trim();
    if (!text || loading) return;
    setInput("");
    setAttached([]);
    setStopped(false);
    setTurnStartedAt(Date.now());
    void send(withAttachedContext(text, attached), {
      model,
      projectId: thread?.projectId ?? null,
      agentId: intelToPersonaId(activeIntelId),
    });
  };

  const showWorking = loading && !stopped && turnStartedAt != null;

  // A thread's intelligence sequence — first-appearance order of everyone
  // who has answered so far, which is what turns "ask the other" into a
  // recorded handoff rather than a one-off badge swap.
  const intelSequence = React.useMemo(() => {
    const seq: string[] = [];
    for (const m of messages) {
      if (m.role !== "assistant") continue;
      const id = personaToIntelId(m.agentId ?? thread?.agentId);
      if (seq[seq.length - 1] !== id) seq.push(id);
    }
    return seq;
  }, [messages, thread?.agentId]);
  const distinctIntel = React.useMemo(() => [...new Set(intelSequence)], [intelSequence]);
  const hasHandoff = distinctIntel.length > 1;

  const title = thread?.title && thread.title !== "New chat" ? thread.title : messages[0]?.content || "New chat";
  const subtitle = hasHandoff
    ? `${distinctIntel.map((id) => getIntel(id).badge).join(" → ")} · ${distinctIntel.length} intelligences`
    : `${getIntel(activeIntelId).badge} · ${getIntel(activeIntelId).name.toLowerCase()}`;

  const lastAssistantId = [...messages].reverse().find((m) => m.role === "assistant")?.id;

  let prevAssistant: ChatMessage | null = null;

  return (
    <div className="flex h-[calc(100svh-var(--pi-chrome,170px))] min-h-[420px] flex-col overflow-hidden bg-white">
      <MobilePageHeader variant="detail" title={title} subtitle={subtitle} onBack={onBack} />

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-[var(--m-gutter)] py-3">
        {messages.map((m) => {
          if (m.role !== "assistant") {
            return <UserTurn key={m.id} msg={m} />;
          }

          const intelId = personaToIntelId(m.agentId ?? thread?.agentId);
          const fromId = prevAssistant ? personaToIntelId(prevAssistant.agentId ?? thread?.agentId) : null;
          let marker: React.ReactNode = null;
          if (prevAssistant && fromId && fromId !== intelId) {
            const carriedCitations = citationsOf(prevAssistant)
              .slice(0, 3)
              .map((c) => c.label ?? c.ref ?? c.kind)
              .filter((x): x is string => Boolean(x));
            marker = (
              <HandoffMarker
                key={`handoff-${m.id}`}
                fromId={fromId}
                toId={intelId}
                carried={carriedCitations.length > 0 ? carriedCitations : getIntel(fromId).reads.split(" · ")}
              />
            );
          }
          prevAssistant = m;

          return (
            <React.Fragment key={m.id}>
              {marker}
              <AnswerBlock
                msg={m}
                intelId={intelId}
                showTrace={hasHandoff && m.id === lastAssistantId}
                onOpenSources={() => setSourcesFor(m)}
                onOpenProposal={onOpenProposal}
                onOpenTrace={onOpenTrace}
                onHandOff={() => {
                  const otherId = SC_INTEL.find((a) => a.id !== intelId)?.id ?? SC_INTEL[0].id;
                  setActiveIntelId(otherId);
                  onUpdateAgent(otherId);
                  taRef.current?.focus();
                }}
              />
            </React.Fragment>
          );
        })}

        {showWorking && <WorkingState intelId={activeIntelId} turnStartedAt={turnStartedAt} onStop={() => setStopped(true)} />}

        {error && !showWorking && (
          <div className="flex-shrink-0 rounded-[4px] border border-[#f0c7cb] bg-[#fdf2f3] px-3 py-2 text-[12.5px] text-[#8a2a30]">
            {error}
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-[#ebebeb] bg-white px-4 pb-[10px] pt-[6px]">
        <div
          className={cn(
            "rounded-[22px] border bg-white transition-colors duration-200 motion-reduce:transition-none",
            focused ? "border-[#18181b]" : "border-[#d4d4d4]",
          )}
          style={focused ? { boxShadow: "0 0 0 3px rgba(24,24,27,.09)" } : undefined}
        >
          <div className="flex items-end gap-1.5 px-2 py-1.5">
            {!input && (
              <button
                type="button"
                onClick={() => setAttachOpen(true)}
                aria-label={attached.length > 0 ? `Attach ${attached.length}` : "Attach context"}
                title="Attach context"
                className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-full text-[#525252]"
              >
                <Paperclip className="h-4 w-4" />
              </button>
            )}
            <textarea
              ref={taRef}
              rows={1}
              value={input}
              disabled={showWorking}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  submit();
                }
              }}
              placeholder={showWorking ? "Answering…" : `Ask the ${getIntel(activeIntelId).name.toLowerCase()}…`}
              className="min-h-[22px] max-h-[120px] flex-1 resize-none overflow-y-auto bg-transparent py-0.5 text-[15px] leading-[1.4] text-[#171717] outline-none placeholder:text-[#9a9a9a]"
            />
            {!input && (
              <button
                type="button"
                onClick={showWorking ? () => setStopped(true) : submit}
                disabled={!showWorking && !input.trim()}
                aria-label={showWorking ? "Stop" : "Send"}
                className={cn(
                  "grid h-[30px] w-[30px] shrink-0 place-items-center rounded-full transition-colors duration-200 motion-reduce:transition-none",
                  showWorking || input.trim() ? "bg-[#18181b] text-white" : "bg-[#f0f0f0] text-[#b8b8b8]",
                )}
              >
                {showWorking ? <Square className="h-3 w-3 fill-current" /> : <ArrowUp className="h-4 w-4" />}
              </button>
            )}
          </div>

          {Boolean(input) && (
            <div className="flex items-center justify-between gap-2 px-2 pb-1.5 pt-0.5">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setAttachOpen(true)}
                  aria-label={attached.length > 0 ? `Attach ${attached.length}` : "Attach context"}
                  title="Attach context"
                  className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-full text-[#525252]"
                >
                  <Paperclip className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setIntelSheetOpen(true)}
                  className="flex h-[30px] items-center gap-1 rounded-full border border-[#d4d4d4] px-2 font-mono text-[11px] text-[#3f3f46]"
                >
                  <IntelBadge id={activeIntelId} size={18} />
                  {getModelLabel(model)}
                  <ChevronDown className="h-3 w-3 text-[#9a9a9a]" />
                </button>
              </div>
              <button
                type="button"
                onClick={showWorking ? () => setStopped(true) : submit}
                disabled={!showWorking && !input.trim()}
                aria-label={showWorking ? "Stop" : "Send"}
                className={cn(
                  "grid h-[30px] w-[30px] shrink-0 place-items-center rounded-full transition-colors duration-200 motion-reduce:transition-none",
                  showWorking || input.trim() ? "bg-[#18181b] text-white" : "bg-[#f0f0f0] text-[#b8b8b8]",
                )}
              >
                {showWorking ? <Square className="h-3 w-3 fill-current" /> : <ArrowUp className="h-4 w-4" />}
              </button>
            </div>
          )}
        </div>
        {attached.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {attached.map((a, i) => (
              <span
                key={i}
                className="rounded-[4px] border border-[#d4d4d4] bg-white px-2 py-1 font-mono text-[10.5px] text-[#525252]"
              >
                {a.label}
              </span>
            ))}
          </div>
        )}
      </div>

      <SourcesSheet
        open={Boolean(sourcesFor)}
        citations={sourcesFor ? citationsOf(sourcesFor) : []}
        onClose={() => setSourcesFor(null)}
      />

      <IntelModelSheet
        open={intelSheetOpen}
        onClose={() => setIntelSheetOpen(false)}
        intelId={activeIntelId}
        onSelectIntel={(id) => {
          setActiveIntelId(id);
          onUpdateAgent(id);
        }}
        model={model}
        onSelectModel={onModelChange}
      />

      <AttachContextSheet
        open={attachOpen}
        projectId={thread?.projectId ?? null}
        selected={attached}
        onClose={() => setAttachOpen(false)}
        onAttach={(items) => {
          setAttached(items);
          setAttachOpen(false);
        }}
      />
    </div>
  );
}
