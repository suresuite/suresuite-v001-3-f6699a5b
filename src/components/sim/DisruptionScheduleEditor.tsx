import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { disruptionWeeks } from "@/lib/sim/runWindow";
import { AUTO_WARMUP_RULE, warmupNote } from "@/lib/sim/disruptionTiming";
import { isWholeWeeks } from "@/lib/sim/planningTime";
import {
  DISRUPTION_RULE,
  DISRUPTION_TERMS,
  addBlockedReason,
  describeEvent,
  isFullOutage,
  judgeTarget,
  newEvent,
  targetChoices,
  type ScheduleEvent,
} from "@/lib/sim/disruptionEvents";
import type { Scenario } from "@/hooks/useScenarios";
import { WeeksInput } from "./WeeksInput";

interface Props {
  value: Scenario["disruption_schedule"];
  onChange: (next: Scenario["disruption_schedule"]) => void;
  projectId?: string | null;
  /** The scenario's warm-up, so a new disruption starts where KPIs are measured
   *  and a row inside the warm-up says what the engine will do (audit F-03). */
  warmup?: { days: number; mode: string; horizonDays: number };
  /** The project's supplier ids — the targets the engine can disrupt besides the plant. */
  supplierIds?: string[];
  /** Suppliers with no finite weekly capacity: a partial cut on one runs as an outage. */
  uncapacitated?: string[];
}

/**
 * The Lab's disruption schedule, authored as the engine runs it (WP 9.4 slice 6).
 *
 * A target is PICKED from what the engine can disrupt — the plant or one of the
 * project's suppliers (`_map_events`' own test) — rather than typed as free text
 * the mapper would then skip. Start and duration are whole weeks. The effect is
 * a full outage or a capacity reduction BY a share, which is what `magnitude_pct`
 * means to the engine; every label is `DISRUPTION_TERMS`. "Add" stops at the engine's event cap and says why. The network pages'
 * dialog builds its event with the same module, so both doors write one shape.
 */
export function DisruptionScheduleEditor({
  value,
  onChange,
  warmup,
  supplierIds = [],
  uncapacitated = [],
}: Props) {
  const [local, setLocal] = useState<ScheduleEvent[]>(value);
  useEffect(() => setLocal(value), [value]);

  const commit = (next: ScheduleEvent[]) => {
    setLocal(next);
    onChange(next);
  };
  const patchNow = (i: number, fields: Partial<ScheduleEvent>) => {
    const next = [...local];
    next[i] = { ...next[i], target_type: "node", ...fields };
    commit(next);
  };

  const blocked = addBlockedReason(local);
  const choices = targetChoices(supplierIds);
  const add = () => {
    if (blocked) return;
    commit([...local, newEvent(choices[0]?.value ?? "", warmup?.days)]);
  };

  return (
    <div className="flex flex-col gap-2">
      {local.length === 0 && (
        <p className="text-xs text-muted-foreground">
          No disruption events — this scenario runs undisrupted.
        </p>
      )}
      {local.length > 0 && warmup && String(warmup.mode).toLowerCase() !== "manual" && (
        <p className="text-[10px] text-muted-foreground">{AUTO_WARMUP_RULE}</p>
      )}
      {local.map((d, i) => {
        const { target, reason } = judgeTarget(d.target, supplierIds);
        const outageOnly =
          !isFullOutage(d.magnitude_pct) && target.kind === "supplier" && uncapacitated.includes(target.id);
        return (
          <div key={i} className="rounded-sm border border-border">
            <div className="flex items-center gap-2 border-b border-border px-2 py-1">
              <span className="shrink-0 text-[11px] font-medium text-muted-foreground">
                Event {i + 1}
              </span>
              <span className="min-w-0 flex-1 truncate text-[12px] text-foreground" title={describeEvent(d)}>
                {describeEvent(d)}
              </span>
              <Button
                size="icon"
                variant="ghost"
                aria-label={`Remove event ${i + 1}`}
                title="Remove this event"
                className="h-7 w-7 min-h-11 min-w-11 shrink-0 text-destructive md:min-h-0 md:min-w-0"
                onClick={() => commit(local.filter((_, j) => j !== i))}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
            <div className="grid grid-cols-2 items-start gap-2 p-2 md:grid-cols-12">
              <div className="col-span-2 flex flex-col gap-1 md:col-span-3">
                <Label className="text-[10px]">{DISRUPTION_TERMS.target}</Label>
                <TargetSelect
                  className="h-11 md:h-8"
                  value={d.target}
                  choices={choices}
                  onChange={(v) => patchNow(i, { target: v })}
                />
              </div>
              <div className="col-span-2 flex flex-col gap-1 md:col-span-5">
                <Label className="text-[10px]">{DISRUPTION_TERMS.effect}</Label>
                <EffectControl value={d.magnitude_pct} onChange={(v) => patchNow(i, { magnitude_pct: v })} />
              </div>
              <div className="col-span-1 flex flex-col gap-1 md:col-span-2">
                <Label className="text-[10px]">{DISRUPTION_TERMS.onset}</Label>
                <WeeksInput
                  ariaLabel="Onset week"
                  className="h-8 min-h-11 w-full md:min-h-0"
                  days={d.start_day}
                  min={DISRUPTION_RULE.start_week_min}
                  onDays={(v) => patchNow(i, { start_day: v })}
                />
              </div>
              <div className="col-span-1 flex flex-col gap-1 md:col-span-2">
                <Label className="text-[10px]">{DISRUPTION_TERMS.duration} (weeks)</Label>
                <WeeksInput
                  ariaLabel="Duration in weeks"
                  className="h-8 min-h-11 w-full md:min-h-0"
                  days={d.duration_days}
                  min={DISRUPTION_RULE.duration_weeks_min}
                  max={DISRUPTION_RULE.duration_weeks_max}
                  onDays={(v) => patchNow(i, { duration_days: v })}
                />
              </div>
              {/* The header already states the engine's weeks; the line returns
                  only when it has a caveat to add (days collapsing, warm-up). */}
              {!isWholeWeeks(d.start_day) || !isWholeWeeks(d.duration_days) ||
              warmupNote(disruptionWeeks(d.start_day, d.duration_days).startWeek, warmup) ? (
                <EngineTicks startDay={d.start_day} durationDays={d.duration_days} warmup={warmup} />
              ) : null}
              {reason ? (
                <p className="col-span-2 text-[10px] text-[#b3261e] md:col-span-12">{reason}</p>
              ) : outageOnly ? (
                <p className="col-span-2 text-[10px] text-[--warn-ink,#92400e] md:col-span-12">
                  This supplier has no weekly capacity, so the engine runs a capacity reduction as a full outage.
                </p>
              ) : null}
            </div>
          </div>
        );
      })}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          className="gap-1"
          onClick={add}
          disabled={!!blocked}
          title={blocked ?? undefined}
        >
          <Plus className="h-3.5 w-3.5" /> Add disruption event
        </Button>
        <span className="text-[10px] tabular-nums text-muted-foreground">
          {local.length} of {DISRUPTION_RULE.event_cap} events
        </span>
      </div>
      {blocked ? <p className="text-[10px] text-muted-foreground">{blocked}</p> : null}
    </div>
  );
}

