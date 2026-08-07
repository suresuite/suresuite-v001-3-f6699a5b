/**
 * Model setup bar for /policies — rows A (model version) and B (planning unit)
 * plus the 4-step guardrail track.
 *
 * Drop at: src/components/policies/PolicySetupBar.tsx
 * Renders inside <ProjectPolicies> directly under <PageHeader>, replacing the old
 * PolicyVersionBar + TimeUnitBar + StageRail trio.
 */
import React from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { SURFACE, KX_TIGHT, LAYER, Segmented, MonoChip } from "@/components/intelligence/piUi";

export type StageId = "supplier" | "plant" | "customer" | "run_validate";
export type PlanningUnit = "day" | "week" | "month";

export interface StageGuard {
  id: StageId;
  title: string;
  /** lines in the stage (0 for run_validate) */
  total: number;
  /** lines still needing input; for run_validate, lines blocking the run */
  needs: number;
  /** run_validate only: evidence (reps + warm-up) is complete */
  evidence?: boolean;
}

const LABEL_COL = "w-[196px] shrink-0";

function Badge({ children, tone }: { children: React.ReactNode; tone: "solid" | "muted" }) {
  return (
    <span
      className={cn(
        "grid h-4 w-4 shrink-0 place-items-center rounded-sm font-mono text-[9px] leading-none",
        tone === "solid" ? "bg-foreground text-background" : "bg-[#f4f4f4] text-muted-foreground",
      )}
    >
      {children}
    </span>
  );
}

function StepCard({
  stage,
  index,
  active,
  ready,
  onSelect,
}: {
  stage: StageGuard;
  index: number;
  active: boolean;
  ready: boolean;
  onSelect: () => void;
}) {
  const last = stage.id === "run_validate";
  const meta = last
    ? stage.needs
      ? `${stage.needs} line${stage.needs === 1 ? "" : "s"} block the run`
      : stage.evidence
        ? "evidence complete"
        : "5 steps"
    : stage.needs
      ? `${stage.total} lines · ${stage.needs} need input`
      : `${stage.total} lines resolved`;

  const badgeStyle: React.CSSProperties = active
    ? { background: "#ffffff", color: "#111111" }
    : ready
      ? { background: LAYER.process, color: "#ffffff" }
      : stage.needs
        ? { background: LAYER.brand, color: "#ffffff" }
        : { background: "#f4f4f4", color: "#8a8a8a" };

  return (
    <button
      type="button"
      onClick={onSelect}
      title={
        last
          ? stage.needs
            ? `Resolve ${stage.needs} line(s) in steps 1–3 before the run is credible`
            : "Verification · Run simulation · Warm-up detection · Validation · Adopt"
          : stage.needs
            ? `${stage.needs} line(s) still need input in this step`
            : `All ${stage.total} lines resolved`
      }
      className={cn(
        "relative flex flex-[0_1_auto] items-center gap-[9px] rounded-sm border px-[10px] py-1.5 pr-3 text-left transition-colors",
        active
          ? "border-foreground bg-foreground text-background"
          : "border-[#ebebeb] bg-background shadow-[0_1px_0_rgba(0,0,0,0.04)] hover:border-foreground hover:bg-[#fafafa]",
      )}
    >
      <span
        className="grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full font-mono text-[10px] font-medium"
        style={badgeStyle}
      >
        {ready && !active ? "✓" : index + 1}
      </span>
      <span className="flex min-w-0 flex-col items-start gap-px">
        <span className="flex items-center gap-1.5 whitespace-nowrap text-[12.5px] font-medium tracking-[-0.01em]">
          {stage.title}
          {last && stage.needs > 0 && !active && <MonoChip>LOCKED</MonoChip>}
        </span>
        <span
          className="whitespace-nowrap font-mono text-[10px]"
          style={{
            color: active ? "rgba(255,255,255,0.62)" : stage.needs ? LAYER.brand : "#8a8a8a",
          }}
        >
          {meta}
        </span>
      </span>
    </button>
  );
}

