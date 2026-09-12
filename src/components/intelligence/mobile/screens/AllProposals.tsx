/**
 * SC Intelligences — all proposals (screen 09/09b, mobile handoff pass).
 *
 * The root's Proposals panel only ever shows what's awaiting a decision; this
 * is the full inbox, split Awaiting/Decided and, within each, grouped by
 * what a proposal actually writes — the thing a user is deciding, not which
 * intelligence filed it.
 */
import * as React from "react";
import { Inbox } from "lucide-react";
import { MobilePageHeader, MobileSegmented, MobileNote, MobilePanel, MobileRow } from "@/components/mobile";
import { IntelBadge, CredibilityChip } from "../primitives";
import type { Proposal } from "@/hooks/useProposals";

const AWAITING: Proposal["status"][] = ["proposed", "draft"];
const DECIDED: Proposal["status"][] = ["approved", "applied", "rejected", "expired"];

function writesLabel(p: Proposal): string {
  return p.artifact_type === "policy_bundle_diff" ? "writes a policy version" : "writes project data";
}

function groupByWrite(list: Proposal[]): Array<{ label: string; rows: Proposal[] }> {
  const groups = new Map<string, Proposal[]>();
  for (const p of list) {
    const key = writesLabel(p);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(p);
  }
  return [...groups.entries()].map(([label, rows]) => ({ label, rows }));
}

export function AllProposals({
  proposals,
  onBack,
  onOpen,
}: {
  proposals: Proposal[];
  onBack: () => void;
  onOpen: (id: string) => void;
}) {
  const [tab, setTab] = React.useState<"awaiting" | "decided">("awaiting");
  const awaiting = React.useMemo(() => proposals.filter((p) => AWAITING.includes(p.status)), [proposals]);
  const decided = React.useMemo(
    () => proposals.filter((p) => DECIDED.includes(p.status)).sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1)),
    [proposals],
  );

  const rows = tab === "awaiting" ? awaiting : decided;
  const groups = groupByWrite(rows);

  return (
    <>
      <MobilePageHeader variant="detail" title="All proposals" onBack={onBack}>
        <MobileSegmented<"awaiting" | "decided">
          ariaLabel="Proposal status"
          value={tab}
          onChange={setTab}
          items={[
            { value: "awaiting", label: "Awaiting", count: awaiting.length },
            { value: "decided", label: "Decided", count: decided.length },
          ]}
        />
      </MobilePageHeader>

      <div className="flex flex-col gap-3 px-[var(--m-gutter)] pb-4">
        {tab === "awaiting" && awaiting.length === 0 ? (
          <AwaitingEmpty decided={decided} onOpen={onOpen} />
        ) : (
          <>
            {groups.map((g) => (
              <MobilePanel key={g.label} label={g.label} counter={g.rows.length}>
                {g.rows.map((p) => (
                  <MobileRow
                    key={p.id}
                    onClick={() => onOpen(p.id)}
                    leading={<IntelBadge id={p.agent_id} />}
                    label={p.title}
                    sub={p.status === "proposed" || p.status === "draft" ? "awaiting your decision" : p.status}
                  />
                ))}
              </MobilePanel>
            ))}

            <MobileNote tone="caveat">
              Nothing here has changed the project — a proposal writes only when you accept it.
            </MobileNote>
          </>
        )}
      </div>
    </>
  );
}

function AwaitingEmpty({ decided, onOpen }: { decided: Proposal[]; onOpen: (id: string) => void }) {
  const lastDecided = decided.slice(0, 4);
  return (
    <>
      <div className="flex flex-col items-center gap-2 py-8 text-center">
        <Inbox className="h-6 w-6 text-[#9a9a9a]" strokeWidth={1.6} />
        <p className="max-w-[240px] text-[13.5px] leading-[1.5] text-[#525252]">
          Nothing is waiting on you. The intelligences file a proposal here when there's a decision to make.
        </p>
      </div>

      {lastDecided.length > 0 && (
        <MobilePanel label="Last decided" counter={lastDecided.length}>
          {lastDecided.map((p) => (
            <MobileRow
              key={p.id}
              onClick={() => onOpen(p.id)}
              leading={<IntelBadge id={p.agent_id} />}
              label={p.title}
              sub={p.status}
              trailing={
                <CredibilityChip status={p.status === "rejected" ? "rejected" : "validated"}>
                  {p.status === "rejected" ? "rejected" : "✓ applied"}
                </CredibilityChip>
              }
            />
          ))}
        </MobilePanel>
      )}
    </>
  );
}
