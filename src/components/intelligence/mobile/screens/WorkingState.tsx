/**
 * SC Intelligences — thread working state (screen 05, handoff §7).
 *
 * No spinner, no typing dots, no streaming cursor. A step log in a bordered
 * panel, a height-matched skeleton, and a reachable Stop chip.
 *
 * The steps themselves are synthesised from the intelligence's declared read
 * domains (`reads`, e.g. "firm graph · disruption schedules") rather than a
 * live per-tool-call trace: `useProjectChat.send` has no streaming and no
 * AbortSignal (supabase-js's `functions.invoke` doesn't accept one), so there
 * is no real per-step telemetry to show while a turn is in flight — only once
 * it completes do the actual tool calls arrive, in `ChatToolCall[]`. This is
 * an honest approximation of progress against the intelligence's own remit,
 * not a fabricated trace.
 */
import * as React from "react";
import { getIntel } from "../intel";

const STEP_MS = 1400;

export function WorkingState({ intelId, onStop }: { intelId: string; onStop: () => void }) {
  const intel = getIntel(intelId);
  const steps = React.useMemo(() => intel.reads.split(" · "), [intel.reads]);
  const [activeStep, setActiveStep] = React.useState(0);

  React.useEffect(() => {
    setActiveStep(0);
    if (steps.length <= 1) return;
    const id = setInterval(() => {
      setActiveStep((s) => Math.min(s + 1, steps.length - 1));
    }, STEP_MS);
    return () => clearInterval(id);
  }, [steps.length]);

  return (
    <div className="mt-2 flex flex-col gap-3">
      <div className="overflow-hidden rounded-[4px] border border-[#d4d4d4]">
        {steps.map((label, i) => {
          const done = i < activeStep;
          const current = i === activeStep;
          return (
            <div
              key={label}
              className="flex items-center gap-2 border-b border-[#e8e8ea] px-3 py-2 last:border-b-0"
            >
              {done ? (
                <span className="font-mono text-[11px] font-semibold text-[#047857]">✓</span>
              ) : (
                <span
                  aria-hidden
                  className={
                    "h-1.5 w-1.5 shrink-0 rounded-full bg-[#14b8c4] " +
                    (current ? "motion-safe:animate-pulse" : "opacity-30")
                  }
                />
              )}
              <span className="flex-1 font-mono text-[11px] text-[#171717]">{label} read</span>
              <span className="font-mono text-[10px] text-[#9a9a9a]">{done ? "" : current ? "…" : ""}</span>
            </div>
          );
        })}
      </div>

      <div className="flex flex-col gap-1.5" aria-hidden>
        <div className="h-[9px] w-full rounded-[2px] bg-[#f0f0f0]" />
        <div className="h-[9px] w-[92%] rounded-[2px] bg-[#f0f0f0]" />
        <div className="h-[9px] w-[64%] rounded-[2px] bg-[#f0f0f0]" />
      </div>

      <button
        type="button"
        onClick={onStop}
        className="h-[26px] w-fit rounded-[4px] border border-[#d4d4d4] bg-white px-2.5 font-mono text-[10.5px] font-semibold uppercase tracking-[0.1em] text-[#525252]"
      >
        Stop
      </button>
    </div>
  );
}
