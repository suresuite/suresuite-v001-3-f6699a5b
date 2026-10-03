import { useEffect, useState } from "react";
import { runWindowFooter } from "@/lib/sim/runWindow";
import { ParameterCard, PlanningUnitChip, type ParamGroup, type Provenance } from "./ParameterCard";
import type { Scenario } from "@/hooks/useScenarios";
import { SCENARIO_ENGINE_DEFAULTS } from "@/hooks/useScenarios";
import { useTimeUnit, UNIT_LABEL_PLURAL } from "@/hooks/useTimeUnit";
import { HORIZON_WEEKS, editWeeks, engineWeeks, formatDuration } from "@/lib/sim/planningTime";

interface Props {
  scenario: Scenario;
  projectId: string | null | undefined;
  onSave: (patch: Partial<Scenario>) => void;
  /**
   * Which part of the form to render. `"all"` is the whole form and is what
   * desktop mounts, so the desktop pane is unchanged. The phone tree
   * (MobileSimulationLab) mounts one section per sheet, so each of the demo's
   * Setup rows opens the REAL editor for the fields it names rather than a
   * second copy of them. Purely presentational — the state, the commit
   * semantics and the patch shape are identical in every section.
   */
  section?: "all" | "identity" | "runWindow" | "precision" | "objective";
}

export const KPI_OPTIONS = [
  { value: "fill_rate", label: "Fill rate" },
  { value: "otif", label: "OTIF" },
  { value: "lead_time_days", label: "Lead time" },
  { value: "profit", label: "Profit" },
  { value: "utilization", label: "Utilization" },
];

/**
 * The scenario's parameters as two (plus one) titled Parameter | Value | Unit
 * cards — the shape the /policies defaults card had (now `ProjectRuleBar`), so the two
 * pages read as siblings. Days stay the stored truth; the planning unit is a
 * display concern owned by useTimeUnit.
 */
export function ScenarioSetupForm({ scenario, projectId, onSave, section = "all" }: Props) {
  const [local, setLocal] = useState<Scenario>(scenario);
  // The planning unit is read, never chosen, here: /policies sets it, and
  // every figure below is converted by planningTime (WP 9.4 slice 1).
  const { unit } = useTimeUnit(projectId);
  const unitLabel = UNIT_LABEL_PLURAL[unit];

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

  const runWeeks = local.replications * engineWeeks(local.horizon_days);

  const runWindow: ParamGroup = {
    name: "Run window",
    fields: [
      {
        label: "Planning horizon",
        unit: unitLabel,
        provenance: prov(local.horizon_days !== SCENARIO_ENGINE_DEFAULTS.horizon_days),
        control: {
          kind: "number",
          value: engineWeeks(local.horizon_days),
          min: HORIZON_WEEKS.min,
          max: HORIZON_WEEKS.max,
          // Against the STORED value, so retyping the same week never moves a
          // fingerprinted horizon (365 d stays 365, not 364).
          onChange: (v) => patch({ horizon_days: editWeeks(scenario.horizon_days, Math.max(1, v)) }),
          onCommit: commit,
        },
      },
      {
        label: "Steady state starts at",
        unit: unitLabel,
        provenance: prov(local.warmup_days !== SCENARIO_ENGINE_DEFAULTS.warmup_days, inherited),
        control: {
          kind: "number",
          value: engineWeeks(local.warmup_days),
          min: 0,
          // hand-setting warm-up leaves auto mode and drops the inheritance —
          // divergence from the validated settings is explicit, never silent
          onChange: (v) =>
            patch({
              warmup_days: editWeeks(scenario.warmup_days, Math.max(0, v)),
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

  const show = (s: Props["section"]) => section === "all" || section === s;

  return (
    <div className="flex flex-col gap-3">
      {show("identity") ? (
      <section className="overflow-hidden rounded-sm border border-[--hair-rule] bg-white">
        <div className="flex flex-col gap-1 px-4 py-3">
          <input
            value={local.name}
            onChange={(e) => patch({ name: e.target.value })}
            onBlur={commit}
            className="min-h-11 w-full rounded-sm border border-transparent px-1 py-px text-[16px] font-semibold tracking-[-0.011em] text-[#18181b] hover:border-[--hair-rule] focus:border-foreground focus:outline-none md:min-h-0"
          />
          <input
            value={local.description}
            onChange={(e) => patch({ description: e.target.value })}
            onBlur={commit}
            placeholder="What this scenario tests"
            className="min-h-11 w-full rounded-sm border border-transparent px-1 py-px text-[12.5px] text-[#52525b] hover:border-[--hair-rule] focus:border-foreground focus:outline-none md:min-h-0"
          />
        </div>
        <PlanningUnitChip unit={unit} />
      </section>
      ) : null}

      {/* Two cards side by side leave 131px and 152px at 320px — narrower than
          either card's own header. They stack below `md`; `md:` restores the
          desktop template literally. */}
      {show("runWindow") || show("precision") ? (
      <div className="grid grid-cols-[minmax(0,1fr)] items-stretch gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1.16fr)]">
        {show("runWindow") ? (
        <ParameterCard
          group={runWindow}
          // The engine's window, not `horizon − warm-up` (audit F-02): the rule is
          // exported by the engine and pinned by `runWindow.test.ts`.
          footer={`${formatDuration(local.horizon_days)} horizon · ${runWindowFooter(local)}`}
        />
        ) : null}
        {show("precision") ? (
        <ParameterCard
          group={precision}
          footer={`${local.replications} × ${formatDuration(local.horizon_days)} = ${runWeeks.toLocaleString()} run-weeks · seed ${local.seed}`}
        />
        ) : null}
      </div>
      ) : null}

      {show("objective") ? <ParameterCard group={objective} /> : null}
    </div>
  );
}
