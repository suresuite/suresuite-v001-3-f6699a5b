/**
 * SC Intelligences — attach context (screen 04, handoff §2).
 *
 * A sheet over the new-question screen: segmented Runs / Policies / Network,
 * credibility per row, multi-select, footer states the count.
 */
import * as React from "react";
import { MobileSheet } from "@/components/shared/MobileSheet";
import { MobileSegmented, MobileButton, type SegmentedItem } from "@/components/mobile";
import { CredibilityChip } from "../primitives";
import { useScenarios } from "@/hooks/useScenarios";
import { useScenarioRuns } from "@/hooks/useScenarioRuns";
import { usePolicies } from "@/hooks/usePolicies";
import { cn } from "@/lib/utils";

export interface AttachedItem {
  kind: "run" | "policy" | "network";
  id: string;
  label: string;
}

const NETWORK_LENSES: AttachedItem[] = [
  { kind: "network", id: "firm", label: "Firm level network" },
  { kind: "network", id: "product", label: "Product level network" },
  { kind: "network", id: "process", label: "Process level network" },
];

interface RowSpec {
  item: AttachedItem;
  sub: string;
  status: "validated" | "stale" | "neutral";
}

export function AttachContextSheet({
  open,
  projectId,
  selected,
  onClose,
  onAttach,
}: {
  open: boolean;
  projectId: string | null;
  selected: AttachedItem[];
  onClose: () => void;
  onAttach: (items: AttachedItem[]) => void;
}) {
  const [tab, setTab] = React.useState<"run" | "policy" | "network">("run");
  const [picked, setPicked] = React.useState<AttachedItem[]>(selected);
  React.useEffect(() => {
    if (open) setPicked(selected);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const { scenarios } = useScenarios(projectId);
  const { runsByScenario } = useScenarioRuns(projectId);
  const { versions, isDirty } = usePolicies(projectId);

  const runRows: RowSpec[] = React.useMemo(
    () =>
      scenarios
        .filter((s) => runsByScenario[s.id])
        .map((s) => {
          const run = runsByScenario[s.id];
          return {
            item: { kind: "run" as const, id: run.id, label: s.name },
            sub: `done · rep ${run.rep_count_done}/${run.rep_count_target}`,
            status: "validated" as const,
          };
        }),
    [scenarios, runsByScenario],
  );

  const policyRows: RowSpec[] = React.useMemo(() => {
    const rows: RowSpec[] = versions.map((v) => ({
      item: { kind: "policy" as const, id: v.id, label: v.label ?? `Saved ${new Date(v.created_at).toLocaleDateString()}` },
      sub: new Date(v.created_at).toLocaleString(),
      status: "validated" as const,
    }));
    if (isDirty) {
      rows.unshift({
        item: { kind: "policy" as const, id: "__current__", label: "Current (unsaved)" },
        sub: "Edited since the last saved version",
        status: "stale",
      });
    }
    return rows;
  }, [versions, isDirty]);

  const networkRows: RowSpec[] = NETWORK_LENSES.map((item) => ({
    item,
    sub: "structural view",
    status: "neutral" as const,
  }));

  const rows = tab === "run" ? runRows : tab === "policy" ? policyRows : networkRows;

  const toggle = (item: AttachedItem) => {
    setPicked((prev) =>
      prev.some((p) => p.id === item.id && p.kind === item.kind)
        ? prev.filter((p) => !(p.id === item.id && p.kind === item.kind))
        : [...prev, item],
    );
  };

  return (
    <MobileSheet
      open={open}
      title="Attach context"
      sub="Grounds the answer in a specific run, policy version or network view."
      onClose={onClose}
      footer={
        <>
          <MobileButton weight="secondary" onClick={onClose}>
            Cancel
          </MobileButton>
          <MobileButton block weight="primary" onClick={() => onAttach(picked)} disabled={picked.length === 0}>
            {picked.length > 0 ? `Attach ${picked.length}` : "Attach"}
          </MobileButton>
        </>
      }
    >
      <div className="px-3 pt-3">
        <MobileSegmented<"run" | "policy" | "network">
          ariaLabel="Context kind"
          value={tab}
          onChange={setTab}
          items={
            [
              { value: "run", label: "Runs", count: runRows.length || undefined },
              { value: "policy", label: "Policies", count: policyRows.length || undefined },
              { value: "network", label: "Network" },
            ] satisfies SegmentedItem<"run" | "policy" | "network">[]
          }
        />
      </div>
      <div className="mt-2">
        {rows.length === 0 && (
          <div className="px-3 py-4 text-[13.5px] text-[#525252]">Nothing to attach here yet.</div>
        )}
        {rows.map((r) => {
          const checked = picked.some((p) => p.id === r.item.id && p.kind === r.item.kind);
          return (
            <button
              key={r.item.kind + r.item.id}
              type="button"
              onClick={() => toggle(r.item)}
              className={cn(
                "flex w-full min-h-11 items-center gap-2.5 border-b border-[#e8e8ea] bg-white px-3 py-[var(--m-row-y)] text-left last:border-b-0",
                "active:bg-[#fafafa]",
              )}
            >
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate text-[13.5px] font-medium text-[#171717]">{r.item.label}</span>
                <span className="font-mono text-[10.5px] text-[#525252]">{r.sub}</span>
              </span>
              <CredibilityChip status={r.status}>{r.status}</CredibilityChip>
              {checked && (
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"
                  strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-[#18181b]" aria-hidden>
                  <path d="M20 6 9 17l-5-5" />
                </svg>
              )}
            </button>
          );
        })}
      </div>
    </MobileSheet>
  );
}
