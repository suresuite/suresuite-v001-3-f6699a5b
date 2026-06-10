import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { Scenario } from "@/hooks/useScenarios";
import { useTimeUnit, UNIT_LABEL_PLURAL } from "@/hooks/useTimeUnit";

interface Props {
  scenario: Scenario;
  projectId: string | null | undefined;
  onSave: (patch: Partial<Scenario>) => void;
}

const KPI_OPTIONS = [
  { key: "fill_rate", label: "Fill rate" },
  { key: "otif", label: "OTIF" },
  { key: "lead_time_days", label: "Lead time" },
  { key: "profit", label: "Profit" },
  { key: "utilization", label: "Utilization" },
];

export function ScenarioSetupForm({ scenario, projectId, onSave }: Props) {
  const [local, setLocal] = useState<Scenario>(scenario);
  const { unit, fromDays, toDays } = useTimeUnit(projectId);
  const displayUnit = unit ?? "day";

  useEffect(() => setLocal(scenario), [scenario.id]);

  const patch = <K extends keyof Scenario>(key: K, val: Scenario[K]) => {
    setLocal((s) => ({ ...s, [key]: val }));
  };
  const commit = () => {
    const { id: _id, project_id: _p, created_at: _c, updated_at: _u, ...rest } = local;
    onSave(rest);
  };

  const estimate = local.replications * local.horizon_days;
  const wallEst = Math.round((estimate / 4000) * 10) / 10;

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex flex-col gap-1 flex-1">
              <Input
                className="text-lg font-semibold h-9 border-transparent hover:border-input focus:border-input -ml-2 px-2"
                value={local.name}
                onChange={(e) => patch("name", e.target.value)}
                onBlur={commit}
              />
              <Textarea
                className="text-sm border-transparent hover:border-input focus:border-input min-h-[2rem] resize-none -ml-2 px-2"
                placeholder="Describe what this scenario tests…"
                value={local.description}
                onChange={(e) => patch("description", e.target.value)}
                onBlur={commit}
                rows={1}
              />
            </div>
            <Badge variant="outline" className="text-[10px] mt-2">
              ≈ {estimate.toLocaleString()} sim-days · ~{wallEst}s
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {/* Planning horizon */}
          <div className="flex flex-col gap-1">
            <Label className="text-xs">Planning horizon ({UNIT_LABEL_PLURAL[displayUnit]})</Label>
            <Input
              type="number"
              className="max-w-[160px]"
              value={Math.round(fromDays(local.horizon_days))}
              onChange={(e) => patch("horizon_days", Math.round(toDays(+e.target.value)))}
              onBlur={commit}
            />
          </div>

          {/* Steady-state & confidence — read only */}
          <div className="rounded-md border border-border bg-muted/30 px-3 py-2.5 flex flex-col gap-1">
            <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
              Steady-state &amp; confidence
            </span>
            <span className="text-xs">
              Steady state starts at:{" "}
              <strong>
                {Math.round(fromDays(local.warmup_days))} {UNIT_LABEL_PLURAL[displayUnit]}
              </strong>
            </span>
            <span className="text-xs">
              Replications for statistical significance: <strong>{local.replications}</strong>
            </span>
          </div>

          {/* Primary KPI */}
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">Primary KPI</Label>
            <div className="grid grid-cols-3 gap-1.5">
              {KPI_OPTIONS.map(({ key, label }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => {
                    patch("primary_kpi", local.primary_kpi === key ? "" : key);
                    setTimeout(commit, 0);
                  }}
                  className={cn(
                    "text-xs border px-2 py-1.5 rounded-sm transition-colors text-left",
                    local.primary_kpi === key
                      ? "border-primary bg-primary/10 text-foreground font-medium"
                      : "border-border hover:border-foreground/40 text-muted-foreground",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
