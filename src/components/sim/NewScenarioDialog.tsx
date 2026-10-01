import { useEffect, useMemo, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { DIALOG_AS_SHEET } from "@/components/shared";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FIELD_BOX, FIELD_H, WeeksStepper, choiceChip } from "./DisruptionFields";
import { KPI_OPTIONS } from "./ScenarioSetupForm";
import { STRESS_TESTS, scheduleLine } from "./StressTestCard";
import { stressPresetUnavailableReason } from "@/lib/sim/stressTargets";
import { HORIZON_WEEKS, formatDuration } from "@/lib/sim/planningTime";
import type { SeedWorld } from "@/lib/sim/scenarioSeed";
import type { ModelValidationCard } from "@/hooks/useModelValidation";
import { SCENARIO_ENGINE_DEFAULTS } from "@/hooks/useScenarios";

export type NewScenarioStart = "baseline" | "defaults" | "stress";

export interface NewScenarioRequest {
  name: string;
  start: NewScenarioStart;
  primary_kpi: string;
  /** set only when the user unlocked and changed the horizon */
  horizon_days?: number;
  /** STRESS_TESTS id, when start = "stress" */
  presetId?: string;
}

/**
 * "+" opens this instead of creating "Scenario N" on the spot (WP 9.4 slice 5).
 *
 * Four decisions, one screen: a name, where to start, how long, what to watch.
 * Starting from the validated baseline is the default, and it keeps the
 * baseline's world LOCKED — the horizon is part of what the validation
 * certified, so changing it is allowed but stated: the new scenario will read
 * stale. Warm-up and replications are shown, not asked: they arrive from the
 * validation after the row exists.
 */
