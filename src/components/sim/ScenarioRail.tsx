import { cn } from "@/lib/utils";
import type { Scenario } from "@/hooks/useScenarios";
import type { Credibility } from "@/hooks/useModelValidation";

/**
 * Left column, top to bottom:
 *   1. ExperimentLibraryBox — the only teal thing on the page, so the way to
 *      start a new stress test is impossible to miss.
 *   2. ScenarioList — one row per scenario, credibility dot, duplicate + delete
 *      always visible (they used to appear only on the selected row, which is
 *      why nobody could find delete).
 *
 * The library is a SOURCE of scenarios, not a scenario — hence a separate
 * surface, a different colour, and a drawer for its detail.
 */

const CRED_COLOR: Record<Credibility["state"], string> = {
  validated: "#14b8c4",
  stale: "#e0930b",
  unvalidated: "#d4d4d8",
};
const CRED_TITLE: Record<Credibility["state"], string> = {
  validated: "model validated",
  stale: "validation stale — something drifted",
  unvalidated: "model unvalidated",
};

export function ExperimentLibraryBox({
  count,
  open,
  onToggle,
}: {
  count: number;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      title="Browse stress-test experiment presets"
      className={cn(
        "mb-3 flex w-full items-center gap-[10px] rounded-sm border px-[14px] py-3 text-left hover:border-foreground",
        open
          ? "border-[#14b8c4] bg-[#e8f7f8] shadow-[0_0_0_3px_rgba(20,184,196,0.16)]"
          : "border-[rgba(20,184,196,0.45)] bg-[rgba(20,184,196,0.07)]",
      )}
    >
      <span className="flex min-w-0 flex-col gap-[3px]">
        <span className="flex items-center gap-[7px]">
          <span className="h-[7px] w-[7px] shrink-0 rounded-full bg-[#14b8c4]" />
          <span className="text-[13px] font-semibold tracking-[-0.011em] text-[#18181b]">
            Stress-test experiments
          </span>
        </span>
        <span className="text-[11.5px] text-[#3f3f46]">{count} presets ready to run</span>
      </span>
      <span className="ml-auto shrink-0 text-[13px] text-[#0e7f88]">{open ? "▾" : "▸"}</span>
    </button>
  );
}

export function ScenarioList({
  scenarios,
  selectedId,
  loading,
  credibilityFor,
  onSelect,
  onCreate,
  onDuplicate,
  onDelete,
  onBrowseSaved,
}: {
  scenarios: Scenario[];
  selectedId: string | null;
  loading?: boolean;
  /** B0b (§2.6): per-row credibility dot — derived, never stored. */
  credibilityFor?: (s: Scenario) => Credibility;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onDuplicate: (s: Scenario) => void;
  onDelete: (id: string) => void;
  /** Opens the saved-experiment library (scenario templates). */
  onBrowseSaved: () => void;
}) {
  return (
    <aside className="overflow-hidden rounded-sm border border-[--hair-rule] bg-white">
      <div className="flex items-center justify-between gap-2 border-b border-[--hair-rule] px-[14px] py-[11px]">
        <span className="text-[13.5px] font-semibold tracking-[-0.011em] text-[#18181b]">Scenarios</span>
        <span className="flex items-center gap-[6px]">
          <button
            type="button"
            onClick={onBrowseSaved}
            title="Browse the saved experiment library"
            className="h-6 rounded-sm border border-[--hair-rule] px-2 text-[11.5px] leading-none text-[#52525b] hover:border-foreground hover:text-foreground"
          >
            Library
          </button>
          <button
            type="button"
            onClick={onCreate}
            title="New scenario"
            className="h-6 w-6 rounded-sm border border-[--hair-rule] text-[14px] leading-none text-[#52525b] hover:border-foreground hover:text-foreground"
          >
            +
          </button>
        </span>
      </div>

      <div className="max-h-[420px] overflow-y-auto">
        {loading ? (
          <div className="px-[14px] py-3 text-[12.5px] text-[--zinc-quiet]">Loading…</div>
        ) : null}
        {!loading && scenarios.length === 0 ? (
          <div className="px-[14px] py-3 text-[12.5px] text-[--zinc-quiet]">
            No scenarios yet — create one, or launch a stress test above.
          </div>
        ) : null}
        {scenarios.map((s) => {
          const on = s.id === selectedId;
          const cred = credibilityFor?.(s) ?? null;
          const events = s.disruption_schedule?.length ?? 0;
          return (
            <div
              key={s.id}
              onClick={() => onSelect(s.id)}
              className={cn(
                "flex cursor-pointer items-start gap-[10px] border-b border-l-2 border-b-[--sim-divider] px-[14px] py-3",
                on ? "border-l-foreground bg-[#fafafa]" : "border-l-transparent bg-white",
              )}
            >
              <span
                className="mt-1.5 h-[7px] w-[7px] shrink-0 rounded-full"
                style={{ background: cred ? CRED_COLOR[cred.state] : "#d4d4d8" }}
                title={cred ? CRED_TITLE[cred.state] : "model unvalidated"}
              />
              <div className="flex min-w-0 flex-1 flex-col gap-[5px]">
                <span
                  className={cn(
                    "truncate text-[13.5px] leading-[1.35]",
                    on ? "font-semibold" : "font-medium",
                  )}
                >
                  {s.name || "Untitled scenario"}
                </span>
                <span className="truncate text-[12.5px] tabular-nums text-[#52525b]">
                  {s.replications} reps · {s.horizon_days}d ·{" "}
                  {events > 0 ? `${events} event${events > 1 ? "s" : ""}` : "steady state"}
                </span>
              </div>

              {/* always visible — discoverability, not hover-roulette */}
              <div className="mt-px flex shrink-0 items-center gap-[2px]">
                <button
                  type="button"
                  title="Duplicate scenario"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDuplicate(s);
                  }}
                  className="h-6 w-6 rounded-sm border border-transparent text-[12px] leading-none text-[#a1a1aa] hover:border-[--hair-rule] hover:bg-white hover:text-[#18181b]"
                >
                  ⧉
                </button>
                <button
                  type="button"
                  title="Delete scenario"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (confirm(`Delete scenario "${s.name}"?`)) onDelete(s.id);
                  }}
                  className="h-6 w-6 rounded-sm border border-transparent text-[13px] leading-none text-[#a1a1aa] hover:border-[--hair-rule] hover:bg-white hover:text-[#BF2330]"
                >
                  ✕
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </aside>
  );
}
