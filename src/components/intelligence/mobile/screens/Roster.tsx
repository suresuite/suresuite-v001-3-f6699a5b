/**
 * SC Intelligences — all intelligences (screen 08, handoff §2).
 */
import { MobilePageHeader, MobilePanel, MobileRow } from "@/components/mobile";
import { IntelBadge } from "../primitives";
import { SC_INTEL } from "../intel";

export function Roster({ onBack, onOpen }: { onBack: () => void; onOpen: (id: string) => void }) {
  return (
    <>
      <MobilePageHeader variant="detail" title="All intelligences" onBack={onBack} />
      <div className="px-[var(--m-gutter)] pb-4">
        <MobilePanel label="SC Intelligences" counter={SC_INTEL.length}>
          {SC_INTEL.map((a) => (
            <MobileRow
              key={a.id}
              onClick={() => onOpen(a.id)}
              leading={<IntelBadge id={a.id} size={24} />}
              label={a.name}
              sub={a.remit}
            />
          ))}
        </MobilePanel>
      </div>
    </>
  );
}