export function PolicySetupBar({
  versionName,
  isSnapshot,
  versionStamp,
  versionCount,
  dirty,
  onSaveVersion,
  onOpenHistory,
  unit,
  onUnitChange,
  horizon,
  unitMap,
  stages,
  activeStage,
  onStageChange,
}: {
  versionName: string;
  isSnapshot: boolean;
  /** e.g. "Aug 3, 10:14 · m.langner" */
  versionStamp?: string;
  versionCount: number;
  dirty: boolean;
  onSaveVersion: () => void;
  onOpenHistory: () => void;
  unit: PlanningUnit;
  onUnitChange: (u: PlanningUnit) => void;
  /** e.g. "365 days · 52.1 weeks" */
  horizon: string;
  /** e.g. "Week 1 = Jan 6, 2025 → Jan 12, 2025 (7 days each)" */
  unitMap: string;
  stages: StageGuard[];
  activeStage: StageId;
  onStageChange: (s: StageId) => void;
}) {
  const setupStages = stages.filter((s) => s.id !== "run_validate");
  const runStage = stages.find((s) => s.id === "run_validate");
  const blocking = setupStages.reduce((a, s) => a + s.needs, 0);
  const readyOf = (s: StageGuard) =>
    s.id === "run_validate" ? blocking === 0 && !!s.evidence : s.needs === 0;
  const readyCount = stages.filter(readyOf).length;

  return (
    <div className={cn(SURFACE, "mb-[14px]")}>
      {/* caption */}
      <div className="flex items-center gap-2.5 border-b border-[#ebebeb] bg-[#fafafa] px-2.5 py-[5px]">
        <span className={cn(KX_TIGHT, "whitespace-nowrap font-medium text-foreground")}>Model setup</span>
        <span className="whitespace-nowrap font-mono text-[10.5px] text-muted-foreground">
          set A and B, then work steps 1–4
        </span>
      </div>

      {/* A — model version */}
      <div className="flex items-center gap-2.5 border-b border-[#ebebeb] px-2.5 py-1.5">
        <span className={cn(LABEL_COL, "flex items-center gap-[7px]")}>
          <Badge tone="solid">A</Badge>
          <span className={cn(KX_TIGHT, "whitespace-nowrap")}>Model version</span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          <span className="whitespace-nowrap text-[12.5px] font-medium">{versionName}</span>
          <MonoChip>{isSnapshot ? "Snapshot" : "Live"}</MonoChip>
          {versionStamp && (
            <span className="whitespace-nowrap font-mono text-[11px] text-muted-foreground">{versionStamp}</span>
          )}
        </span>
        {dirty && (
          <span className="inline-flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: LAYER.firm }} />
            <span className="font-mono text-[11px]" style={{ color: LAYER.firm }}>
              unsaved changes
            </span>
          </span>
        )}
        <div className="flex-1" />
        <Button size="sm" className="h-[26px] px-2.5 text-[11.5px]" onClick={onSaveVersion}>
          Save model version
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-[26px] px-2.5 text-[11.5px]"
          onClick={onOpenHistory}
        >
          History <span className="ml-1 font-mono text-[10px] text-muted-foreground">{versionCount}</span>
        </Button>
      </div>

      {/* B — planning unit */}
      <div className="flex items-center gap-2.5 px-2.5 py-1.5">
        <span className={cn(LABEL_COL, "flex items-center gap-[7px]")}>
          <Badge tone="solid">B</Badge>
          <span className={cn(KX_TIGHT, "whitespace-nowrap")}>Planning unit</span>
        </span>
        <Segmented<PlanningUnit>
          size="sm"
          value={unit}
          onChange={onUnitChange}
          options={[
            { value: "day", label: "day" },
            { value: "week", label: "week" },
            { value: "month", label: "month" },
          ]}
        />
        <div className="flex-1" />
        <span className="flex shrink-0 items-center gap-2.5">
          <span className="whitespace-nowrap font-mono text-[11px] text-muted-foreground">
            Horizon <b className="font-medium text-foreground">{horizon}</b>
          </span>
          <span className="text-[#dcdcdc]">·</span>
          <span className="whitespace-nowrap font-mono text-[11px] text-muted-foreground">{unitMap}</span>
        </span>
      </div>

      {/* steps */}
      <div className="flex items-stretch gap-[18px] border-t border-[#ebebeb] bg-[#f4f4f4] p-1.5">
        <div className="flex w-[192px] shrink-0 flex-col justify-center gap-0.5 py-px pl-1 pr-2.5">
          <span className={cn(KX_TIGHT, "whitespace-nowrap")}>Configure SC policies</span>
          <span className="whitespace-nowrap font-mono text-[10.5px] text-muted-foreground">
            steps 1–3, then run
          </span>
          <span className="flex items-center gap-1.5">
            <span className="font-mono text-[11px]">
              <b className="font-medium">{readyCount}</b>
              <span className="text-muted-foreground"> / {stages.length} ready</span>
            </span>
            <span className="flex gap-[3px]">
              {stages.map((s) => (
                <span
                  key={s.id}
                  className="h-[3px] w-[18px] rounded-full"
                  style={{
                    background: readyOf(s) ? LAYER.process : s.needs ? LAYER.brand : "#dcdcdc",
                  }}
                />
              ))}
            </span>
          </span>
        </div>

        {stages.map((stage, i) => {
          const prev = i > 0 ? stages[i - 1] : null;
          const prevBlocked = !!prev && (prev.id === "run_validate" ? false : prev.needs > 0);
          return (
            <React.Fragment key={stage.id}>
              {i > 0 && (
                <span
                  aria-hidden
                  className="relative grid shrink-0 place-items-center font-mono text-[15px] font-medium leading-none"
                  style={{ width: 0, color: prevBlocked ? LAYER.brand : "#9a9a9a" }}
                >
                  <span className="absolute left-[-14px]">›</span>
                </span>
              )}
              <StepCard
                stage={stage}
                index={i}
                active={activeStage === stage.id}
                ready={readyOf(stage)}
                onSelect={() => onStageChange(stage.id)}
              />
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}

/** One muted line for <PageHeader subtitle>. */
export function policyContextLine(ctx: {
  plant: string;
  model: string;
  bom: string;
  suppliers: number;
  plants: number;
  customers: number;
  strategy: string;
}) {
  return [
    `Plant ${ctx.plant}`,
    `Model ${ctx.model}`,
    `BOM ${ctx.bom}`,
    `${ctx.suppliers} suppliers`,
    `${ctx.plants} plants`,
    `${ctx.customers} customers`,
    `Strategy ${ctx.strategy}`,
  ].join(" · ");
}
