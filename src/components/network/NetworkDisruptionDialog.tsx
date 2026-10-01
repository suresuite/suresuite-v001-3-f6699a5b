import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import type { Edge } from "@xyflow/react";
import { cn } from "@/lib/utils";
import { DIALOG_AS_SHEET } from "@/components/shared";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useScenarios, type Scenario } from "@/hooks/useScenarios";
import { usePolicies } from "@/hooks/usePolicies";
import { useItemMasters } from "@/hooks/useItemMasters";
import { useModelValidation } from "@/hooks/useModelValidation";
import { useValidatedBaseline } from "@/hooks/useValidatedBaseline";
import { buildScenarioSeed, uniqueName } from "@/lib/sim/scenarioSeed";
import { isValidationBaseline } from "@/lib/sim/validationBaseline";
import { engineWeeks } from "@/lib/sim/planningTime";
import {
  DISRUPTION_RULE,
  DISRUPTION_TERMS,
  PLANT_TARGET,
  addBlockedReason,
  describeEvent,
  effectMeaning,
  isLeadTimeDelay,
  judgeTarget,
  newEvent,
  supplierTarget,
  targetChoices,
  type ScheduleEvent,
} from "@/lib/sim/disruptionEvents";
import { scheduleFindings } from "../../../supabase/functions/_shared/disruptionRules";
import {
  CapacityLostStepper,
  EffectControl,
  FIELD_BOX,
  FIELD_H,
  Field,
  Segmented,
  TargetSelect,
  WeeksStepper,
  durationHint,
  hintOf,
  startHint,
} from "@/components/sim/DisruptionFields";

/**
 * "Add disruption event" on the Firm-, Product- and Process-level pages (WP 9.4 slice 7).
 *
 * It writes ONE thing: an event in `scenarios.disruption_schedule`, built by the
 * same module as the Lab's editor and checked by the same rule as the sim-command
 * gate — so a node picked on a map lands as exactly the event the engine runs, or
 * the dialog says, before anything is written, why it would not. It no longer
 * writes `create_disruption_scenario_v2`'s four tables, which no run reads (§4 D48,
 * D228; a §16 decision).
 *
 * A node the engine cannot disrupt (anything but a supplier of this project or the
 * plant) is shown with the reason, and its connected suppliers are offered instead.
 * Every label is `DISRUPTION_TERMS`, the engine's own words, shared with the Lab.
 */
export function NetworkDisruptionDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  nodeId: string | null;
  projectId: string | null;
  /** the project's plant name, so the plant node maps to the engine's `plant` */
  plantName?: string | null;
  connectedEdges: Edge[];
  onSuccess?: () => void;
}) {
  // The data hooks load only while the dialog is open.
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className={cn(DIALOG_AS_SHEET, "sm:max-w-xl md:max-w-xl")}>
        {props.open && props.projectId ? <Body {...props} projectId={props.projectId} /> : null}
      </DialogContent>
    </Dialog>
  );
}

type Dest = "new" | "existing";

