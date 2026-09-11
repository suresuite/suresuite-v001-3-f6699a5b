/**
 * SC Intelligences — one intelligence (screen 09, handoff §2/§9).
 *
 * Remit · data scope · autonomy · open proposals. The autonomy row is shown,
 * disabled and explained (§9) — never hidden, never softened.
 */
import { MobilePageHeader, MobilePanel, MobileRow, MobileToggle, MobileActionBar } from "@/components/mobile";
import { IntelBadge } from "../primitives";
import { getIntel } from "../intel";
import type { Proposal } from "@/hooks/useProposals";

export function IntelligenceDetail({
  intelId,
  proposals,
  onBack,
  onAsk,
  onOpenProposal,
}: {
  intelId: string;
  proposals: Proposal[];
  onBack: () => void;
  onAsk: () => void;
  onOpenProposal: (id: string) => void;
}) {
  const intel = getIntel(intelId);
  const open = proposals.filter((p) => p.agent_id === intelId && (p.status === "proposed" || p.status === "draft"));

  return (
    <div className="flex h-[calc(100svh-var(--pi-chrome,170px))] min-h-[420px] flex-col overflow-hidden bg-white">
      <MobilePageHeader variant="detail" title={intel.name} subtitle={intel.badge} onBack={onBack} />

      <div className="min-h-0 flex-1 overflow-y-auto px-[var(--m-gutter)] pb-4">
        <div className="mb-4 flex items-start gap-3">
          <IntelBadge id={intelId} size={24} />
          <p className="text-[13.5px] leading-[1.55] text-[#3f3f46] [text-wrap:pretty]">{intel.remit}</p>
        </div>

        <MobilePanel label="Data scope" className="mb-4">
          <div className="px-3 py-2.5 text-[13px] leading-[1.5] text-[#3f3f46]">
            Reads: <span className="font-mono text-[12px] text-[#525252]">{intel.reads}</span>
          </div>
          <div className="border-t border-[#e8e8ea] px-3 py-2.5 text-[12.5px] leading-[1.5] text-[#525252]">
            It cannot edit a policy or queue a run. Both require your acceptance.
          </div>
        </MobilePanel>

        <MobilePanel label="Autonomy" className="mb-4">
          <MobileRow
            label="Answer when asked"
            trailing={<MobileToggle checked disabled onChange={() => {}} label="Answer when asked" />}
            chevron={false}
          />
          <MobileRow
            label="Flag / propose unprompted"
            trailing={<MobileToggle checked disabled onChange={() => {}} label="Flag or propose unprompted" />}
            chevron={false}
          />
          <MobileRow
            label="Act on its own"
            trailing={<MobileToggle checked={false} disabled onChange={() => {}} label="Act on its own" />}
            chevron={false}
            note="Auto isn't available: it unlocks only after sustained accepted-proposal rates, org opt-in, and resolved identities."
          />
        </MobilePanel>

        <MobilePanel label="Open proposals" counter={open.length || undefined}>
          {open.length === 0 && (
            <div className="px-3 py-4 text-[13.5px] text-[#525252]">Nothing awaiting your decision.</div>
          )}
          {open.map((p) => (
            <MobileRow key={p.id} onClick={() => onOpenProposal(p.id)} label={p.title} sub="awaiting your decision" />
          ))}
        </MobilePanel>
      </div>

      <MobileActionBar primary={{ label: `Ask the ${intel.name.toLowerCase()}`, onClick: onAsk }} />
    </div>
  );
}
