import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { DisruptionScheduleEditor } from "./DisruptionScheduleEditor";
import { PlaybookPicker } from "./PlaybookPicker";
import { RecoveryResponse } from "@/lib/policies/schemas";
import {
  RESPONSE_LABELS,
  RESPONSE_WEIGHTS,
  type RecoveryConfig,
  type RecoveryResponseKey,
} from "@/lib/sim/recoveryScore";
import type { Scenario } from "@/hooks/useScenarios";
import { useRecoveryPlaybooks, type RecoveryPlaybook } from "@/hooks/useRecoveryPlaybooks";
import { useGlobalProject } from "@/hooks/useGlobalProject";
import { useTimeUnit } from "@/hooks/useTimeUnit";
import { supabase } from "@/integrations/supabase/client";
import { ShieldCheck } from "lucide-react";

type ScenarioWithPlaybook = Scenario & { recovery_playbook_id?: string | null };

interface Props {
  scenario: ScenarioWithPlaybook;
  /** project-level recovery defaults (merged into overrides for the live preview) */
  projectRecovery: RecoveryConfig | null;
  onSave: (patch: Partial<ScenarioWithPlaybook>) => void;
}

const STRATEGY_FIELDS: Partial<Record<RecoveryResponseKey, (keyof RecoveryConfig)[]>> = {
  reroute: ["detection_lag_days", "recovery_target_days"],
  mode_shift: ["detection_lag_days", "cost_cap"],
  safety_stock_drawdown: ["trigger_magnitude_pct", "recovery_target_days"],
  dual_source_activate: ["trigger_magnitude_pct", "trigger_duration_days", "cost_cap"],
  capacity_flex: ["trigger_magnitude_pct", "recovery_target_days", "cost_cap"],
  demand_shaping: ["trigger_magnitude_pct", "recovery_target_days"],
};

const ALL_FIELD_DEFS: Array<{
  key: keyof RecoveryConfig;
  label: string;
  step?: string;
  hint?: string;
}> = [
  { key: "trigger_magnitude_pct", label: "Trigger magnitude (%)", hint: "Disruption severity needed to activate the playbook" },
  { key: "trigger_duration_days", label: "Trigger duration (days)", hint: "How long the disruption must persist before activating" },
  { key: "detection_lag_days", label: "Detection lag (days)", step: "0.5", hint: "Days between disruption start and response kick-off" },
  { key: "recovery_target_days", label: "Recovery target (days)", hint: "Ramp-back window after the disruption clears" },
  { key: "cost_cap", label: "Cost cap ($)", hint: "Maximum spend on recovery actions per disruption" },
];

const DEFAULT_RECOVERY: RecoveryConfig = {
  enabled: true,
  response: [],
  detection_lag_days: 1,
  trigger_magnitude_pct: 25,
  trigger_duration_days: 2,
  recovery_target_days: 21,
  cost_cap: 25000,
};

function mergeRecovery(
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

export function DisruptionRecoveryPane({ scenario, projectRecovery, onSave }: Props) {
  const { globalSelectedProjectId: projectId } = useGlobalProject();
  const { adaptLabel } = useTimeUnit(projectId);
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

  const visibleFields = useMemo(() => {
    const responses = ((overrides.response as string[]) ?? effective.response ?? []) as RecoveryResponseKey[];
    const seen = new Set<keyof RecoveryConfig>();
    for (const opt of responses) {
      for (const f of STRATEGY_FIELDS[opt] ?? []) seen.add(f);
    }
    return ALL_FIELD_DEFS.filter((f) => seen.has(f.key));
  }, [overrides.response, effective.response]);

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

  return (
    <div className="flex flex-col gap-4">
      {/* Disruption timeline — full width */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Disruption schedule</CardTitle>
          <CardDescription className="text-xs">
            Schedule shocks across the horizon. The Recovery playbook below decides how the network responds.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <DisruptionScheduleEditor
            value={scenario.disruption_schedule}
            onChange={(v) => onSave({ disruption_schedule: v })}
            projectId={projectId}
          />
        </CardContent>
      </Card>

      {/* Recovery playbook — single column */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-start justify-between gap-2">
            <div>
              <CardTitle className="text-sm flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-primary" />
                Recovery playbook
              </CardTitle>
              <CardDescription className="text-xs">
                Overrides project defaults for this scenario only.
              </CardDescription>
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

          {/* enable switch */}
          <div className="flex items-center justify-between rounded-sm border border-border/60 bg-muted/20 px-3 py-2">
            <div>
              <div className="text-xs font-medium">Recovery enabled</div>
              <div className="text-[10px] text-muted-foreground">
                When off, disruptions hit raw — no mitigation runs.
              </div>
            </div>
            <Switch
              checked={effective.enabled}
              onCheckedChange={(v) => patchOverride("enabled", v)}
            />
          </div>

          {/* response mix */}
          <div>
            <Label className="text-xs mb-2 block">Response actions</Label>
            <div className="grid grid-cols-2 gap-1.5">
              {RecoveryResponse.options.map((opt) => {
                const active = activeResponses.has(opt);
                const weight = RESPONSE_WEIGHTS[opt as RecoveryResponseKey];
                return (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => toggleResponse(opt as RecoveryResponseKey)}
                    className={
                      "flex items-center justify-between text-left text-xs border px-2 py-1.5 rounded-sm transition-colors " +
                      (active
                        ? "border-primary bg-primary/10 text-foreground"
                        : "border-border hover:border-foreground/40 text-muted-foreground")
                    }
                  >
                    <span>{RESPONSE_LABELS[opt as RecoveryResponseKey]}</span>
                    <span className="font-mono text-[10px] opacity-70">
                      +{weight.toFixed(2)}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <Separator />

          {/* strategy-gated parameters */}
          {visibleFields.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Pick one or more response strategies above to configure their parameters.
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {visibleFields.map((f) => (
                <div key={f.key} className="flex flex-col gap-1">
                  <Label className="text-[11px]" title={f.hint}>
                    {adaptLabel(f.label)}
                  </Label>
                  <Input
                    type="number"
                    step={f.step ?? "1"}
                    value={Number(effective[f.key] ?? 0)}
                    onChange={(e) => patchOverride(f.key, parseFloat(e.target.value) || 0)}
                    className="h-8 text-xs"
                  />
                </div>
              ))}
            </div>
          )}

          <p className="text-[10px] text-muted-foreground">
            Tip: project-wide defaults live in{" "}
            <a href="/policies" className="underline hover:text-foreground">
              Supply chain policies
            </a>
            . Empty fields here fall back to those defaults.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
