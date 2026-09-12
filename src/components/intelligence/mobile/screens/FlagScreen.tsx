/**
 * SC Intelligences — unprompted flag (mobile handoff pass).
 *
 * In-app only, no push, no app-icon badge (decided). A flag is a proposal
 * with no owning thread — an intelligence raised it on its own rather than
 * in answer to a question — surfaced here rather than folded into the normal
 * proposal review so "nothing was sent" reads as true: opening this screen
 * only marks it read, it never reviews the proposal itself.
 */
import * as React from "react";
import { MobilePageHeader, MobileActionBar, MobileNote } from "@/components/mobile";
import { IntelBadge } from "../primitives";
import { getIntel } from "../intel";
import type { Proposal } from "@/hooks/useProposals";
import { markProposalViewed } from "../viewedFlags";

export function FlagScreen({
  proposal,
  onBack,
  onDismiss,
  onSeeProposal,
}: {
  proposal: Proposal | undefined;
  onBack: () => void;
  onDismiss: () => void;
  onSeeProposal: () => void;
}) {
  React.useEffect(() => {
    if (proposal) markProposalViewed(proposal.id);
  }, [proposal]);

  if (!proposal) {
    return (
      <div className="flex h-[calc(100svh-var(--pi-chrome,170px))] flex-col bg-white">
        <MobilePageHeader variant="detail" title="Flag" onBack={onBack} />
        <div className="px-[var(--m-gutter)] py-6 text-[13.5px] text-[#525252]">
          This flag is no longer available.
        </div>
      </div>
    );
  }

  const intel = getIntel(proposal.agent_id);
  const gap = proposal.status_reason ?? (proposal.payload as { rationale?: string })?.rationale ?? proposal.title;
  const sources = Array.isArray(proposal.citations)
    ? proposal.citations.map((c) => `${String(c.kind ?? "ref")} ${String(c.ref ?? "")}`.trim()).filter(Boolean)
    : [];

  return (
    <div className="flex h-[calc(100svh-var(--pi-chrome,170px))] min-h-[420px] flex-col overflow-hidden bg-white">
      <MobilePageHeader variant="detail" title="Flag" subtitle={`${intel.badge} · ${intel.name.toLowerCase()}`} onBack={onBack} />

      <div className="min-h-0 flex-1 overflow-y-auto px-[var(--m-gutter)] pb-4">
        <MobileNote>Nothing was changed and nothing was sent — flags stay in the app.</MobileNote>

        <div className="mt-3 mb-1 flex items-center gap-2">
          <IntelBadge id={proposal.agent_id} />
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[#525252]">
            raised without being asked
          </span>
        </div>
        <h2 className="mb-3 text-[20px] font-semibold leading-tight tracking-[-0.019em] text-[#171717]">
          {proposal.title}
        </h2>

        <div className="mb-4 overflow-hidden rounded-[4px] border border-[#d4d4d4]">
          <div className="border-b border-[#d4d4d4] bg-[#fafafa] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em] text-[#525252]">
            the gap
          </div>
          <p className="px-3 py-3 text-[13.5px] leading-[1.55] text-[#3f3f46] [text-wrap:pretty]">{gap}</p>
        </div>

        {sources.length > 0 && (
          <div className="mb-4">
            <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.14em] text-[#8a8a8a]">sources</div>
            {sources.map((s, i) => (
              <div key={i} className="flex gap-2 border-t border-[#e8e8ea] py-1.5 text-[12px] first:border-t-0">
                <span className="font-mono text-[#bf2330]">[{i + 1}]</span>
                <span className="font-mono text-[#525252]">{s}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <MobileActionBar
        secondary={{ label: "Dismiss", onClick: onDismiss }}
        primary={{ label: "See the proposal", onClick: onSeeProposal }}
        note="Dismiss only clears this flag. Seeing the proposal is still a separate decision — nothing changes until you accept it there."
      />
    </div>
  );
}