export function NewScenarioDialog({
  open,
  onOpenChange,
  defaultName,
  initialStart = "baseline",
  hasBaseline,
  world,
  card,
  onCreate,
  onBrowseLibrary,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  defaultName: string;
  initialStart?: NewScenarioStart;
  /** the project has a validated baseline or a card to start from */
  hasBaseline: boolean;
  world: SeedWorld;
  card: ModelValidationCard | null;
  onCreate: (req: NewScenarioRequest) => Promise<void> | void;
  onBrowseLibrary: () => void;
}) {
  const [name, setName] = useState(defaultName);
  const [start, setStart] = useState<NewScenarioStart>(hasBaseline ? initialStart : "defaults");
  const [kpi, setKpi] = useState("fill_rate");
  const [unlocked, setUnlocked] = useState(false);
  const [horizon, setHorizon] = useState(world.horizon_days);
  const [presetId, setPresetId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(defaultName);
    setStart(hasBaseline ? initialStart : "defaults");
    setKpi("fill_rate");
    setUnlocked(false);
    setHorizon(world.horizon_days);
    setPresetId(null);
    // Reset on open only — the world arriving later must not wipe a typed name.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const locked = start !== "defaults" && hasBaseline && !unlocked;
  const presets = useMemo(
    () => STRESS_TESTS.map((t) => ({ t, reason: stressPresetUnavailableReason(t.id) })),
    [],
  );
  const canCreate = name.trim().length > 0 && (start !== "stress" || !!presetId) && !busy;

  const submit = async () => {
    if (!canCreate) return;
    setBusy(true);
    try {
      await onCreate({
        name: name.trim(),
        start,
        primary_kpi: kpi,
        horizon_days: !locked && horizon !== world.horizon_days ? horizon : undefined,
        presetId: start === "stress" ? (presetId ?? undefined) : undefined,
      });
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  };

  const startOptions: { value: NewScenarioStart; label: string; disabled?: string }[] = [
    { value: "baseline", label: "Validated baseline", disabled: hasBaseline ? undefined : "No validated baseline yet — run Run & Validate in Policies." },
    { value: "stress", label: "Stress test", disabled: hasBaseline ? undefined : "Stress tests start from the validated baseline." },
    { value: "defaults", label: "Engine defaults" },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cn(DIALOG_AS_SHEET, "sm:max-w-lg md:max-w-lg")}>
        <DialogHeader>
          <DialogTitle className="text-base">New scenario</DialogTitle>
          <DialogDescription>Start from the model you validated, then change one thing.</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 text-[12.5px]">
          <Row label="Name">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              aria-label="Scenario name"
              className={cn("w-full px-2.5 outline-none", FIELD_H, FIELD_BOX)}
              autoFocus
            />
          </Row>

          <Row label="Start from">
            <div className="flex flex-wrap gap-1.5">
              {startOptions.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  disabled={!!o.disabled}
                  title={o.disabled}
                  onClick={() => setStart(o.value)}
                  className={choiceChip(start === o.value, !!o.disabled)}
                >
                  {o.label}
                </button>
              ))}
              <button
                type="button"
                onClick={() => {
                  onOpenChange(false);
                  onBrowseLibrary();
                }}
                className={cn("px-2 text-[12.5px] text-[#52525b] underline-offset-2 hover:text-foreground hover:underline", FIELD_H)}
              >
                Library ›
              </button>
            </div>
          </Row>

          {start === "stress" ? (
            <Row label="Stress test">
              <div className="max-h-56 overflow-y-auto rounded-sm border border-input">
                {presets.map(({ t, reason }) => (
                  <button
                    key={t.id}
                    type="button"
                    disabled={reason !== null}
                    title={reason ?? undefined}
                    onClick={() => {
                      setPresetId(t.id);
                      if (!name.trim() || name === defaultName) setName(t.scenario.name);
                    }}
                    className={cn(
                      "flex w-full min-h-11 flex-col gap-0.5 border-b border-[--sim-divider] px-3 py-2 text-left last:border-b-0",
                      presetId === t.id ? "bg-[#f4f4f5]" : "hover:bg-[#fafafa]",
                      reason !== null && "cursor-not-allowed opacity-50",
                    )}
                  >
                    <span className={cn(presetId === t.id && "font-medium")}>{t.label}</span>
                    <span className="text-[11px] tabular-nums text-[#71717a]">{scheduleLine(t.scenario)}</span>
                  </button>
                ))}
              </div>
            </Row>
          ) : null}

          <Row label="Horizon">
            <div className="flex flex-wrap items-center gap-2">
              <div className="w-[168px]">
                <WeeksStepper
                  ariaLabel="Horizon"
                  days={locked ? world.horizon_days : horizon}
                  min={HORIZON_WEEKS.min}
                  max={HORIZON_WEEKS.max}
                  disabled={locked}
                  onDays={setHorizon}
                />
              </div>
              {locked ? (
                <button
                  type="button"
                  onClick={() => setUnlocked(true)}
                  className={cn("text-[12.5px] text-[#52525b] underline-offset-2 hover:text-foreground hover:underline", FIELD_H)}
                >
                  change
                </button>
              ) : null}
            </div>
            {unlocked && hasBaseline && start !== "defaults" ? (
              <p className="mt-1 text-[11.5px] text-[#9a6206]">
                A different horizon is a different world: this scenario will not inherit the
                validation and its badge will read stale.
              </p>
            ) : null}
          </Row>

          <Row label="Primary KPI">
            <div className="flex flex-wrap gap-1.5">
              {KPI_OPTIONS.map((k) => (
                <button
                  key={k.value}
                  type="button"
                  onClick={() => setKpi(k.value)}
                  className={choiceChip(kpi === k.value)}
                >
                  {k.label}
                </button>
              ))}
            </div>
          </Row>

          <Row label="Warm-up · reps">
            <span className="block tabular-nums text-[#3f3f46] md:pt-[10px]">
              {card && start !== "defaults" && !unlocked
                ? `${formatDuration(card.adopted_warmup_days)} · ${card.recommended_replications} reps — from the validation`
                : `detected at run time · ${SCENARIO_ENGINE_DEFAULTS.replications} reps — engine defaults`}
            </span>
          </Row>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} className={cn(FIELD_H, "px-4")}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={!canCreate} className={cn(FIELD_H, "px-4")}>
            {busy ? "Creating…" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-1.5 md:grid-cols-[120px_minmax(0,1fr)] md:items-start md:gap-3">
      <span className="text-[12px] font-medium leading-4 text-[#3f3f46] md:pt-[10px]">{label}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
