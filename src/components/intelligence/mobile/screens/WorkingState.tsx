/**
 * SC Intelligences — thread working state (screen 05, mobile handoff D2,
 * skeleton-first pass).
 *
 * D2: the previous version advanced a step every `STEP_MS` and then simply
 * stopped moving once it reached the last step — on a 20-80s turn with two
 * or three read domains that meant the indicator sat still for most of the
 * wait. This version is built around a live clock instead of a step
 * animation: an "elapsed Ns" counter in the panel head that ticks every
 * second for as long as the turn is in flight, a running clock on whichever
 * step is current, and settled seconds on every step that finished. The
 * counter is what "never stops moving" actually means — the dot's CSS pulse
 * alone was not a strong enough signal on its own.
 *
 * The steps themselves are still synthesised from the intelligence's declared
 * read domains (`reads`) rather than a live per-tool-call trace:
 * `useProjectChat.send` has no streaming and no AbortSignal (supabase-js's
 * `functions.invoke` doesn't accept one), so there is no real per-step
 * telemetry to show while a turn is in flight — only once it completes do the
 * actual tool calls arrive, in `ChatToolCall[]`. This is an honest
 * approximation of progress against the intelligence's own remit, not a
 * fabricated trace.
 *
 * First-open fix: most turns land fast enough that the bordered panel below
 * never needs to appear at all. `WorkingState` now renders three breathing
 * skeleton rows the instant a turn starts and only swaps in the ticking
 * panel — `WorkingPanel`, a separate component so its 1s ticker doesn't
 * start running until it actually mounts — once the turn has been running
 * for `PANEL_DELAY_MS`.
 */
import * as React from "react";
import { cn } from "@/lib/utils";
import { getIntel } from "../intel";

/** Heuristic pace between read domains. A turn that runs long just leaves the
 * last step's own clock running rather than ever "finishing" early — there is
 * nothing to advance to once every declared domain has had its turn. */
const STEP_MS = 6000;

/** A turn this fast never shows the full bordered panel — the skeleton rows
 * alone are enough of an answer. */
const PANEL_DELAY_MS = 600;

/** Re-renders once a second so the elapsed counter and the in-flight step's
 * clock both keep moving without the rest of the tree re-rendering. */
function useTicker(intervalMs: number) {
  const [, force] = React.useReducer((c: number) => c + 1, 0);
  React.useEffect(() => {
    const id = setInterval(force, intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
}

/** Holds the answer's place from the moment a turn starts. */
function AnswerSkeleton() {
  return (
    <div className="flex flex-col gap-1.5" aria-hidden>
      <div className="pi-skeleton-pulse h-[9px] w-full rounded-[2px] bg-[#f0f0f0]" />
      <div className="pi-skeleton-pulse h-[9px] w-[92%] rounded-[2px] bg-[#f0f0f0]" />
      <div className="pi-skeleton-pulse h-[9px] w-[64%] rounded-[2px] bg-[#f0f0f0]" />
    </div>
  );
}

function WorkingPanel({
  intelId,
  turnStartedAt,
  onStop,
}: {
  intelId: string;
  turnStartedAt: number;
  onStop: () => void;
}) {
  const intel = getIntel(intelId);
  const steps = React.useMemo(() => intel.reads.split(" · "), [intel.reads]);
  useTicker(1000);

  const elapsedMs = Math.max(0, Date.now() - turnStartedAt);
  const elapsedS = Math.floor(elapsedMs / 1000);
  const activeStep = Math.min(steps.length - 1, Math.floor(elapsedMs / STEP_MS));
  const activeStepStartMs = activeStep * STEP_MS;

  return (
    <div className="mt-2 flex flex-col gap-3">
      <div className="overflow-hidden rounded-[4px] border border-[#18181b]">
        <div className="flex items-center justify-between bg-[#18181b] px-3 py-2">
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-white">working</span>
          <span className="font-mono text-[10px] tabular-nums text-white/70">elapsed {elapsedS}s</span>
        </div>
        {steps.map((label, i) => {
          const done = i < activeStep;
          const current = i === activeStep;
          const seconds = done
            ? Math.round(STEP_MS / 1000)
            : current
              ? Math.floor((elapsedMs - activeStepStartMs) / 1000)
              : null;
          return (
            <div
              key={label}
              className="flex items-center gap-2 border-b border-[#e8e8ea] px-3 py-[5px] last:border-b-0"
            >
              {done ? (
                <span className="font-mono text-[11px] font-semibold text-[#047857]">✓</span>
              ) : (
                <span
                  aria-hidden
                  className={cn(
                    "h-1.5 w-1.5 shrink-0 rounded-full bg-[#14b8c4]",
                    current ? "motion-safe:animate-pulse" : "opacity-30",
                  )}
                />
              )}
              <span className="flex-1 font-mono text-[11px] text-[#171717]">{label} read</span>
              <span className="font-mono text-[10px] tabular-nums text-[#9a9a9a]">
                {seconds != null ? `${seconds}s` : "—"}
              </span>
            </div>
          );
        })}
      </div>

      <p className="text-[12px] leading-[1.35] text-[#525252] [text-wrap:pretty]">
        A turn on this project takes 20–80 s — this one is still reading.
      </p>

      <div className="flex flex-col gap-1.5" aria-hidden>
        <div className="h-[9px] w-full rounded-[2px] bg-[#f0f0f0]" />
        <div className="h-[9px] w-[92%] rounded-[2px] bg-[#f0f0f0]" />
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

export function WorkingState({
  intelId,
  turnStartedAt,
  onStop,
}: {
  intelId: string;
  /** `Date.now()` at the moment this turn's `send()` was issued — the turn's
   * own clock, not a per-render timestamp, so the elapsed count survives
   * re-renders and is the same number the closing line's expectation is
   * measured against. */
  turnStartedAt: number;
  onStop: () => void;
}) {
  const [panelReady, setPanelReady] = React.useState(() => Date.now() - turnStartedAt >= PANEL_DELAY_MS);

  React.useEffect(() => {
    const remaining = PANEL_DELAY_MS - (Date.now() - turnStartedAt);
    if (remaining <= 0) {
      setPanelReady(true);
      return;
    }
    setPanelReady(false);
    const id = setTimeout(() => setPanelReady(true), remaining);
    return () => clearTimeout(id);
  }, [turnStartedAt]);

  if (!panelReady) return <AnswerSkeleton />;

  return <WorkingPanel intelId={intelId} turnStartedAt={turnStartedAt} onStop={onStop} />;
}
