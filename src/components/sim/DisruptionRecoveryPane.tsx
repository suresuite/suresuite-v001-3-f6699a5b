import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { DisruptionScheduleEditor } from "./DisruptionScheduleEditor";
import { PlaybookPicker } from "./PlaybookPicker";
import { RecoveryResponse } from "@/lib/policies/schemas";
import {
  RESPONSE_LABELS,
  type RecoveryConfig,
  type RecoveryResponseKey,
} from "@/lib/sim/recoveryScore";
import type { Scenario } from "@/hooks/useScenarios";
import { useRecoveryPlaybooks, type RecoveryPlaybook } from "@/hooks/useRecoveryPlaybooks";
import { useGlobalProject } from "@/hooks/useGlobalProject";
import { supabase } from "@/integrations/supabase/client";
import { ShieldCheck } from "lucide-react";

type ScenarioWithPlaybook = Scenario & { recovery_playbook_id?: string | null };

interface Props {
  scenario: ScenarioWithPlaybook;
  /** project-level recovery defaults (merged into overrides for the live preview) */
  projectRecovery: RecoveryConfig | null;
  onSave: (patch: Partial<ScenarioWithPlaybook>) => void;
  /**
   * Which card to render. `"all"` is both and is what desktop mounts, so the
   * desktop pane is unchanged. The phone tree renders the schedule as the
   * demo's table and opens THIS pane's playbook card in a sheet, so the
   * picker, the enable switch and the six strategy toggles are the same
   * controls with the same handlers — not a second copy. Presentational only.
   */
  sections?: "all" | "schedule" | "playbook";
}

interface StrategyParamDef {
  key: keyof RecoveryConfig;
  label: string;
  unit: string;
  default: number;
  step?: string;
  hint?: string;
}

const STRATEGY_PARAMS: Partial<Record<RecoveryResponseKey, StrategyParamDef[]>> = {
  dual_source_activate: [
    {
      key: "backup_lead_time_weeks",
      label: "Backup supplier lead time",
      unit: "weeks",
      default: 6,
      hint: "Standard lead time assumed for all backup suppliers (Ts')",
    },
  ],
  safety_stock_drawdown: [
    {
      key: "holding_cost_pct",
      label: "Annual holding cost",
      unit: "% of material cost",
      default: 20,
      hint: "Inventory carrying cost as a percentage of material value per year (hm)",
    },
  ],
  capacity_flex: [
    {
      key: "overtime_cost_pct",
      label: "Overtime cost",
      unit: "% of product price",
      default: 5,
      hint: "Additional cost per unit produced during overtime shifts (Cop)",
    },
  ],
  demand_shaping: [
    {
      key: "allocation_horizon_weeks",
      label: "Planning horizon",
      unit: "weeks",
      default: 4,
      hint: "Rolling window for the material-allocation LP (W)",
    },
    {
      key: "annual_labor_cost",
      label: "Annual planning labor cost",
      unit: "€",
      default: 6240,
      hint: "Indirect labor cost for supply chain allocation team — 208 h/yr (Calc)",
    },
  ],
  mode_shift: [
    {
      key: "expedite_cost_pct",
      label: "Expedite cost",
      unit: "% of material cost per order",
      default: 3,
      hint: "Premium to accelerate in-transit materials to the current week (Cexp)",
    },
  ],
  reroute: [],
};

const STRATEGY_DESCRIPTIONS: Record<RecoveryResponseKey, string> = {
  dual_source_activate: "Release orders to a predefined backup supplier when the primary is disrupted",
  safety_stock_drawdown: "ABC-XYZ classified buffer stock protects against deep disruptions; incurs annual holding cost",
  capacity_flex: "Activate overtime shifts when the revenue gain exceeds the overtime cost",
  demand_shaping: "Revenue-maximising material allocation LP over a rolling planning horizon",
  mode_shift: "Accelerate in-transit shipments when expedite revenue exceeds expedite cost",
  reroute: "Redirect flows through alternative network paths",
};

const DEFAULT_RECOVERY: RecoveryConfig = {
  enabled: true,
  response: [],
};

/** Project defaults overlaid with the scenario's overrides — the config the
 *  run actually uses. Exported so the page can read the effective lever count
 *  for the stage rail without re-deriving the merge. */
export function mergeRecovery(
  defaults: RecoveryConfig | null,
  overrides: Record<string, unknown> | null,
): RecoveryConfig {
  const base: Record<string, unknown> = { ...DEFAULT_RECOVERY, ...(defaults ?? {}) };
  if (overrides && typeof overrides === "object") {
    for (const [k, v] of Object.entries(overrides)) {
      if (v === undefined || v === null) continue;
      base[k] = v;
    }
  }
  return base as unknown as RecoveryConfig;
}

