import { useEffect, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { LAYER } from "@/components/intelligence/piUi";
import { CredibilityBadge } from "./CredibilityBadge";
import type { Credibility } from "@/hooks/useModelValidation";
import type { RunGateState } from "@/lib/sim/runGate";

/**
 * The Run pane as one card (WP 9.4 slice 2).
 *
 * Header: the model version, its credibility, the one reason the run cannot
 * dispatch (if any) and the Run button — all four read from the same
 * `RunGateState`, so they cannot disagree (§4 D147). The acknowledgement sits
 * beside the button it unlocks. The findings open on their own when they are
 * what stands between the user and the run, and otherwise collapse to a count;
 * they are never hidden while they block or need a tick.
 */
export function RunCard({
  versionText,
  credibility,
  gate,
  warns,
  acknowledged,
  onAcknowledgedChange,
  findingsCount,
  onRun,
  onSaveVersionAndRun,
  needsSave,
  findings,
  capacity,
  progress,
  estimate,
}: {
  versionText: string;
  credibility: Credibility | null;
  gate: RunGateState;
  warns: number;
  acknowledged: boolean;
  onAcknowledgedChange: (v: boolean) => void;
  /** null while the check is still loading */
  findingsCount: number | null;
  onRun: () => void;
  onSaveVersionAndRun: () => void;
  needsSave: boolean;
  findings: ReactNode;
  capacity: ReactNode;
  progress: ReactNode;
  /** WP 10.5 — replication-weeks and expected storage, with its basis. */
  estimate?: ReactNode;
}) {
  const mustSee = gate.kind === "blocked" || gate.kind === "ack_required";
  const [showFindings, setShowFindings] = useState(mustSee);
  useEffect(() => {
    if (mustSee) setShowFindings(true);
  }, [mustSee]);

  const reasonColor = gate.kind === "blocked" ? LAYER.brand : gate.kind === "ack_required" ? LAYER.firm : "#71717a";
  const askAck = warns > 0 && (gate.kind === "ack_required" || gate.kind === "clear");

  return (
    <div className="flex flex-col gap-3">
      <section className="overflow-hidden rounded-sm border border-[--hair-rule] bg-white">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-[9px] md:flex-nowrap">
          <span className="min-w-0 truncate text-[12.5px] text-[#18181b]" title={versionText}>
            {versionText}
          </span>
          {credibility ? <CredibilityBadge credibility={credibility} /> : null}
          {/* §3.1: a disabled control's reason is never truncated below md. */}
          <span
            className="min-w-0 flex-1 basis-full text-right text-[12.5px] [text-wrap:pretty] md:basis-auto md:truncate"
            style={{ color: reasonColor }}
            title={gate.reason ?? undefined}
          >
            {gate.reason ?? ""}
          </span>
          <button
            type="button"
            disabled={!gate.canRun}
            onClick={needsSave ? onSaveVersionAndRun : onRun}
            className={cn(
              "h-[30px] min-h-11 shrink-0 rounded-sm border px-5 text-[13px] font-medium md:min-h-0",
              gate.canRun
                ? "border-foreground bg-foreground text-background"
                : "cursor-not-allowed border-[--hair-rule] bg-[#f4f4f5] text-[#a1a1aa]",
            )}
          >
            {gate.button}
          </button>
        </div>

        {askAck ? (
          <label className="flex min-h-11 cursor-pointer items-center gap-2 border-t border-[--hair-rule] bg-[#fafafa] px-3 py-2 text-[12.5px] text-[#18181b] md:min-h-0">
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(e) => onAcknowledgedChange(e.target.checked)}
              className="h-[14px] w-[14px] accent-foreground"
            />
            Run with engine defaults for {warns} {warns === 1 ? "warning" : "warnings"}
          </label>
        ) : null}

        <button
          type="button"
          onClick={() => setShowFindings((v) => !v)}
          className="flex min-h-11 w-full items-center gap-2 border-t border-[--hair-rule] px-3 py-[7px] text-left text-[12px] text-[#52525b] hover:bg-[#fafafa] md:min-h-0"
          aria-expanded={showFindings}
        >
          <span className="font-medium text-[#18181b]">Pre-run check</span>
          <span className="tabular-nums">
            {findingsCount === null
              ? "checking…"
              : findingsCount === 0
                ? "all clear"
                : `${findingsCount} ${findingsCount === 1 ? "finding" : "findings"}`}
          </span>
          <span className="ml-auto">{showFindings ? "hide" : "show"}</span>
        </button>
      </section>

      {showFindings ? findings : null}
      {estimate}
      {capacity}
      {progress}
    </div>
  );
}
