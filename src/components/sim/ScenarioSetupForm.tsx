import { useEffect, useState } from "react";
import { ParameterCard, TimeUnitBar, type ParamGroup, type Provenance } from "./ParameterCard";
import type { Scenario } from "@/hooks/useScenarios";
import { SCENARIO_ENGINE_DEFAULTS } from "@/hooks/useScenarios";
import { useTimeUnit, UNIT_LABEL_PLURAL } from "@/hooks/useTimeUnit";

interface Props {
  scenario: Scenario;
  projectId: string | null | undefined;
  onSave: (patch: Partial<Scenario>) => void;
}

const KPI_OPTIONS = [
  { value: "fill_rate", label: "Fill rate" },
  { value: "otif", label: "OTIF" },
  { value: "lead_time_days", label: "Lead time" },
  { value: "profit", label: "Profit" },
  { value: "utilization", label: "Utilization" },
];

/**
 * The scenario's parameters as two (plus one) titled Parameter | Value | Unit
 * cards — same shape as components/policies/PolicyDefaultsCard.tsx so the two
 * pages read as siblings. Days stay the stored truth; the planning unit is a
 * display concern owned by useTimeUnit.
 */
export function ScenarioSetupForm({ scenario, projectId, onSave }: Props) {
  const [local, setLocal] = useState<Scenario>(scenario);
  const { unit, setUnit, fromDays, toDays } = useTimeUnit(projectId);
  const displayUnit = unit ?? "day";
  const unitLabel = UNIT_LABEL_PLURAL[displayUnit];

  // Re-sync on server-side updates too (inheritance writes warm-up/replications
  // through the apply_validation_to_scenario RPC, not through this form).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => setLocal(scenario), [scenario.id, scenario.updated_at]);

  const save = (next: Scenario) => {
    const { id: _id, project_id: _p, created_at: _c, updated_at: _u, ...rest } = next;
    onSave(rest);
  };
  /** typed while the user is still typing — committed on blur */
  const patch = (fields: Partial<Scenario>) => setLocal((s) => ({ ...s, ...fields }));
  /** discrete controls (segmented, toggle, KPI) commit the moment they change */
  const patchNow = (fields: Partial<Scenario>) => {
    const next = { ...local, ...fields };
    setLocal(next);
    save(next);
  };
  const commit = () => save(local);

  /** A field is "inherited" while the validation card still owns it, "edited"
   *  once it diverges from the engine default, and unmarked otherwise. */
  const prov = (differs: boolean, inherited = false): Provenance =>
    inherited ? "inherited" : differs ? "edited" : null;
  const inherited = !!local.inherited_validation_id;

  const measured = Math.max(0, local.horizon_days - local.warmup_days);
  const simDays = local.replications * local.horizon_days;

  const runWindow: ParamGroup = {
    name: "Run window",
    fields: [
      {
        label: "Planning horizon",
        unit: unitLabel,
        provenance: prov(local.horizon_days !== SCENARIO_ENGINE_DEFAULTS.horizon_days),
        control: {
          kind: "number",
          value: Math.round(fromDays(local.horizon_days)),
          min: 1,
          onChange: (v) => patch({ horizon_days: Math.max(1, Math.round(toDays(v))) }),
          onCommit: commit,
        },
      },
      {
        label: "Steady state starts at",
        unit: unitLabel,
        provenance: prov(local.warmup_days !== SCENARIO_ENGINE_DEFAULTS.warmup_days, inherited),
        control: {
          kind: "number",
          value: Math.round(fromDays(local.warmup_days)),
          min: 0,
          // hand-setting warm-up leaves auto mode and drops the inheritance —
          // divergence from the validated settings is explicit, never silent
          onChange: (v) =>
            patch({
              warmup_days: Math.max(0, Math.round(toDays(v))),
              warmup_mode: "manual",
              inherited_validation_id: null,
            }),
          onCommit: commit,
        },
      },
      {
        label: "Warm-up detection",
        provenance: prov(local.warmup_mode !== SCENARIO_ENGINE_DEFAULTS.warmup_mode),
        control: {
          kind: "segmented",
          value: local.warmup_mode,
          options: [
            { value: "auto", label: "auto" },
            { value: "manual", label: "manual" },
          ],
          onChange: (v) => patchNow({ warmup_mode: v as Scenario["warmup_mode"] }),
        },
      },
      {
        label: "Time step",
        provenance: prov(local.time_step !== SCENARIO_ENGINE_DEFAULTS.time_step),
        control: {
          kind: "segmented",
          value: local.time_step,
          options: [
            { value: "day", label: "day" },
            { value: "hour", label: "hour" },
          ],
          onChange: (v) => patchNow({ time_step: v as Scenario["time_step"] }),
        },
      },
    ],
  };

  const precision: ParamGroup = {
    name: "Precision",
    chip: inherited ? "from model validation" : null,
    fields: [
      {
        label: "Replications",
        unit: "runs",
        provenance: prov(local.replications !== SCENARIO_ENGINE_DEFAULTS.replications, inherited),
        control: {
          kind: "number",
          value: local.replications,
          min: 1,
          onChange: (v) =>
            patch({ replications: Math.max(1, Math.round(v)), inherited_validation_id: null }),
          onCommit: commit,
        },
      },
      {
        label: "Common random numbers",
        provenance: prov(local.crn !== SCENARIO_ENGINE_DEFAULTS.crn),
        control: { kind: "toggle", value: local.crn, onChange: (v) => patchNow({ crn: v }) },
      },
      {
        label: "Seed",
        provenance: prov(local.seed !== SCENARIO_ENGINE_DEFAULTS.seed),
        control: {
          kind: "number",
          value: local.seed,
          width: 92,
          onChange: (v) => patch({ seed: Math.round(v) }),
          onCommit: commit,
        },
      },
      {
        label: "Stopping rule",
        provenance: prov(local.stopping_rule?.kind !== SCENARIO_ENGINE_DEFAULTS.stopping_rule.kind),
        control: {
          kind: "segmented",
          value: local.stopping_rule?.kind ?? "fixed_horizon",
          options: [
            { value: "fixed_horizon", label: "fixed horizon" },
            { value: "ci_halfwidth", label: "CI half-width" },
          ],
          onChange: (v) =>
            patchNow({
              stopping_rule: {
                ...local.stopping_rule,
                kind: v as Scenario["stopping_rule"]["kind"],
              },
            }),
        },
      },
    ],
  };

  const objective: ParamGroup = {
    name: "Objective",
    fields: [
      {
        label: "Primary KPI",
        provenance: prov(local.primary_kpi !== SCENARIO_ENGINE_DEFAULTS.primary_kpi),
        control: {
          kind: "segmented",
          value: local.primary_kpi,
          options: KPI_OPTIONS,
          onChange: (v) => patchNow({ primary_kpi: v }),
        },
      },
    ],
  };

  return (
    <div className="flex flex-col gap-3">
      <section className="overflow-hidden rounded-sm border border-[--hair-rule] bg-white">
        <div className="flex flex-col gap-1 px-4 py-3">
          <input
            value={local.name}
            onChange={(e) => patch({ name: e.target.value })}
            onBlur={commit}
            className="w-full rounded-sm border border-transparent px-1 py-px text-[16px] font-semibold tracking-[-0.011em] text-[#18181b] hover:border-[--hair-rule] focus:border-foreground focus:outline-none"
          />
          <input
            value={local.description}
            onChange={(e) => patch({ description: e.target.value })}
            onBlur={commit}
            placeholder="What this scenario tests"
            className="w-full rounded-sm border border-transparent px-1 py-px text-[12.5px] text-[#52525b] hover:border-[--hair-rule] focus:border-foreground focus:outline-none"
          />
        </div>
        <TimeUnitBar
          unit={displayUnit}
          onUnit={setUnit}
          horizonDays={local.horizon_days}
        />
      </section>

      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.16fr)] items-stretch gap-3">
        <ParameterCard
          group={runWindow}
          footer={`${local.horizon_days} d horizon · ${local.warmup_days} d warm-up · ${measured} d measured`}
        />
        <ParameterCard
          group={precision}
          footer={`${local.replications} × ${local.horizon_days} d = ${simDays.toLocaleString()} sim-days · seed ${local.seed}`}
        />
      </div>

      <ParameterCard group={objective} />
    </div>
  );
}