/** Local display text, separate from the committed number: a controlled
 *  input tied directly to a `number` can't represent "currently empty" or
 *  "mid-edit", so clearing the field would otherwise snap back to the
 *  fallback default on the very keystroke that empties it. */
function StrategyParamInput({
  value,
  step,
  onCommit,
}: {
  value: number;
  step: string;
  onCommit: (v: number) => void;
}) {
  const [text, setText] = useState(String(value));

  // Resync when the committed value changes from outside (playbook switch,
  // reset to playbook, another field's mutual-exclusion side effect, etc).
  useEffect(() => {
    setText(String(value));
  }, [value]);

  return (
    <Input
      type="number"
      step={step}
      value={text}
      onChange={(e) => {
        const raw = e.target.value;
        setText(raw); // reflect exactly what was typed, including ""
        const v = parseFloat(raw);
        if (raw !== "" && Number.isFinite(v)) onCommit(v);
      }}
      onBlur={() => {
        const v = parseFloat(text);
        if (text === "" || !Number.isFinite(v)) {
          setText(String(value)); // revert display only, nothing to commit
        }
      }}
      className="h-8 min-h-11 text-xs md:min-h-0"
    />
  );
}

function shallowEqualConfig(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    const av = a[k];
    const bv = b[k];
    if (Array.isArray(av) && Array.isArray(bv)) {
      if (av.length !== bv.length || av.some((x, i) => x !== bv[i])) return false;
    } else if (av !== bv) {
      return false;
    }
  }
  return true;
}