/** A two-or-more-way switch, styled as one control (effect, destination). */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: T;
  options: { value: T; label: string; disabled?: boolean }[];
  onChange: (v: T) => void;
  ariaLabel: string;
}) {
  return (
    <span role="radiogroup" aria-label={ariaLabel} className="inline-flex rounded-sm border border-input p-[2px]">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          disabled={o.disabled}
          onClick={() => onChange(o.value)}
          className={cn(
            "min-h-11 whitespace-nowrap rounded-[2px] px-2 text-[12px] md:min-h-0 md:py-[3px]",
            o.value === value ? "bg-foreground text-background" : "text-[#52525b] hover:text-foreground",
            o.disabled && "cursor-not-allowed opacity-50 hover:text-[#52525b]",
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
  value,
  choices,
  onChange,
  placeholder,
  className,
}: {
  value: string;
  choices: ReturnType<typeof targetChoices>;
  onChange: (v: string) => void;
  /** shown as an empty first option, for a form that starts with no target */
  placeholder?: string;
  className?: string;
}) {
  const known = !value || choices.some((c) => c.value === value);
  const suppliers = choices.filter((c) => c.group === "Suppliers");
  return (
    <select
      aria-label={DISRUPTION_TERMS.target}
      className={cn(
        "h-9 min-h-11 w-full rounded-sm border border-input bg-background px-2 text-sm md:min-h-0",
        className,
      )}
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

/** Full outage, or a capacity reduction BY a share — the engine's reading of `magnitude_pct`. */
export function EffectControl({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const full = DISRUPTION_RULE.full_outage_pct;
  const partial = !isFullOutage(value);
  const [text, setText] = useState(String(partial ? value : 50));
  useEffect(() => {
    if (value < full) setText(String(value));
  }, [value, full]);
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <Segmented
        ariaLabel={DISRUPTION_TERMS.effect}
        value={partial ? "partial" : "outage"}
        options={[
          { value: "outage", label: DISRUPTION_TERMS.fullOutage },
          { value: "partial", label: DISRUPTION_TERMS.capacityReduction },
        ]}
        onChange={(v) =>
          onChange(v === "outage" ? full : Math.min(full - 1, Math.max(1, Number(text) || 50)))
        }
      />
      {partial ? (
        <span className="inline-flex items-center gap-1">
          <Input
            aria-label="Capacity lost, percent"
            className="h-8 min-h-11 w-16 md:min-h-0"
            type="number"
            min={1}
            max={full - 1}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onBlur={() => {
              const v = Math.round(Number(text));
              if (!Number.isFinite(v) || v < 1 || v >= full) return setText(String(value));
              if (v !== value) onChange(v);
            }}
          />
          <span className="whitespace-nowrap text-[12px] text-muted-foreground">% capacity lost</span>
        </span>
      ) : null}
    </span>
  );
}

/** What the engine will run for this row (audit F-22). Days are stored; the
 *  engine advances in weekly ticks, so a 3-day and a 10-day disruption are the
 *  same one-week event. The translation comes from the engine's exported rule. */
export function EngineTicks({ startDay, durationDays, warmup }: {
  startDay: number; durationDays: number; warmup?: { days: number; mode: string; horizonDays: number };
}) {
  const { startWeek, durationWeeks } = disruptionWeeks(startDay, durationDays);
  const collapsed = startDay % 7 !== 0 || durationDays !== durationWeeks * 7;
  const note = warmupNote(startWeek, warmup);
  return (
    <p className="col-span-2 text-[10px] text-muted-foreground md:col-span-12">
      Simulated from week {startWeek} for {durationWeeks} wk
      {collapsed ? " — stored in days; the engine advances in weekly ticks" : ""}
      {note ? <span className="block text-[--warn-ink,#92400e]">{note}</span> : null}
    </p>
  );
}
