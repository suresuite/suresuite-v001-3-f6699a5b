import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import type { Edge } from "@xyflow/react";
import { cn } from "@/lib/utils";
import { DIALOG_AS_SHEET } from "@/components/shared";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  PLANT_TARGET,
  addBlockedReason,
  effectLabel,
  judgeTarget,
  newEvent,
  supplierTarget,
  targetChoices,
  type ScheduleEvent,
} from "@/lib/sim/disruptionEvents";
import { scheduleFindings } from "../../../supabase/functions/_shared/disruptionRules";
import { EffectControl } from "@/components/sim/DisruptionScheduleEditor";
import { WeeksInput } from "@/components/sim/WeeksInput";

/**
 * "Add disruption" on the Firm-, Product- and Process-level pages (WP 9.4 slice 7).
 *
 * It writes ONE thing: an event in `scenarios.disruption_schedule`, built by the
 * same module as the Lab's editor and checked by the same rule as the sim-command
 * gate — so a node picked on a map lands as exactly the event the engine runs, or
 * the dialog says, before anything is written, why it would not. It no longer
 * writes `create_disruption_scenario_v2`'s four tables, which no run reads (§4 D48,
 * D226; a §16 decision).
 *
 * A node the engine cannot disrupt (anything but a supplier of this project or the
 * plant) is shown with the reason, and its connected suppliers are offered instead.
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
      <DialogContent className={cn(DIALOG_AS_SHEET, "sm:max-w-lg md:max-w-lg")}>
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
  const { selectedVersionId: policyVersionId, isDirty } = usePolicies(projectId);
  const { suppliers } = useItemMasters(projectId);
  const cred = useModelValidation(projectId);
  const validated = useValidatedBaseline({ scenarios, cred, policyVersionId, dirty: isDirty });

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
    ? "Pick a supplier or the plant — the engine cannot disrupt this node."
    : judgeTarget(target, supplierIds).reason ??
      capReason ??
      (dest === "existing" && !existing ? "Pick a scenario to add this disruption to." : null) ??
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
        // Born in the validated world, so it can inherit the validation (§4 D217).
        if (saved) void cred.applyIfValidated(saved, policyVersionId, { dirty: isDirty });
      } else if (existing) {
        await update(existing.id, { disruption_schedule: [...(existing.disruption_schedule ?? []), ev] });
        saved = existing;
      }
      if (!saved) return;
      const id = saved.id;
      toast.success(`${effectLabel(ev.magnitude_pct)} of ${target} added to "${saved.name}"`, {
        action: {
          label: "Open in Simulation Lab",
          onClick: () => navigate(`/simulation-lab?scenario_id=${id}&pane=recovery`),
        },
      });
      onSuccess?.();
      onOpenChange(false);
    } catch (e) {
      toast.error(`Could not save the disruption: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const choices = targetChoices(supplierIds);

  return (
    <>
      <DialogHeader>
        <DialogTitle className="text-base">Add disruption</DialogTitle>
        <DialogDescription>
          {nodeId ? <>Selected: <span className="font-medium text-foreground">{nodeId}</span></> : "No node selected"}
        </DialogDescription>
      </DialogHeader>

      <div className="flex flex-col gap-4 text-[12.5px]">
        {nodeJudged.reason ? (
          <div className="rounded-sm border border-[rgba(191,35,48,0.35)] bg-[rgba(191,35,48,0.05)] px-3 py-2">
            <p className="text-[#b3261e]">{nodeJudged.reason}</p>
            {neighbours.length > 0 ? (
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <span className="text-[#52525b]">Connected suppliers:</span>
                {neighbours.map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setTarget(supplierTarget(n))}
                    className="min-h-11 rounded-sm border border-[--hair-rule] px-2 py-0.5 hover:border-foreground md:min-h-0"
                  >
                    {n}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        <Row label="Target">
          <select
            aria-label="Disruption target"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            className="h-9 min-h-11 w-full rounded-sm border border-input bg-background px-2 text-sm md:min-h-0"
          >
            <option value="">Pick a supplier or the plant</option>
            {choices.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </Row>

        <Row label="Effect">
          <EffectControl value={ev.magnitude_pct} onChange={(v) => setEvent((e) => ({ ...e, magnitude_pct: v }))} />
        </Row>

        <Row label="When">
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-[#52525b]">week</span>
            <WeeksInput
              ariaLabel="Start week"
              days={ev.start_day}
              min={DISRUPTION_RULE.start_week_min}
              onDays={(d) => setEvent((e) => ({ ...e, start_day: d }))}
            />
            <span className="text-[#52525b]">for</span>
            <WeeksInput
              ariaLabel="Duration in weeks"
              days={ev.duration_days}
              min={DISRUPTION_RULE.duration_weeks_min}
              max={DISRUPTION_RULE.duration_weeks_max}
              onDays={(d) => setEvent((e) => ({ ...e, duration_days: d }))}
            />
            <span className="text-[#52525b]">weeks</span>
          </span>
          {calendar ? <p className="mt-1 text-[11.5px] text-[#71717a]">{calendar}</p> : null}
        </Row>

        <Row label="Add to">
          <div className="flex flex-col gap-2">
            <label className="flex min-h-11 items-center gap-2 md:min-h-0">
              <input type="radio" checked={dest === "new"} onChange={() => setDest("new")} />
              New scenario
              {validated.world.source === "validation" ? (
                <span className="text-[#0e7f88]">from the validated baseline</span>
              ) : null}
            </label>
            {dest === "new" ? (
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                aria-label="New scenario name"
                className="h-9 min-h-11 md:min-h-0"
              />
            ) : null}
            <label className="flex min-h-11 items-center gap-2 md:min-h-0">
              <input
                type="radio"
                checked={dest === "existing"}
                disabled={experiments.length === 0}
                onChange={() => setDest("existing")}
              />
              Existing scenario
            </label>
            {dest === "existing" ? (
              <select
                aria-label="Scenario to add to"
                value={existingId}
                onChange={(e) => setExistingId(e.target.value)}
                className="h-9 min-h-11 w-full rounded-sm border border-input bg-background px-2 text-sm md:min-h-0"
              >
                <option value="">Pick a scenario</option>
                {experiments.map((s) => {
                  const full = !!addBlockedReason(s.disruption_schedule ?? []);
                  return (
                    <option key={s.id} value={s.id} disabled={full}>
                      {s.name} · {(s.disruption_schedule ?? []).length} events
                      {full ? " (full)" : ""}
                    </option>
                  );
                })}
              </select>
            ) : null}
          </div>
        </Row>

        {findings.length > 0 ? (
          <ul className="flex flex-col gap-1 rounded-sm border border-[rgba(224,147,11,0.4)] bg-[rgba(224,147,11,0.06)] px-3 py-2 text-[12px] text-[#9a6206]">
            {findings.map((f, i) => (
              <li key={i}>{f.message}</li>
            ))}
          </ul>
        ) : null}
      </div>

      <DialogFooter className="items-center gap-2">
        {blocker ? <span className="mr-auto text-[12px] text-[#71717a]">{blocker}</span> : null}
        <Button variant="outline" onClick={() => onOpenChange(false)} className="min-h-11 md:min-h-0">
          Cancel
        </Button>
        <Button onClick={() => void submit()} disabled={!!blocker || busy} className="min-h-11 md:min-h-0">
          {busy ? "Saving…" : "Add disruption"}
        </Button>
      </DialogFooter>
    </>
  );
}

/**
 * "≈ 12 Jan 2027" for a run week, when the project states a simulation start.
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
  return `Run week ${engineWeeks(startDay)} ≈ ${d.toLocaleDateString()}, counting week 1 from the project's simulation start.`;
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-1.5 md:grid-cols-[88px_minmax(0,1fr)] md:items-start md:gap-3">
      <span className="pt-1.5 text-[12px] font-medium text-[#52525b]">{label}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
