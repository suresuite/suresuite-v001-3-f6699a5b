import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Textarea } from "@/components/ui/textarea";
import { Shuffle } from "lucide-react";
import type { Scenario } from "@/hooks/useScenarios";
import { randomSeed } from "@/lib/sim/seeds";
// Disruption + recovery editors moved to DisruptionRecoveryPane.

interface Props {
  scenario: Scenario;
  onSave: (patch: Partial<Scenario>) => void;
}

const KPI_OPTIONS = ["fill_rate", "otif", "lead_time_days", "profit", "utilization"];

export function ScenarioSetupForm({ scenario, onSave }: Props) {
  const [local, setLocal] = useState<Scenario>(scenario);

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
        <CardContent>
          <Accordion type="multiple" defaultValue={["horizon", "warmup", "reps"]}>
            <AccordionItem value="horizon">
              <AccordionTrigger className="text-sm">Time horizon</AccordionTrigger>
              <AccordionContent>
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1">
                    <Label className="text-xs">Horizon (days)</Label>
                    <Input
                      type="number"
                      value={local.horizon_days}
                      onChange={(e) => patch("horizon_days", +e.target.value)}
                      onBlur={commit}
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <Label className="text-xs">Time step</Label>
                    <Select
                      value={local.time_step}
                      onValueChange={(v) => {
                        patch("time_step", v as "day" | "hour");
                        setTimeout(commit, 0);
                      }}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="day">day</SelectItem>
                        <SelectItem value="hour">hour</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="warmup">
              <AccordionTrigger className="text-sm">Warm-up detection</AccordionTrigger>
              <AccordionContent>
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1">
                    <Label className="text-xs">Mode</Label>
                    <Select
                      value={local.warmup_mode}
                      onValueChange={(v) => {
                        patch("warmup_mode", v as "manual" | "auto");
                        setTimeout(commit, 0);
                      }}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="auto">auto (Welch + MSER-5)</SelectItem>
                        <SelectItem value="manual">manual</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex flex-col gap-1">
                    <Label className="text-xs">
                      {local.warmup_mode === "auto" ? "Min warm-up (days)" : "Warm-up days"}
                    </Label>
                    <Input
                      type="number"
                      value={local.warmup_days}
                      onChange={(e) => patch("warmup_days", +e.target.value)}
                      onBlur={commit}
                    />
                  </div>
                </div>
                <p className="text-[11px] text-muted-foreground mt-2">
                  Auto mode runs a pilot replication and trims the bias-laden transient using Welch's
                  moving average; falls back to MSER-5 minimization.
                </p>
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="reps">
              <AccordionTrigger className="text-sm">Replications &amp; seeds</AccordionTrigger>
              <AccordionContent>
                <div className="flex flex-col gap-4">
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs">Replications</Label>
                      <span className="text-xs font-mono">{local.replications}</span>
                    </div>
                    <Slider
                      min={1}
                      max={200}
                      step={1}
                      value={[local.replications]}
                      onValueChange={(v) => patch("replications", v[0])}
                      onValueCommit={commit}
                    />
                  </div>
                  <div className="grid grid-cols-[1fr_auto] gap-2 items-end">
                    <div className="flex flex-col gap-1">
                      <Label className="text-xs">Master seed</Label>
                      <Input
                        type="number"
                        value={local.seed}
                        onChange={(e) => patch("seed", +e.target.value)}
                        onBlur={commit}
                      />
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        const s = randomSeed();
                        patch("seed", s);
                        setTimeout(commit, 0);
                      }}
                      className="gap-1"
                    >
                      <Shuffle className="h-3.5 w-3.5" /> Randomize
                    </Button>
                  </div>
                  <div className="flex items-center justify-between">
                    <div>
                      <Label className="text-xs">Common Random Numbers (CRN)</Label>
                      <p className="text-[11px] text-muted-foreground">
                        Share random streams across scenarios for variance reduction.
                      </p>
                    </div>
                    <Switch
                      checked={local.crn}
                      onCheckedChange={(v) => {
                        patch("crn", v);
                        setTimeout(commit, 0);
                      }}
                    />
                  </div>
                </div>
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="demand">
              <AccordionTrigger className="text-sm">Demand model</AccordionTrigger>
              <AccordionContent>
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1">
                    <Label className="text-xs">Kind</Label>
                    <Select
                      value={local.demand_model.kind}
                      onValueChange={(v) => {
                        patch("demand_model", { ...local.demand_model, kind: v });
                        setTimeout(commit, 0);
                      }}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="deterministic">deterministic</SelectItem>
                        <SelectItem value="poisson">Poisson(λ)</SelectItem>
                        <SelectItem value="negbin">Neg-binomial(r,p)</SelectItem>
                        <SelectItem value="historical_bootstrap">historical bootstrap</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {local.demand_model.kind === "poisson" && (
                    <div className="flex flex-col gap-1">
                      <Label className="text-xs">λ (mean/day)</Label>
                      <Input
                        type="number"
                        value={local.demand_model.lambda ?? 50}
                        onChange={(e) =>
                          patch("demand_model", { ...local.demand_model, lambda: +e.target.value })
                        }
                        onBlur={commit}
                      />
                    </div>
                  )}
                  {local.demand_model.kind === "negbin" && (
                    <>
                      <div className="flex flex-col gap-1">
                        <Label className="text-xs">r</Label>
                        <Input
                          type="number"
                          value={local.demand_model.r ?? 10}
                          onChange={(e) =>
                            patch("demand_model", { ...local.demand_model, r: +e.target.value })
                          }
                          onBlur={commit}
                        />
                      </div>
                      <div className="flex flex-col gap-1">
                        <Label className="text-xs">p</Label>
                        <Input
                          type="number"
                          step="0.05"
                          value={local.demand_model.p ?? 0.3}
                          onChange={(e) =>
                            patch("demand_model", { ...local.demand_model, p: +e.target.value })
                          }
                          onBlur={commit}
                        />
                      </div>
                    </>
                  )}
                </div>
              </AccordionContent>
            </AccordionItem>

            {/* Disruption schedule and Recovery playbook now live in the
                "Disruptions & Recovery" pane for tighter feedback loops. */}

            <AccordionItem value="stopping">
              <AccordionTrigger className="text-sm">Stopping rule</AccordionTrigger>
              <AccordionContent>
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1">
                    <Label className="text-xs">Rule</Label>
                    <Select
                      value={local.stopping_rule.kind}
                      onValueChange={(v) => {
                        patch("stopping_rule", {
                          ...local.stopping_rule,
                          kind: v as "fixed_horizon" | "ci_halfwidth",
                        });
                        setTimeout(commit, 0);
                      }}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="fixed_horizon">Fixed: run all replications</SelectItem>
                        <SelectItem value="ci_halfwidth">Sequential: stop when CI half-width &lt; ε</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex flex-col gap-1">
                    <Label className="text-xs">Primary KPI</Label>
                    <Select
                      value={local.primary_kpi}
                      onValueChange={(v) => {
                        patch("primary_kpi", v);
                        setTimeout(commit, 0);
                      }}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {KPI_OPTIONS.map((k) => (
                          <SelectItem key={k} value={k}>{k}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {local.stopping_rule.kind === "ci_halfwidth" && (
                    <div className="flex flex-col gap-1">
                      <Label className="text-xs">ε (half-width target)</Label>
                      <Input
                        type="number"
                        step="0.001"
                        value={local.stopping_rule.epsilon ?? 0.01}
                        onChange={(e) =>
                          patch("stopping_rule", {
                            ...local.stopping_rule,
                            epsilon: +e.target.value,
                          })
                        }
                        onBlur={commit}
                      />
                    </div>
                  )}
                  <div className="flex flex-col gap-1">
                    <Label className="text-xs">Max wall-clock (s)</Label>
                    <Input
                      type="number"
                      value={local.stopping_rule.max_wall_seconds ?? 600}
                      onChange={(e) =>
                        patch("stopping_rule", {
                          ...local.stopping_rule,
                          max_wall_seconds: +e.target.value,
                        })
                      }
                      onBlur={commit}
                    />
                  </div>
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </CardContent>
      </Card>
    </div>
  );
}
