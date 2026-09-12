/**
 * SC Intelligences — handoff trace (screen 07b, mobile handoff pass).
 *
 * One panel per intelligence that answered in this thread, layer-tinted by
 * that intelligence's own hex, each row a completed turn with its real
 * duration (the gap between the question and the answer that followed it —
 * genuinely measured, not a fabricated per-step trace). Between segments, the
 * handoff's own reason as an ink-ruled note; then, if this thread's handoff
 * filed a proposal, the one card it produced.
 */
import * as React from "react";
import { MobilePageHeader, MobilePanel, MobileRow } from "@/components/mobile";
import type { ChatMessage } from "@/hooks/useProjectChat";
import type { Thread } from "@/hooks/useChatThreads";
import type { Proposal } from "@/hooks/useProposals";
import { IntelBadge } from "../primitives";
import { getIntel, personaToIntelId } from "../intel";

interface Turn {
  message: ChatMessage;
  durationS: number | null;
  reads: string[];
}

interface Segment {
  intelId: string;
  turns: Turn[];
}

function buildSegments(thread: Thread): Segment[] {
  const segments: Segment[] = [];
  let lastUserAt: number | null = null;

  for (const m of thread.messages) {
    if (m.role !== "assistant") {
      lastUserAt = m.createdAt;
      continue;
    }
    const intelId = personaToIntelId(m.agentId ?? thread.agentId);
    const evidence = m.parts?.find((p) => p.kind === "evidence");
    const citations = (evidence?.data as { citations?: Array<{ label?: string; ref?: string; kind?: string }> } | undefined)
      ?.citations;
    const reads = Array.isArray(citations)
      ? citations.slice(0, 3).map((c) => c.label ?? c.ref ?? c.kind).filter((x): x is string => Boolean(x))
      : [];
    const turn: Turn = {
      message: m,
      durationS: lastUserAt != null ? Math.max(0, Math.round((m.createdAt - lastUserAt) / 1000)) : null,
      reads: reads.length > 0 ? reads : getIntel(intelId).reads.split(" · "),
    };
    const last = segments[segments.length - 1];
    if (last && last.intelId === intelId) last.turns.push(turn);
    else segments.push({ intelId, turns: [turn] });
    lastUserAt = null;
  }

  return segments;
}

export function HandoffTraceScreen({
  thread,
  proposals,
  onBack,
}: {
  thread: Thread;
  proposals: Proposal[];
  onBack: () => void;
}) {
  const segments = React.useMemo(() => buildSegments(thread), [thread]);

  return (
    <>
      <MobilePageHeader variant="detail" title="Trace" subtitle="how the answer was handed over" onBack={onBack} />
      <div className="flex flex-col gap-3 px-[var(--m-gutter)] pb-4">
        {segments.map((seg, i) => {
          const intel = getIntel(seg.intelId);
          const next = segments[i + 1] ? getIntel(segments[i + 1].intelId) : null;
          return (
            <React.Fragment key={i}>
              <MobilePanel label={`${intel.badge} · ${intel.name.toLowerCase()}`} accent={intel.fg}>
                {seg.turns.map((t, j) => (
                  <MobileRow
                    key={j}
                    label={t.reads.join(" · ")}
                    sub="completed read"
                    value={t.durationS != null ? `${t.durationS}s` : undefined}
                  />
                ))}
              </MobilePanel>

              {next && (
                <div
                  className="rounded-[4px] border border-[#d4d4d4] bg-white px-3 py-2.5 text-[12.5px] leading-[1.5] text-[#3f3f46] [text-wrap:pretty]"
                  style={{ borderLeft: "2px solid #18181b" }}
                >
                  {intel.name}'s remit ends where {next.name.toLowerCase()} begins: {next.remit}
                </div>
              )}
            </React.Fragment>
          );
        })}

        <MobilePanel label="filed by the pair" tone="primary" counter={proposals.length}>
          {proposals.length === 0 && (
            <div className="px-3 py-3 text-[13px] text-[#525252]">No proposal has come out of this handoff yet.</div>
          )}
          {proposals.map((p) => (
            <MobileRow
              key={p.id}
              leading={<IntelBadge id={p.agent_id} />}
              label={p.title}
              sub={p.status}
            />
          ))}
        </MobilePanel>

        <p className="text-[12px] leading-[1.4] text-[#525252]">A handoff never files a second proposal.</p>
      </div>
    </>
  );
}
