import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { LAYER } from "@/components/intelligence/piUi";

/**
 * The run gate's findings table. The gate itself — reason, button, readout — is
 * one `RunGateState` (lib/sim/runGate.ts) rendered by RunCard (WP 9.4 slice 2).
 */

const SEV_COLOR: Record<string, string> = { block: LAYER.brand, warn: LAYER.firm, info: "#d4d4d8" };

export interface Finding {
  id: string;
  severity: "block" | "warn" | "info";
  field?: string;
  policy?: string;
  message: string;
  hint?: string;
}

export function FindingsPanel<F extends Finding>({
  findings,
  source,
  warns,
  acknowledged,
  onAcknowledge,
  renderFix,
}: {
  findings: F[];
  source: string;
  warns: number;
  acknowledged: boolean;
  /** omitted when the acknowledgement lives elsewhere (RunCard) */
  onAcknowledge?: () => void;
  /** per-finding inline remediation (e.g. supplier assignment) */
  renderFix?: (f: F) => ReactNode;
}) {
  const groups = (["block", "warn", "info"] as const)
    .map((sev) => ({ sev, items: findings.filter((f) => f.severity === sev) }))
    .filter((g) => g.items.length > 0);

  return (
    <section className="rounded-sm border border-[--hair-rule] bg-white">
      <div className="flex items-center gap-[9px] border-b border-[--hair-rule] px-3 py-[9px]">
        <span className="text-[13.5px] font-semibold tracking-[-0.011em] text-[#18181b]">
          Required-data gate
        </span>
        <span className="rounded-sm bg-[#f0f0f2] px-1.5 py-px text-[11px] text-[#52525b]">{source}</span>
        <span className="ml-auto text-[11.5px] text-[#52525b]">
          {findings.length} {findings.length === 1 ? "finding" : "findings"}
        </span>
      </div>

      {findings.length === 0 ? (
        <div className="flex items-center gap-[9px] px-3 py-[10px]">
          <span className="h-[7px] w-[7px] rounded-full bg-[#14b8c4]" />
          <span className="text-[13px] text-[#18181b]">
            All clear — this scenario dispatches with no findings
          </span>
        </div>
      ) : null}

      {groups.map((g) => (
        <div key={g.sev}>
          <div className="flex items-center gap-2 border-b border-[--hair-rule] bg-[#fafafa] px-3 py-1.5">
            <span className="h-[7px] w-[7px] rounded-full" style={{ background: SEV_COLOR[g.sev] }} />
            <span
              className="text-[10.5px] font-semibold uppercase tracking-[0.08em]"
              style={{ color: SEV_COLOR[g.sev] }}
            >
              {g.sev}
            </span>
            <span className="rounded-sm bg-[#f0f0f2] px-[7px] py-px text-[11.5px] text-[#52525b]">
              {g.items.length}
            </span>
          </div>

          {g.items.map((f) => (
            <div
              key={f.id}
              className="flex flex-col gap-1.5 border-b border-l-2 border-b-[--sim-divider] px-3 py-[9px] md:flex-row md:gap-3"
              style={{ borderLeftColor: SEV_COLOR[g.sev] }}
            >
              <div className="min-w-0 flex-1">
                <div className="text-[13px] leading-[1.4] text-[#18181b]">{f.message}</div>
                <div className="mt-[3px] text-[11.5px] text-[--zinc-quiet]">
                  {[f.field, f.policy && f.policy !== "engine" ? `demanded by ${f.policy}` : f.policy]
                    .filter(Boolean)
                    .join(" · ")}
                </div>
                {renderFix?.(f)}
              </div>
              {f.hint ? (
                <span className="min-w-0 text-[11.5px] leading-[1.4] text-[--zinc-quiet] [text-wrap:pretty]">{f.hint}</span>
              ) : null}
            </div>
          ))}
        </div>
      ))}

      {warns > 0 && onAcknowledge ? (
        <button
          type="button"
          onClick={onAcknowledge}
          className="flex min-h-11 w-full items-center gap-2 border-t border-[--hair-rule] bg-[#fafafa] px-3 py-[10px] text-left md:min-h-0"
        >
          <span
            className={cn(
              "flex h-[14px] w-[14px] shrink-0 items-center justify-center rounded-sm border text-[10px] leading-none text-white",
              acknowledged ? "border-foreground bg-foreground" : "border-[#d4d4d8] bg-white",
            )}
          >
            {acknowledged ? "✓" : ""}
          </span>
          <span className="text-[13px] text-[#18181b]">
            Acknowledge {warns} {warns === 1 ? "warning" : "warnings"} — the engine applies its defaults
          </span>
        </button>
      ) : null}
    </section>
  );
}