function Body({
  onOpenChange,
  nodeId,
  projectId,
  plantName,
  connectedEdges,
  onSuccess,
}: {
  onOpenChange: (open: boolean) => void;
  nodeId: string | null;
  projectId: string;
  plantName?: string | null;
  connectedEdges: Edge[];
  onSuccess?: () => void;
}) {
  const navigate = useNavigate();
  const { scenarios, create, update } = useScenarios(projectId);
  const { currentHash: policyHash } = usePolicies(projectId);
  const { suppliers } = useItemMasters(projectId);
  const cred = useModelValidation(projectId);
  const validated = useValidatedBaseline({ scenarios, cred, policyHash });

  const supplierIds = useMemo(() => suppliers.map((s) => s.supplier_id).filter(Boolean), [suppliers]);

  // The selected node, as the engine would name it.
  const nodeTarget = useMemo(() => {
    const id = nodeId ?? "";
    if (!id) return "";
    if (plantName && id.trim().toLowerCase() === plantName.trim().toLowerCase()) return PLANT_TARGET;
    if (supplierIds.includes(id)) return supplierTarget(id);
    return id;
  }, [nodeId, plantName, supplierIds]);
  const nodeJudged = judgeTarget(nodeTarget, supplierIds);
  const neighbours = useMemo(() => {
    const ids = new Set<string>();
    for (const e of connectedEdges) for (const n of [e.source, e.target]) if (supplierIds.includes(n)) ids.add(n);
    return [...ids].filter((n) => n !== nodeId).sort();
  }, [connectedEdges, supplierIds, nodeId]);

  const [target, setTarget] = useState("");
  const [event, setEvent] = useState<ScheduleEvent>(() => newEvent(""));
  const [dest, setDest] = useState<Dest>("new");
  const [existingId, setExistingId] = useState<string>("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  // Seed the form once the project's data has arrived.
  useEffect(() => {
    setTarget(nodeJudged.reason ? "" : nodeTarget);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeTarget, nodeJudged.reason]);
  useEffect(() => {
    setEvent((e) => ({ ...newEvent(e.target, validated.baseline?.warmup_days), target: e.target }));
  }, [validated.baseline?.warmup_days]);
  useEffect(() => {
    const label = nodeId || "node";
    setName(uniqueName(`${label} disruption`, scenarios.map((s) => s.name)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeId, scenarios.length]);

  const ev: ScheduleEvent = { ...event, target };
  const experiments = scenarios.filter((s) => !isValidationBaseline(s));
  const existing = experiments.find((s) => s.id === existingId) ?? null;
  const schedule = dest === "existing" && existing ? [...(existing.disruption_schedule ?? []), ev] : [ev];
  const findings = target
    ? scheduleFindings(
        suppliers as unknown as Record<string, unknown>[],
        schedule as unknown as Record<string, unknown>[],
        DISRUPTION_RULE,
      )
    : [];
  const capReason = dest === "existing" && existing ? addBlockedReason(existing.disruption_schedule ?? []) : null;
  const blocker = !target
    ? "Choose the node to disrupt: the plant or one of this project's suppliers."
    : judgeTarget(target, supplierIds).reason ??
      capReason ??
      (dest === "existing" && !existing ? "Choose the scenario that receives this event." : null) ??
      (dest === "new" && !name.trim() ? "Name the new scenario." : null);

  const calendar = useCalendarHint(projectId, ev.start_day);

  const submit = async () => {
    if (blocker) return;
    setBusy(true);
    try {
      let saved: Scenario | null = null;
      if (dest === "new") {
        saved = await create(
          name.trim(),
          buildScenarioSeed({
            name: name.trim(),
            world: validated.world,
            baseline: validated.baseline,
            disruption_schedule: [ev],
            from_network: true,
          }),
        );
        // Born in the validated world, so it can inherit the validation (§4 D219).
        if (saved) void cred.applyIfValidated(saved, policyHash);
      } else if (existing) {
        await update(existing.id, { disruption_schedule: [...(existing.disruption_schedule ?? []), ev] });
        saved = existing;
      }
      if (!saved) return;
      const id = saved.id;
      toast.success(`Disruption event added to "${saved.name}": ${describeEvent(ev)}`, {
        action: {
          label: "Open in Simulation Lab",
          onClick: () => navigate(`/simulation-lab?scenario_id=${id}&pane=recovery`),
        },
      });
      onSuccess?.();
      onOpenChange(false);
    } catch (e) {
      toast.error(`Could not save the disruption event: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const choices = targetChoices(supplierIds);
  const selectedKind = nodeJudged.reason ? "Cannot be disrupted" : nodeTarget === PLANT_TARGET ? "Plant" : nodeTarget ? "Supplier" : null;
  const destName = dest === "new" ? name.trim() : existing?.name;
  const horizonWeeks = validated.world.horizon_days ? engineWeeks(validated.world.horizon_days) : undefined;

  return (
    <>
      <DialogHeader>
        <DialogTitle className="text-base">Add disruption event</DialogTitle>
        <DialogDescription>
          Choose what fails, how hard, when and for how long. The event is saved to a scenario's
          disruption schedule, which the Simulation Lab runs.
        </DialogDescription>
      </DialogHeader>

      <div className="flex flex-col gap-4 text-[12.5px]">
        <div
          className={cn(
            "rounded-sm border px-3 py-2",
            nodeJudged.reason
              ? "border-[rgba(191,35,48,0.35)] bg-[rgba(191,35,48,0.05)]"
              : "border-[--hair-rule] bg-[#fafafa]",
          )}
        >
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="text-[12px] text-[#52525b]">Selected on the map</span>
            <span className="font-medium text-foreground">{nodeId || "No node selected"}</span>
            {nodeId && selectedKind ? (
              <span
                className={cn(
                  "rounded-sm border px-1.5 text-[11px]",
                  nodeJudged.reason ? "border-[rgba(191,35,48,0.35)] text-[#b3261e]" : "border-[--hair-rule] text-[#52525b]",
                )}
              >
                {selectedKind}
              </span>
            ) : null}
          </div>
          {nodeJudged.reason ? <p className="mt-1 text-[#b3261e]">{nodeJudged.reason}</p> : null}
          {nodeJudged.reason && neighbours.length > 0 ? (
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <span className="text-[#52525b]">Disrupt a connected supplier instead:</span>
              {neighbours.map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setTarget(supplierTarget(n))}
                  aria-pressed={target === supplierTarget(n)}
                  className={cn(
                    "rounded-sm border px-3 text-[12.5px]",
                    FIELD_H,
                    target === supplierTarget(n)
                      ? "border-foreground bg-foreground text-background"
                      : "border-[--hair-rule] bg-background hover:border-foreground",
                  )}
                >
                  {n}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <Field label={DISRUPTION_TERMS.target} htmlFor="disruption-node">
          <TargetSelect
            id="disruption-node"
            value={target}
            choices={choices}
            onChange={setTarget}
            placeholder="Choose the plant or a supplier"
          />
        </Field>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-[minmax(0,1fr)_168px]">
          <Field
            label={DISRUPTION_TERMS.effect}
            hint={isLeadTimeDelay(ev.magnitude_pct) ? effectMeaning(ev.magnitude_pct) : undefined}
          >
            <EffectControl value={ev.magnitude_pct} onChange={(v) => setEvent((e) => ({ ...e, magnitude_pct: v }))} />
          </Field>
          {!isLeadTimeDelay(ev.magnitude_pct) ? (
            <Field label="Capacity lost" htmlFor="disruption-share" hint={effectMeaning(ev.magnitude_pct)}>
              <CapacityLostStepper
                id="disruption-share"
                value={ev.magnitude_pct}
                onChange={(v) => setEvent((e) => ({ ...e, magnitude_pct: v }))}
              />
            </Field>
          ) : null}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Field label={DISRUPTION_TERMS.startTime} htmlFor="disruption-start" hint={startHint(horizonWeeks)}>
            <WeeksStepper
              id="disruption-start"
              ariaLabel="Disruption event start time"
              kind="point"
              days={ev.start_day}
              min={DISRUPTION_RULE.start_week_min}
              max={horizonWeeks}
              onDays={(d) => setEvent((e) => ({ ...e, start_day: d }))}
            />
          </Field>
          <Field
            label={DISRUPTION_TERMS.duration}
            htmlFor="disruption-duration"
            {...hintOf(durationHint(ev.start_day, ev.duration_days, horizonWeeks))}
          >
            <WeeksStepper
              id="disruption-duration"
              ariaLabel="Disruption event duration"
              days={ev.duration_days}
              min={DISRUPTION_RULE.duration_weeks_min}
              max={DISRUPTION_RULE.duration_weeks_max}
              onDays={(d) => setEvent((e) => ({ ...e, duration_days: d }))}
            />
          </Field>
        </div>

        <Field
          label="Save to"
          hint={dest === "new" && validated.world.source === "validation" ? "The new scenario starts from the validated baseline." : undefined}
        >
          <Segmented<Dest>
            className="w-full md:w-auto md:self-start"
            ariaLabel="Save to"
            value={dest}
            onChange={setDest}
            options={[
              { value: "new", label: "New scenario" },
              { value: "existing", label: "Existing scenario", disabled: experiments.length === 0 },
            ]}
          />
          {dest === "new" ? (
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              aria-label="New scenario name"
              placeholder="Scenario name"
              className={cn("w-full px-2.5 outline-none", FIELD_H, FIELD_BOX)}
            />
          ) : (
            <select
              aria-label="Scenario that receives the event"
              value={existingId}
              onChange={(e) => setExistingId(e.target.value)}
              className={cn("w-full px-2.5 outline-none", FIELD_H, FIELD_BOX, !existingId && "text-[#71717a]")}
            >
              <option value="">Choose a scenario</option>
              {experiments.map((s) => {
                const n = (s.disruption_schedule ?? []).length;
                const full = !!addBlockedReason(s.disruption_schedule ?? []);
                return (
                  <option key={s.id} value={s.id} disabled={full}>
                    {s.name} · {n} of {DISRUPTION_RULE.event_cap} events
                    {full ? " (full)" : ""}
                  </option>
                );
              })}
            </select>
          )}
        </Field>

        {findings.length > 0 ? (
          <ul className="flex flex-col gap-1 rounded-sm border border-[rgba(224,147,11,0.4)] bg-[rgba(224,147,11,0.06)] px-3 py-2 text-[12px] text-[#9a6206]">
            {findings.map((f, i) => (
              <li key={i}>{f.message}</li>
            ))}
          </ul>
        ) : null}

        <div aria-live="polite" className="rounded-sm border border-[--hair-rule] border-l-2 border-l-foreground bg-[#fafafa] px-3 py-2.5">
          {blocker ? (
            <p className="text-[#71717a]">{blocker}</p>
          ) : (
            <>
              <p className="font-medium text-foreground">{describeEvent(ev)}</p>
              <p className="mt-0.5 text-[#52525b]">
                {calendar ? <>Starts ≈ {calendar} · </> : null}
                {destName ? <>saved to {dest === "new" ? "new scenario" : "scenario"} “{destName}”</> : null}
              </p>
            </>
          )}
        </div>
      </div>

      <DialogFooter className="gap-2">
        <Button variant="outline" onClick={() => onOpenChange(false)} className={cn(FIELD_H, "px-4")}>
          Cancel
        </Button>
        <Button onClick={() => void submit()} disabled={!!blocker || busy} className={cn(FIELD_H, "px-4")}>
          {busy ? "Saving…" : dest === "new" ? "Create scenario with event" : "Add event to scenario"}
        </Button>
      </DialogFooter>
    </>
  );
}

/**
 * "12 Jan 2027" for a simulation week, when the project states a simulation start.
 * A display aid only: the engine counts weeks from the run's week 1, not from a
 * calendar date, so the date is labelled approximate and never stored.
 */
function useCalendarHint(projectId: string, startDay: number): string | null {
  const [start, setStart] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    // The generated client types predate `simulation_start` (as for `scenarios`).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    void (supabase as any)
      .from("projects")
      .select("simulation_start")
      .eq("id", projectId)
      .maybeSingle()
      .then(({ data }: { data: unknown }) => {
        if (live) setStart((data as { simulation_start?: string | null } | null)?.simulation_start ?? null);
      });
    return () => {
      live = false;
    };
  }, [projectId]);
  if (!start) return null;
  const d = new Date(start);
  if (Number.isNaN(d.getTime())) return null;
  d.setDate(d.getDate() + (engineWeeks(startDay) - 1) * 7);
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}
