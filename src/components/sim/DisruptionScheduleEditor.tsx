import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { disruptionWeeks } from "@/lib/sim/runWindow";
import { AUTO_WARMUP_RULE, warmupNote } from "@/lib/sim/disruptionTiming";
import {
  DISRUPTION_RULE,
  addBlockedReason,
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
 * a full outage or a cut BY a share, which is what `magnitude_pct` means to the
 * engine. "Add" stops at the engine's event cap and says why. The network pages'
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
      {local.length === 0 && <p className="text-xs text-muted-foreground">No disruptions scheduled.</p>}
      {local.length > 0 && warmup && String(warmup.mode).toLowerCase() !== "manual" && (
        <p className="text-[10px] text-muted-foreground">{AUTO_WARMUP_RULE}</p>
      )}
      {local.map((d, i) => {
        const { target, reason } = judgeTarget(d.target, supplierIds);
        const known = choices.some((c) => c.value === d.target);
        const partial = d.magnitude_pct < DISRUPTION_RULE.full_outage_pct;
        const outageOnly =
          partial && target.kind === "supplier" && uncapacitated.includes(target.id);
        return (
          <div key={i} className="grid grid-cols-2 items-end gap-2 rounded-sm border border-border p-2 md:grid-cols-12">
            <div className="col-span-2 flex flex-col gap-1 md:col-span-4">
              <Label className="text-[10px]">Target</Label>
              <select
                aria-label="Disruption target"
                className="h-8 min-h-11 rounded-sm border border-input bg-background px-2 text-sm md:min-h-0"
                value={known ? d.target : "__other"}
                onChange={(e) => {
                  if (e.target.value !== "__other") patchNow(i, { target: e.target.value });
                }}
              >
                {choices.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
                {!known ? <option value="__other">{d.target || "(no target)"}</option> : null}
              </select>
            </div>
            <div className="col-span-1 flex flex-col gap-1 md:col-span-2">
              <Label className="text-[10px]">Start (week)</Label>
              <WeeksInput
                ariaLabel="Start week"
                className="h-8 min-h-11 w-full md:min-h-0"
                days={d.start_day}
                min={DISRUPTION_RULE.start_week_min}
                onDays={(v) => patchNow(i, { start_day: v })}
              />
            </div>
            <div className="col-span-1 flex flex-col gap-1 md:col-span-2">
              <Label className="text-[10px]">Duration (weeks)</Label>
              <WeeksInput
                ariaLabel="Duration in weeks"
                className="h-8 min-h-11 w-full md:min-h-0"
                days={d.duration_days}
                min={DISRUPTION_RULE.duration_weeks_min}
                max={DISRUPTION_RULE.duration_weeks_max}
                onDays={(v) => patchNow(i, { duration_days: v })}
              />
            </div>
            <div className="col-span-2 flex flex-col gap-1 md:col-span-3">
              <Label className="text-[10px]">Effect</Label>
              <EffectControl value={d.magnitude_pct} onChange={(v) => patchNow(i, { magnitude_pct: v })} />
            </div>
            <Button
              size="icon"
              variant="ghost"
              aria-label="Remove disruption"
              className="col-span-2 h-8 w-8 min-h-11 min-w-11 justify-self-end text-destructive md:col-span-1 md:min-h-0 md:min-w-0 md:justify-self-auto"
              onClick={() => commit(local.filter((_, j) => j !== i))}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
            <EngineTicks startDay={d.start_day} durationDays={d.duration_days} warmup={warmup} />
            {reason ? (
              <p className="col-span-2 text-[10px] text-[#b3261e] md:col-span-12">{reason}</p>
            ) : outageOnly ? (
              <p className="col-span-2 text-[10px] text-[--warn-ink,#92400e] md:col-span-12">
                This supplier has no weekly capacity, so the engine runs a partial cut as a full outage.
              </p>
            ) : null}
          </div>
        );
      })}
      <Button
        variant="outline"
        size="sm"
        className="self-start gap-1"
        onClick={add}
        disabled={!!blocked}
        title={blocked ?? undefined}
      >
        <Plus className="h-3.5 w-3.5" /> Add disruption
      </Button>
      {blocked ? <p className="text-[10px] text-muted-foreground">{blocked}</p> : null}
    </div>
  );
}

/** Full outage, or a cut BY a share — the engine's reading of `magnitude_pct`. */
export function EffectControl({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const full = DISRUPTION_RULE.full_outage_pct;
  const partial = value < full;
  const [text, setText] = useState(String(partial ? value : 50));
  useEffect(() => {
    if (value < full) setText(String(value));
  }, [value, full]);
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <span className="inline-flex rounded-sm border border-input p-[2px]">
        {[
          { on: !partial, label: "Outage", v: full },
          { on: partial, label: "Cut by", v: Math.min(full - 1, Math.max(1, Number(text) || 50)) },
        ].map((o) => (
          <button
            key={o.label}
            type="button"
            onClick={() => onChange(o.v)}
            className={cn(
              "min-h-11 rounded-[2px] px-2 text-[12px] md:min-h-0 md:py-[3px]",
              o.on ? "bg-foreground text-background" : "text-[#52525b]",
            )}
          >
            {o.label}
          </button>
        ))}
      </span>
      {partial ? (
        <span className="inline-flex items-center gap-1">
          <Input
            aria-label="Cut by percent"
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
          <span className="text-[12px] text-muted-foreground">%</span>
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
      Engine runs week {startWeek} for {durationWeeks} wk
      {collapsed ? " — stored in days; the engine advances in weekly ticks" : ""}
      {note ? <span className="block text-[--warn-ink,#92400e]">{note}</span> : null}
    </p>
  );
}
