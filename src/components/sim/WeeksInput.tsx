import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { editWeeks, engineWeeks } from "@/lib/sim/planningTime";

/**
 * A duration typed in the planning unit and stored in days (WP 9.4 slice 1).
 *
 * It commits on blur (or Enter), against the value it was GIVEN, never against
 * an intermediate keystroke: typing "5" then "52" over a stored 365 must land on
 * 365 again rather than on 364, because a horizon is hashed into the model
 * card's fingerprint and a silent one-day move turns a validated scenario stale.
 */
export function WeeksInput({
  days,
  onDays,
  min = 0,
  max,
  className,
  ariaLabel,
  disabled,
}: {
  days: number;
  onDays: (days: number) => void;
  min?: number;
  max?: number;
  className?: string;
  ariaLabel?: string;
  disabled?: boolean;
}) {
  const [text, setText] = useState(String(engineWeeks(days)));
  useEffect(() => setText(String(engineWeeks(days))), [days]);

  const commit = () => {
    const v = parseFloat(text);
    if (text === "" || !Number.isFinite(v)) {
      setText(String(engineWeeks(days)));
      return;
    }
    const bounded = Math.min(max ?? Infinity, Math.max(min, Math.round(v)));
    const next = editWeeks(days, bounded);
    setText(String(engineWeeks(next)));
    if (next !== days) onDays(next);
  };

  return (
    <input
      type="number"
      inputMode="numeric"
      aria-label={ariaLabel}
      disabled={disabled}
      min={min}
      max={max}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
      className={cn(
        "h-7 min-h-11 w-[76px] rounded-sm border border-[#d4d4d8] px-[9px] text-[13px] tabular-nums text-[#18181b] focus:border-foreground focus:outline-none disabled:bg-[#f4f4f5] disabled:text-[#71717a] md:min-h-0",
        className,
      )}
    />
  );
}
