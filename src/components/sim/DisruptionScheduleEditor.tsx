import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, Trash2 } from "lucide-react";
import type { Scenario } from "@/hooks/useScenarios";
import { useTimeUnit, UNIT_LABEL_PLURAL } from "@/hooks/useTimeUnit";

interface Props {
  value: Scenario["disruption_schedule"];
  onChange: (next: Scenario["disruption_schedule"]) => void;
  projectId?: string | null;
}

export function DisruptionScheduleEditor({ value, onChange, projectId }: Props) {
  const { unit, fromDays, toDays } = useTimeUnit(projectId);
  const unitPlural = UNIT_LABEL_PLURAL[unit ?? "day"];

  const add = () =>
    onChange([
      ...value,
      { target: "", target_type: "node", start_day: 10, duration_days: 5, magnitude_pct: 50 },
    ]);
  const update = (i: number, patch: Partial<Scenario["disruption_schedule"][number]>) => {
    const next = [...value];
    next[i] = { ...next[i], ...patch };
    onChange(next);
  };
  const remove = (i: number) => onChange(value.filter((_, j) => j !== i));

  return (
    <div className="flex flex-col gap-2">
      {value.length === 0 && (
        <p className="text-xs text-muted-foreground">No disruptions scheduled.</p>
      )}
      {value.map((d, i) => (
        <div key={i} className="grid grid-cols-12 gap-2 items-end border border-border p-2 rounded-sm">
          <div className="col-span-3 flex flex-col gap-1">
            <Label className="text-[10px]">Target</Label>
            <Input
              className="h-8"
              value={d.target}
              placeholder="node/edge id"
              onChange={(e) => update(i, { target: e.target.value })}
            />
          </div>
          <div className="col-span-2 flex flex-col gap-1">
            <Label className="text-[10px]">Type</Label>
            <select
              className="h-8 bg-background border border-input rounded-sm px-2 text-sm"
              value={d.target_type}
              onChange={(e) => update(i, { target_type: e.target.value as "node" | "edge" })}
            >
              <option value="node">node</option>
              <option value="edge">edge</option>
            </select>
          </div>
          <div className="col-span-2 flex flex-col gap-1">
            <Label className="text-[10px]">Start ({unitPlural})</Label>
            <Input
              className="h-8"
              type="number"
              value={Math.round(fromDays(d.start_day))}
              onChange={(e) => update(i, { start_day: Math.round(toDays(+e.target.value)) })}
            />
          </div>
          <div className="col-span-2 flex flex-col gap-1">
            <Label className="text-[10px]">Duration ({unitPlural})</Label>
            <Input
              className="h-8"
              type="number"
              value={Math.round(fromDays(d.duration_days))}
              onChange={(e) => update(i, { duration_days: Math.round(toDays(+e.target.value)) })}
            />
          </div>
          <div className="col-span-2 flex flex-col gap-1">
            <Label className="text-[10px]">Magnitude %</Label>
            <Input
              className="h-8"
              type="number"
              value={d.magnitude_pct}
              onChange={(e) => update(i, { magnitude_pct: +e.target.value })}
            />
          </div>
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8 col-span-1 text-destructive"
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
