import { useEffect, useState, type ReactNode } from "react";
import { Minus, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { editWeeks, engineWeeks } from "@/lib/sim/planningTime";
import { disruptionWeeks } from "@/lib/sim/runWindow";
import {
  DISRUPTION_RULE,
  DISRUPTION_TERMS,
  isLeadTimeDelay,
  targetChoices,
} from "@/lib/sim/disruptionEvents";

/**
 * The fields every disruption-event surface is built from: the network pages'
 * dialog and the Lab's schedule editor (WP 9.4). One height for every control
 * — 44px on a phone, 36px from `md` — so a select, a switch and a number never
 * sit at three different heights in one row.
 */
export const FIELD_H = "h-11 md:h-9";

export const FIELD_BOX =
  "rounded-sm border border-input bg-background text-[13px] text-foreground focus-within:border-foreground";

/** The range a start time may take, said under the field. */
export function startHint(horizonWeeks?: number): string {
  const min = DISRUPTION_RULE.start_week_min;
  return horizonWeeks ? `Week ${min}–${horizonWeeks} of the run` : `From week ${min} of the run`;
}

/** Spread a hint into `Field`'s props. */
export const hintOf = (h: { text: string; tone: "muted" | "warn" }) => ({ hint: h.text, tone: h.tone });

/** The duration's hint: its allowed range, or — when the event would run past
 *  the end of the run — where it ends, as a warning. */
export function durationHint(
  startDay: number,
  durationDays: number,
  horizonWeeks?: number,
): { text: string; tone: "muted" | "warn" } {
  const { startWeek, durationWeeks } = disruptionWeeks(startDay, durationDays);
  const last = startWeek + durationWeeks - 1;
  if (horizonWeeks && last > horizonWeeks) {
    return { text: `Ends in week ${last}, after the run ends in week ${horizonWeeks}.`, tone: "warn" };
  }
  return { text: `${DISRUPTION_RULE.duration_weeks_min}–${DISRUPTION_RULE.duration_weeks_max} weeks`, tone: "muted" };
}

/** A label above its control, with an optional hint under it. */
export function Field({
  label,
  hint,
  tone = "muted",
  htmlFor,
  className,
  children,
}: {
  label: string;
  hint?: ReactNode;
  tone?: "muted" | "warn" | "error";
  htmlFor?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <label htmlFor={htmlFor} className="text-[12px] font-medium leading-4 text-[#3f3f46]">
        {label}
      </label>
      {children}
      {hint ? (
        <p
          className={cn(
            "text-[11.5px] leading-4",
            tone === "muted" && "text-[#71717a]",
            tone === "warn" && "text-[#9a6206]",
            tone === "error" && "text-[#b3261e]",
          )}
        >
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/** A pill in a row of choices (start-from, KPI) — the same height as a field. */
export function choiceChip(on: boolean, disabled?: boolean): string {
  return cn(
    "rounded-sm border px-3 text-[12.5px] transition-colors",
    FIELD_H,
    on ? "border-foreground bg-foreground text-background" : "border-input bg-background text-[#3f3f46] hover:border-foreground",
    disabled && "cursor-not-allowed opacity-50 hover:border-input",
  );
}

/** A two-way switch, styled as one control (effect, destination). */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  className,
}: {
  value: T;
  options: { value: T; label: string; disabled?: boolean }[];
  onChange: (v: T) => void;
  ariaLabel: string;
  className?: string;
}) {
  return (
    <span
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn("inline-flex items-stretch gap-[2px] p-[2px]", FIELD_H, FIELD_BOX, className)}
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          disabled={o.disabled}
          onClick={() => onChange(o.value)}
          className={cn(
            "flex-1 whitespace-nowrap rounded-[2px] px-3 text-[12.5px] transition-colors",
            o.value === value ? "bg-foreground text-background" : "text-[#52525b] hover:bg-[#f4f4f5] hover:text-foreground",
            o.disabled && "cursor-not-allowed opacity-50 hover:bg-transparent hover:text-[#52525b]",
          )}
        >
          {o.label}
        </button>
      ))}
    </span>
  );
}

/** The nodes the engine can disrupt, grouped plant first, then suppliers. A
 *  stored target outside that list is kept visible rather than silently swapped. */
