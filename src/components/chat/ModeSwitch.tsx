import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * Interaction-mode control — Ask / Review / Auto (ai-agents.md §15, §10 Q23).
 * Rendered beside the model picker; two live positions, per thread. "Auto" is
 * rendered DISABLED with its unlock conditions in the tooltip (§10 Q6's
 * revisit trigger verbatim) — it does not exist behaviorally, and the
 * chat_threads.mode CHECK deliberately excludes it.
 *
 * Client visibility flag mirrors the server flag CHAT_MODES_ENABLED (§9
 * conventions; both default off ⇒ the switch never renders and every thread
 * behaves as 'review'). The server enforces the mode regardless of what this
 * control shows — it is never a client-side cosmetic.
 */

export type ThreadMode = "ask" | "review";

export const DEFAULT_THREAD_MODE: ThreadMode = "review";

export function chatModesUiEnabled(): boolean {
  return import.meta.env.VITE_CHAT_MODES_ENABLED === "true";
}

/** §10 Q6 revisit trigger, verbatim — the only path to a live Auto. */
const AUTO_TOOLTIP =
  "Auto isn't available. It unlocks only after: ≥ 3 consecutive months of per-agent " +
  "accepted-proposal rate ≥ 0.9 AND an org explicitly requesting it AND resolved principals " +
  "(server-verified identity) — and then as a per-org opt-in designed as a new decision, " +
  "scoped first to deterministic diffs. Until then every change is a reviewable proposal.";

const POSITIONS: Array<{ id: ThreadMode; label: string; hint: string }> = [
  { id: "ask", label: "Ask", hint: "Decision Support — answers and analyses only; nothing about the project changes" },
  { id: "review", label: "Review", hint: "Accept edits — agents draft; every change is a proposal card you approve" },
];

interface Props {
  value: ThreadMode;
  onChange: (mode: ThreadMode) => void;
  disabled?: boolean;
  className?: string;
}

export function ModeSwitch({ value, onChange, disabled, className }: Props) {
  return (
    <TooltipProvider delayDuration={200}>
      <div
        role="radiogroup"
        aria-label="Assistant mode"
        className={cn(
          "flex h-8 items-center gap-0.5 rounded-md border border-border bg-transparent p-0.5",
          className,
        )}
      >
        {POSITIONS.map((p) => (
          <Tooltip key={p.id}>
            <TooltipTrigger asChild>
              <button
                type="button"
                role="radio"
                aria-checked={value === p.id}
                disabled={disabled}
                onClick={() => value !== p.id && onChange(p.id)}
                className={cn(
                  "rounded px-2 py-0.5 text-[12px] font-medium transition-colors",
                  value === p.id
                    ? "bg-foreground text-background"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                {p.label}
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-[260px] text-[12px]">
              {p.hint}
            </TooltipContent>
          </Tooltip>
        ))}
        <Tooltip>
          <TooltipTrigger asChild>
            {/* span wrapper: disabled buttons swallow pointer events, and the
                unlock conditions must stay readable (§15). */}
            <span tabIndex={0} className="cursor-not-allowed">
              <button
                type="button"
                role="radio"
                aria-checked={false}
                disabled
                aria-label="Auto (locked)"
                className="pointer-events-none rounded px-2 py-0.5 text-[12px] font-medium text-muted-foreground/40"
              >
                Auto
              </button>
            </span>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-[300px] text-[12px]">
            {AUTO_TOOLTIP}
          </TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>
  );
}
