import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { LAYER } from "@/components/intelligence/piUi";

/**
 * The run gate, made legible without being louder.
 *
 * runBlockedReason used to hide in a `title` attribute on a disabled button.
 * Now: dots + counts sit next to the Run control, the reason is visible text,
 * and the findings table stays the detail. The acknowledge-to-run path is
 * unchanged — same ackWarnings state, same dispatch call.
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

export function GateBar({
  blocks,
  warns,
  acknowledged,
  reason,
  dirty,
  onRun,
  onSaveVersionAndRun,
  onShowFindings,
}: {
  blocks: number;
  warns: number;
  acknowledged: boolean;
  reason: string | null;
  dirty: boolean;
  onRun: () => void;
  onSaveVersionAndRun: () => void;
  onShowFindings: () => void;
}) {
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const canRun = !reason;

  return (
    // Three children on one non-wrapping row squeeze to nothing at 320px.
    <div className="flex flex-wrap items-center gap-3 border-t border-[--hair-rule] bg-[#fafafa] px-3 py-[9px] md:flex-nowrap">
      <button
        type="button"
        onClick={onShowFindings}
        className="flex min-h-11 items-center gap-3 rounded-sm border border-[--hair-rule] bg-white px-[10px] py-[5px] md:min-h-0"
      >
        <span className="flex items-center gap-[7px]">
          <span
            className="h-[7px] w-[7px] rounded-full"
            style={{ background: blocks > 0 ? LAYER.brand : "#d4d4d8" }}
          />
          <span className="whitespace-nowrap text-[12.5px] text-[#27272a]">
            {plural(blocks, "blocking finding", "blocking findings")}
          </span>
        </span>
        <span className="flex items-center gap-[7px]">
          <span
            className="h-[7px] w-[7px] rounded-full"
            style={{
              background: warns > 0 ? (acknowledged ? LAYER.process : LAYER.firm) : "#d4d4d8",
            }}
          />
          <span className="whitespace-nowrap text-[12.5px] text-[#27272a]">
            {plural(warns, "warning", "warnings")}
          </span>
        </span>
      </button>

      {/* the Run control always says why it can't fire */}
      {/* §3.1: the reason a control is disabled is on the never-truncate
          list. It wraps below `md`; `md:truncate` is the desktop literal. */}
      <span
        className="min-w-0 flex-1 basis-full text-[12.5px] [text-wrap:pretty] md:basis-auto md:truncate"
        style={{ color: blocks > 0 ? LAYER.brand : reason ? LAYER.firm : "#a1a1aa" }}
        title={reason ?? undefined}
      >
        {reason ?? ""}
      </span>

      <button
        type="button"
        disabled={!canRun}
        onClick={dirty ? onSaveVersionAndRun : onRun}
        className={cn(
          "h-[30px] min-h-11 rounded-sm border text-[13px] font-medium md:min-h-0",
          dirty ? "px-[14px]" : "px-5",
          canRun
            ? "border-foreground bg-foreground text-background"
            : "cursor-not-allowed border-[--hair-rule] bg-[#f4f4f5] text-[#a1a1aa]",
        )}
      >
        {dirty ? "Save version & run" : warns > 0 && acknowledged ? "Acknowledge & run" : "Run"}
      </button>
    </div>
  );
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
  onAcknowledge: () => void;
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

      {warns > 0 ? (
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