export function TargetSelect({
  id,
  value,
  choices,
  onChange,
  placeholder,
}: {
  id?: string;
  value: string;
  choices: ReturnType<typeof targetChoices>;
  onChange: (v: string) => void;
  /** shown as an empty first option, for a form that starts with no target */
  placeholder?: string;
}) {
  const known = !value || choices.some((c) => c.value === value);
  const suppliers = choices.filter((c) => c.group === "Suppliers");
  return (
    <select
      id={id}
      aria-label={DISRUPTION_TERMS.target}
      className={cn("w-full px-2.5 outline-none", FIELD_H, FIELD_BOX, !value && "text-[#71717a]")}
      value={known ? value : "__other"}
      onChange={(e) => {
        if (e.target.value !== "__other") onChange(e.target.value);
      }}
    >
      {placeholder ? <option value="">{placeholder}</option> : null}
      {choices
        .filter((c) => c.group === "Plant")
        .map((c) => (
          <option key={c.value} value={c.value}>
            {c.label}
          </option>
        ))}
      {suppliers.length > 0 ? (
        <optgroup label={`Suppliers (${suppliers.length})`}>
          {suppliers.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </optgroup>
      ) : null}
      {!known ? <option value="__other">{value} (cannot be disrupted)</option> : null}
    </select>
  );
}

/**
 * A whole number with − / + steppers and its unit inside the box.
 *
 * Typing commits on blur or Enter, against the value it was GIVEN (as
 * `WeeksInput` does); the steppers and the arrow keys commit at once. A value
 * outside the bounds is pulled back to the nearest one, and the steppers stop
 * at the bounds rather than letting a click do nothing.
 */
export function NumberStepper({
  id,
  value,
  onCommit,
  min,
  max,
  step = 1,
  unit,
  prefix,
  ariaLabel,
  disabled,
}: {
  id?: string;
  value: number;
  onCommit: (v: number) => void;
  min: number;
  max?: number;
  step?: number;
  /** after the number: "weeks", "%" */
  unit?: string;
  /** before the number, for a point rather than an amount: "Week" 19 */
  prefix?: string;
  ariaLabel: string;
  disabled?: boolean;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const clamp = (v: number) => Math.min(max ?? Infinity, Math.max(min, Math.round(v)));
  const commit = (v: number) => {
    const next = clamp(v);
    setText(String(next));
    if (next !== value) onCommit(next);
  };
  const commitText = () => {
    const v = parseFloat(text);
    if (text.trim() === "" || !Number.isFinite(v)) return setText(String(value));
    commit(v);
  };
  const stepBy = (dir: 1 | -1) => {
    const base = Number.isFinite(parseFloat(text)) ? parseFloat(text) : value;
    commit(base + dir * step);
  };
  const atMin = disabled || value <= min;
  const atMax = disabled || (max != null && value >= max);
  const btn =
    "flex w-11 shrink-0 items-center justify-center text-[#52525b] hover:bg-[#f4f4f5] hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent md:w-8";

  return (
    <div
      className={cn(
        "flex w-full items-stretch overflow-hidden transition-colors hover:border-[#a1a1aa]",
        FIELD_H,
        FIELD_BOX,
        disabled && "bg-[#f4f4f5] text-[#71717a] hover:border-input",
      )}
    >
      <button type="button" tabIndex={-1} aria-label={`Decrease ${ariaLabel}`} disabled={atMin} onClick={() => stepBy(-1)} className={cn(btn, "border-r border-input")}>
        <Minus className="h-3.5 w-3.5" />
      </button>
      {prefix ? (
        <span className="flex select-none items-center whitespace-nowrap pl-2.5 pr-1 text-[12px] text-[#71717a]">{prefix}</span>
      ) : null}
      <input
        id={id}
        type="number"
        inputMode="numeric"
        aria-label={ariaLabel}
        disabled={disabled}
        min={min}
        max={max}
        step={step}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onFocus={(e) => e.target.select()}
        onBlur={commitText}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault();
            stepBy(e.key === "ArrowUp" ? 1 : -1);
          }
        }}
        className={cn(
          "w-full min-w-0 bg-transparent tabular-nums outline-none focus-visible:outline-none focus-visible:ring-0 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none",
          prefix ? "pr-2 text-left" : "pl-2 text-right",
        )}
      />
      {unit ? (
        <span className="flex select-none items-center whitespace-nowrap pl-1 pr-2.5 text-[12px] text-[#71717a]">{unit}</span>
      ) : null}
      <button type="button" tabIndex={-1} aria-label={`Increase ${ariaLabel}`} disabled={atMax} onClick={() => stepBy(1)} className={cn(btn, "border-l border-input")}>
        <Plus className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

/** A week stored in days: the stepper speaks weeks, the row keeps days, and an
 *  unchanged week never rewrites the stored day (`editWeeks`). A `point` is a
 *  moment ("Week 19"); an `amount` is a length ("4 weeks"). */
export function WeeksStepper({
  id,
  days,
  onDays,
  min,
  max,
  ariaLabel,
  disabled,
  kind = "amount",
}: {
  id?: string;
  days: number;
  onDays: (days: number) => void;
  min: number;
  max?: number;
  ariaLabel: string;
  disabled?: boolean;
  kind?: "point" | "amount";
}) {
  const weeks = engineWeeks(days);
  return (
    <NumberStepper
      id={id}
      disabled={disabled}
      value={weeks}
      min={min}
      max={max}
      prefix={kind === "point" ? "Week" : undefined}
      unit={kind === "point" ? undefined : weeks === 1 ? "week" : "weeks"}
      ariaLabel={ariaLabel}
      onCommit={(w) => {
        const next = editWeeks(days, w);
        if (next !== days) onDays(next);
      }}
    />
  );
}

/** Lead-time delay, or a capacity reduction BY a share — the engine's reading of
 *  `magnitude_pct`. The share keeps its last value when the user switches back. */
export function EffectControl({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const full = DISRUPTION_RULE.full_outage_pct;
  const partial = !isLeadTimeDelay(value);
  const [lastShare, setLastShare] = useState(partial ? value : 50);
  useEffect(() => {
    if (value < full) setLastShare(value);
  }, [value, full]);
  return (
    <Segmented
      className="w-full"
      ariaLabel={DISRUPTION_TERMS.effect}
      value={partial ? "partial" : "delay"}
      options={[
        { value: "delay", label: DISRUPTION_TERMS.leadTimeDelay },
        { value: "partial", label: DISRUPTION_TERMS.capacityReduction },
      ]}
      onChange={(v) => onChange(v === "delay" ? full : lastShare)}
    />
  );
}

/** The share a capacity reduction removes, 1–99%, in steps of 5. */
export function CapacityLostStepper({ id, value, onChange }: { id?: string; value: number; onChange: (v: number) => void }) {
  return (
    <NumberStepper
      id={id}
      value={value}
      min={1}
      max={DISRUPTION_RULE.full_outage_pct - 1}
      step={5}
      unit="%"
      ariaLabel="Capacity lost, percent"
      onCommit={onChange}
    />
  );
}