export function DisruptionRecoveryPane({ scenario, projectRecovery, onSave, sections = "all" }: Props) {
  const { globalSelectedProjectId: projectId } = useGlobalProject();
  const { playbooks, create: createPlaybook, update: updatePlaybook, remove: removePlaybook } =
    useRecoveryPlaybooks(projectId);
  const overrides = (scenario.recovery_overrides ?? {}) as Record<string, unknown>;
  const effective = useMemo(
    () => mergeRecovery(projectRecovery, overrides),
    [projectRecovery, overrides],
  );

  const selectedPlaybook = useMemo<RecoveryPlaybook | null>(
    () => playbooks.find((p) => p.id === scenario.recovery_playbook_id) ?? null,
    [playbooks, scenario.recovery_playbook_id],
  );

  const modified = useMemo(() => {
    if (!selectedPlaybook) return false;
    return !shallowEqualConfig(
      (selectedPlaybook.config ?? {}) as Record<string, unknown>,
      overrides,
    );
  }, [selectedPlaybook, overrides]);

  const patchOverride = (key: keyof RecoveryConfig, val: unknown) => {
    onSave({ recovery_overrides: { ...overrides, [key]: val } });
  };

  const toggleResponse = (opt: RecoveryResponseKey) => {
    const current = (overrides.response as string[]) ?? effective.response ?? [];
    const next = current.includes(opt)
      ? current.filter((x) => x !== opt)
      : [...current, opt];
    patchOverride("response", next);
  };

  const activeResponses = new Set<string>(
    (overrides.response as string[]) ?? effective.response ?? [],
  );

  const overriddenFields = Object.entries(overrides).filter(
    ([, v]) => v !== undefined && v !== null,
  ).length;

  const handleSelectPlaybook = (pb: RecoveryPlaybook | null) => {
    if (!pb) {
      onSave({ recovery_playbook_id: null });
      return;
    }
    onSave({
      recovery_playbook_id: pb.id,
      recovery_overrides: { ...(pb.config ?? {}) } as Record<string, unknown>,
    });
  };

  const handleSaveAs = async (name: string, description: string) => {
    try {
      const created = await createPlaybook({
        name,
        description,
        config: { ...overrides } as Record<string, unknown>,
      });
      onSave({ recovery_playbook_id: created.id });
      toast.success(`Saved playbook "${name}"`);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const handleSaveChanges = async () => {
    if (!selectedPlaybook) return;
    try {
      await updatePlaybook(selectedPlaybook.id, {
        config: { ...overrides } as Record<string, unknown>,
      });
      toast.success(`Updated "${selectedPlaybook.name}"`);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const handleReset = () => {
    if (!selectedPlaybook) return;
    onSave({ recovery_overrides: { ...(selectedPlaybook.config ?? {}) } as Record<string, unknown> });
  };

  const handleDelete = async (id: string) => {
    try {
      await removePlaybook(id);
      if (selectedPlaybook?.id === id) onSave({ recovery_playbook_id: null });
      toast.success("Playbook deleted");
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const [uid, setUid] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void supabase.auth.getUser().then(({ data }) => {
      if (!cancelled) setUid(data.user?.id ?? null);
    });
    return () => { cancelled = true; };
  }, []);
  const canEditSelected = !!selectedPlaybook && !selectedPlaybook.is_system && selectedPlaybook.created_by === uid;

  // Ordered list: paper strategies first, then reroute
  const strategyOrder: RecoveryResponseKey[] = [
    "dual_source_activate",
    "safety_stock_drawdown",
    "capacity_flex",
    "demand_shaping",
    "mode_shift",
    "reroute",
  ];

  const show = (s: Props["sections"]) => sections === "all" || sections === s;

  return (
    <div className="flex flex-col gap-4">
      {/* Disruption timeline */}
      {show("schedule") ? (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Disruption schedule</CardTitle>
        </CardHeader>
        <CardContent>
          <DisruptionScheduleEditor
            value={scenario.disruption_schedule}
            onChange={(v) => onSave({ disruption_schedule: v })}
            projectId={projectId}
          />
        </CardContent>
      </Card>
      ) : null}

      {/* Recovery playbook */}
      {show("playbook") ? (
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-start justify-between gap-2">
            <div>
              <CardTitle className="text-sm flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-primary" />
                Recovery playbook
              </CardTitle>
            </div>
            {overriddenFields > 0 && (
              <Badge variant="secondary" className="text-[10px]">
                {overriddenFields} override{overriddenFields > 1 ? "s" : ""}
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <PlaybookPicker
            playbooks={playbooks}
            selectedId={scenario.recovery_playbook_id ?? null}
            modified={modified}
            onSelect={handleSelectPlaybook}
            onSaveAs={handleSaveAs}
            onSaveChanges={handleSaveChanges}
            onResetToPlaybook={handleReset}
            onDelete={handleDelete}
            canEditSelected={canEditSelected}
          />

          {/* Recovery enabled switch */}
          <div
            className="flex items-center justify-between rounded-sm border border-border/60 bg-muted/20 px-3 py-2"
            title="When off, disruptions hit raw — no mitigation runs."
          >
            <div className="text-xs font-medium">Recovery enabled</div>
            {/* §2.4: the track stays 24px; `box-content` plus the negated
                margin grow the hit box to 44px without moving anything. */}
            <Switch
              checked={effective.enabled}
              onCheckedChange={(v) => patchOverride("enabled", v)}
              className="-my-[10px] box-content py-[10px] md:my-0 md:box-border md:py-0"
            />
          </div>

          {/* Per-strategy cards */}
          <div className="flex flex-col gap-2">
            <Label className="text-xs">Response strategies</Label>
            {strategyOrder
              .filter((opt) => RecoveryResponse.options.includes(opt))
              .map((opt) => {
                const active = activeResponses.has(opt);
                const params = STRATEGY_PARAMS[opt] ?? [];
                return (
                  <div
                    key={opt}
                    className={cn(
                      "rounded-sm border transition-colors",
                      active ? "border-primary/50 bg-primary/5" : "border-border",
                    )}
                  >
                    {/* Strategy header — clickable to toggle */}
                    <button
                      type="button"
                      className="w-full flex min-h-11 items-start gap-3 px-3 py-2.5 text-left md:min-h-0"
                      title={STRATEGY_DESCRIPTIONS[opt]}
                      onClick={() => toggleResponse(opt)}
                    >
                      <div
                        className={cn(
                          "mt-0.5 h-3.5 w-3.5 shrink-0 rounded-sm border transition-colors",
                          active ? "border-primary bg-primary" : "border-muted-foreground/40",
                        )}
                      />
                      <div className="flex flex-col gap-0.5 min-w-0">
                        <span className={cn("text-xs font-medium", active ? "text-foreground" : "text-muted-foreground")}>
                          {RESPONSE_LABELS[opt]}
                        </span>
                      </div>
                    </button>

                    {/* Strategy params — only when active and params exist */}
                    {active && params.length > 0 && (
                      <div className="border-t border-border/60 px-3 py-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                        {params.map((f) => {
                          const stored = overrides[f.key as string];
                          const displayVal = stored !== undefined && stored !== null
                            ? Number(stored)
                            : ((effective[f.key] as number | undefined) ?? f.default);
                          return (
                            <div key={f.key} className="flex flex-col gap-1">
                              <Label className="text-[11px]" title={f.hint}>
                                {f.label}
                                <span className="text-muted-foreground font-normal ml-1">({f.unit})</span>
                              </Label>
                              {/* <Input
                                type="number"
                                step={f.step ?? "1"}
                                value={displayVal}
                                onChange={(e) =>
                                  patchOverride(f.key, parseFloat(e.target.value) || f.default)
                                }
                                className="h-8 min-h-11 text-xs md:min-h-0"
                              /> */}
                              <StrategyParamInput
                                value={displayVal}
                                step={f.step ?? "1"}
                                onCommit={(v) => patchOverride(f.key, v)}
                                />
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
          </div>
        </CardContent>
      </Card>
      ) : null}
    </div>
  );
}
