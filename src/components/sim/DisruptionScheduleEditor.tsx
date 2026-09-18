import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, Trash2 } from "lucide-react";
import type { Scenario } from "@/hooks/useScenarios";
import { useTimeUnit, UNIT_LABEL_PLURAL } from "@/hooks/useTimeUnit";
import { useEffect, useState } from "react";


interface Props {
  value: Scenario["disruption_schedule"];
  onChange: (next: Scenario["disruption_schedule"]) => void;
  projectId?: string | null;
}

/** Local display text, separate from the committed number: a controlled
 *  input tied directly to a `number` can't represent "currently empty" —
 *  clearing the field coerces to 0 via `+e.target.value` and immediately
 *  re-fills the box instead of leaving it blank to type into. Valid values
 *  still patch local state live, same as before; only empty/invalid display
 *  state is now possible while typing. */
function DisruptionNumberInput({
  value,
  onChange,
  onBlur,
}: {
  value: number;
  onChange: (v: number) => void;
  onBlur: () => void;
}) {
  const [text, setText] = useState(String(value));

  useEffect(() => {
    setText(String(value));
  }, [value]);

  return (
    <Input
      className="h-8 min-h-11 md:min-h-0"
      type="number"
      value={text}
      onChange={(e) => {
        const raw = e.target.value;
        setText(raw); // reflect exactly what was typed, including ""
        const v = parseFloat(raw);
        if (raw !== "" && Number.isFinite(v)) onChange(v);
      }}
      onBlur={() => {
        const v = parseFloat(text);
        if (text === "" || !Number.isFinite(v)) {
          setText(String(value)); // revert display only
        }
        onBlur(); // still push local state up, unchanged behavior
      }}
    />
  );
}

export function DisruptionScheduleEditor({ value, onChange, projectId }: Props) {
  const { unit, fromDays, toDays } = useTimeUnit(projectId);
  const unitPlural = UNIT_LABEL_PLURAL[unit ?? "day"];

  const [local, setLocal] = useState(value);
  useEffect(() => setLocal(value), [value]);

  const patch = (i: number, fields: Partial<Scenario["disruption_schedule"][number]>) => {
    setLocal((cur) => {
      const next = [...cur];
      next[i] = { ...next[i], ...fields };
      return next;
    });
  };
  const commit = () => onChange(local);

  // discrete actions (add/remove/type select) still commit immediately
  const add = () => {
    const next = [...local, { target: "", target_type: "node", start_day: 10, duration_days: 5, magnitude_pct: 50 }];
    setLocal(next);
    onChange(next);
  };
  const remove = (i: number) => {
    const next = local.filter((_, j) => j !== i);
    setLocal(next);
    onChange(next);
  };
  const patchNow = (i: number, fields: Partial<Scenario["disruption_schedule"][number]>) => {
    const next = [...local];
    next[i] = { ...next[i], ...fields };
    setLocal(next);
    onChange(next);
  };

  return (
    <div className="flex flex-col gap-2">
      {local.length === 0 && <p className="text-xs text-muted-foreground">No disruptions scheduled.</p>}
      {local.map((d, i) => (
        <div key={i} className="grid grid-cols-2 gap-2 items-end border border-border p-2 rounded-sm md:grid-cols-12">
          <div className="col-span-2 flex flex-col gap-1 md:col-span-3">
            <Label className="text-[10px]">Target</Label>
            <Input
              className="h-8 min-h-11 md:min-h-0"
              value={d.target}
              placeholder="node/edge id"
              onChange={(e) => patch(i, { target: e.target.value })}
              onBlur={commit}
            />
          </div>
          <div className="col-span-1 flex flex-col gap-1 md:col-span-2">
            <Label className="text-[10px]">Type</Label>
            <select
              className="h-8 min-h-11 md:min-h-0 bg-background border border-input rounded-sm px-2 text-sm"
              value={d.target_type}
              onChange={(e) => patchNow(i, { target_type: e.target.value as "node" | "edge" })}
            >
              <option value="node">node</option>
              <option value="edge">edge</option>
            </select>
          </div>
          <div className="col-span-1 flex flex-col gap-1 md:col-span-2">
            <Label className="text-[10px]">Start ({unitPlural})</Label>
            <DisruptionNumberInput
              value={Math.round(fromDays(d.start_day))}
              onChange={(v) => patch(i, {start_day: Math.round(toDays(v)) })}
              onBlur={commit} />
          </div>
          <div className="col-span-1 flex flex-col gap-1 md:col-span-2">
            <Label className="text-[10px]">Duration ({unitPlural})</Label>
            <DisruptionNumberInput
              value={Math.round(fromDays(d.duration_days))}
              onChange={(e) => patch(i, { duration_days: Math.round(toDays(+e.target.value)) })}
              onBlur={commit}
            />
          </div>
          <div className="col-span-1 flex flex-col gap-1 md:col-span-2">
            <Label className="text-[10px]">Magnitude %</Label>
            <DisruptionNumberInput
              value={d.magnitude_pct}
              onChange={(e) => patch(i, { magnitude_pct: +e.target.value })}
              onBlur={commit}
            />
          </div>
          <Button
            size="icon" variant="ghost"
            className="h-8 w-8 min-h-11 min-w-11 col-span-2 justify-self-end text-destructive md:col-span-1 md:min-h-0 md:min-w-0 md:justify-self-auto"
            onClick={() => remove(i)}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ))}
      <Button variant="outline" size="sm" className="self-start gap-1" onClick={add}>
        <Plus className="h-3.5 w-3.5" /> Add disruption
      </Button>
    </div>
  );
}