import { useEffect, useMemo, useState } from "react";
import { PageLayout } from "@/components/shared/PageLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { PAGE_GUTTER_SKIN } from "@/components/shared/PageBody";
import { MobileSegmented } from "@/components/mobile";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Segmented } from "@/components/intelligence/piUi";
import { useGlobalProject } from "@/hooks/useGlobalProject";
import { useProjects } from "@/hooks/useProjects";
import { usePolicies } from "@/hooks/usePolicies";
import { useProjectContext } from "@/hooks/useProjectContext";
import { useModelValidation } from "@/hooks/useModelValidation";
import { useStageGuards } from "@/hooks/useStageGuards";
import { useTimeUnit, DAYS_PER_UNIT, UNIT_LABEL_PLURAL } from "@/hooks/useTimeUnit";
import { FocusedStage } from "@/components/policies/FocusedStage";
import { GuidePanel } from "@/components/policies/GuidePanel";
import { VerifiableExportsSection } from "@/components/policies/VerifiableExportsSection";
import { DataMapGrid } from "@/components/policies/DataMapGrid";
import {
  PolicySetupBar,
  policyContextLine,
  type PlanningUnit,
} from "@/components/policies/PolicySetupBar";
import {
  formatVersionWhen,
  PolicyHistorySheet,
  SaveVersionDialog,
  versionDisplayName,
} from "@/components/policies/PolicyVersionSheets";
import type { StageKey } from "@/lib/policies/stages";

interface Props {
  isCollapsed: boolean;
  setIsCollapsed: (c: boolean) => void;
}

/** Horizon + "Week 1 = …" calendar mapping, from the project's sim window. */
function useHorizon(
  startDate: string | null | undefined,
  endDate: string | null | undefined,
  unit: PlanningUnit,
) {
  return useMemo(() => {
    const s = startDate ? new Date(startDate) : null;
    const e = endDate ? new Date(endDate) : null;
    const valid = s && e && Number.isFinite(s.getTime()) && Number.isFinite(e.getTime()) && e > s;
    const days = valid ? Math.round((e!.getTime() - s!.getTime()) / 86_400_000) : null;
    const span = DAYS_PER_UNIT[unit];
    const horizon =
      days === null
        ? "not set"
        : unit === "day"
          ? `${days} days`
          : `${days} days · ${(days / span).toFixed(1)} ${UNIT_LABEL_PLURAL[unit]}`;

    let unitMap = "";
    if (s && Number.isFinite(s.getTime())) {
      const fmt = (d: Date) =>
        d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
      const label = unit === "day" ? "Day" : unit === "week" ? "Week" : "Month";
      unitMap =
        unit === "day"
          ? `${label} 1 = ${fmt(s)}`
          : `${label} 1 = ${fmt(s)} → ${fmt(new Date(s.getTime() + (span - 1) * 86_400_000))} (${span} days each)`;
    }
    return { horizon, unitMap };
  }, [startDate, endDate, unit]);
}

export default function ProjectPolicies({ isCollapsed, setIsCollapsed }: Props) {
  const {
    globalSelectedProjectId,
    setGlobalSelectedProjectId,
    selectedProject,
    setSelectedProject,
  } = useGlobalProject();
  const projectId = globalSelectedProjectId;
  const { projects } = useProjects();

  // The grid is the widest surface in the app — start with the rail collapsed
  // so the pointer starts near the lines.
  useEffect(() => {
    setIsCollapsed(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep `selectedProject` in sync with the picker so downstream cards have full project meta.
  useEffect(() => {
    if (!projectId) return;
    const match = projects.find((p) => p.id === projectId);
    if (match && match.id !== selectedProject?.id) {
      setSelectedProject(match as any);
    }
  }, [projectId, projects, selectedProject?.id, setSelectedProject]);

  const {
    defaults,
    overrides,
    loading,
    fulfillmentStrategy,
    activePreset,
    presetAppliedAt,
    versions,
    isDirty,
    selectedVersionId,
    setSelectedVersionId,
    restoreVersion,
    saveDefault,
    applyResolvedPreset,
    clearActivePreset,
    bulkUpsertOverrides,
    deleteOverride,
    saveSnapshot,
    updateVersionNotes,
    deleteVersion,
    exportVersion,
  } = usePolicies(projectId);

  const { ctx, hasData } = useProjectContext({ projectId, fulfillmentStrategy });
  const { unit: storedUnit, setUnit } = useTimeUnit(projectId);
  // Unset behaves exactly like "day" — the engine stores days and adaptLabel
  // leaves labels alone — so the control always shows the effective unit.
  const unit: PlanningUnit = storedUnit ?? "day";
  const { horizon, unitMap } = useHorizon(
    selectedProject?.simulation_start,
    selectedProject?.simulation_end,
    unit,
  );

  const [tab, setTab] = useState<"stages" | "guide" | "datamap">("stages");
  const [activeStage, setActiveStage] = useState<StageKey>("supplier");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);

  // Stage 4 evidence: an adopted model card exists — the persisted proof that
  // replications ran and a warm-up was adopted (G13).
  const { cards } = useModelValidation(projectId);
  const { guards, rowsByStage } = useStageGuards({
    projectId,
    plantName: ctx?.plant_name,
    defaults,
    overrides,
    evidence: cards.length > 0,
  });

  const currentVersion = versions.find((v) => v.id === selectedVersionId) ?? null;

  return (
    <PageLayout isCollapsed={isCollapsed} setIsCollapsed={setIsCollapsed}>
      <div className={PAGE_GUTTER_SKIN}>
        <PageHeader
          skin
          title="Supply chain policies"
          subtitle={policyContextLine({
            plant: ctx?.plant_name || selectedProject?.plant_name || "—",
            model: selectedProject?.supply_chain_model || "—",
            bom: selectedProject?.bom_level || "—",
            suppliers: ctx?.supplier_count ?? 0,
            plants: ctx?.plant_count ?? 0,
            customers: ctx?.customer_count ?? 0,
            strategy: fulfillmentStrategy,
          })}
          rightContent={
            <>
              {/* Below md the header holds the project select only; the tab
                  switcher renders as the first thing in the content column.
                  md:contents keeps it a direct rightContent child on desktop. */}
              <span className="hidden md:contents">
                <Segmented<"stages" | "guide" | "datamap">
                  size="sm"
                  value={tab}
                  onChange={setTab}
                  options={[
                    { value: "stages", label: "Policies" },
                    { value: "guide", label: "Guide" },
                    { value: "datamap", label: "Data map" },
                  ]}
                />
              </span>
              <Select
                value={projectId || ""}
                onValueChange={(v) => setGlobalSelectedProjectId(v || null)}
              >
                {/* The header's one right-hand element (§4). Below `md` it
                    drops its box and reads as the quiet mono context line the
                    skin puts beside a title; from `md` up it is the bordered
                    select the desktop header has always had. */}
                <SelectTrigger
                  className="h-11 w-auto max-w-[46vw] gap-1.5 border-0 bg-transparent px-0
                             font-mono text-[10.5px] tracking-[0.04em] text-[#525252]
                             md:h-8 md:w-[210px] md:border md:border-input md:bg-background
                             md:px-3 md:font-sans md:text-[12px] md:tracking-normal
                             md:text-foreground"
                >
                  <SelectValue placeholder="Select project" />
                </SelectTrigger>
                <SelectContent>
                  {projects.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </>
          }
        />

        {/* §13.2 — the segmented control is the screen's second band, directly
            under the title. Same three peer views, same handler; only the
            control's own chrome changes below `md`. */}
        <div className="mb-3 md:hidden">
          <MobileSegmented<"stages" | "guide" | "datamap">
            ariaLabel="Policies views"
            value={tab}
            onChange={setTab}
            items={[
              { value: "stages", label: "Policies" },
              { value: "guide", label: "Guide" },
              { value: "datamap", label: "Data map" },
            ]}
          />
        </div>

        {!projectId ? (
          <Alert>
            <AlertDescription>Select a project to configure policies.</AlertDescription>
          </Alert>
        ) : tab === "datamap" ? (
          <DataMapGrid projectId={projectId} />
        ) : tab === "guide" ? (
          <GuidePanel
            onJumpToStage={(s) => {
              setActiveStage(s);
              setTab("stages");
            }}
          />
        ) : (
          <>
            <PolicySetupBar
              versionName={
                currentVersion ? versionDisplayName(currentVersion) : "Current (live working copy)"
              }
              isSnapshot={!!currentVersion}
              versionStamp={
                currentVersion
                  ? `${formatVersionWhen(currentVersion.created_at)} · ${
                      currentVersion.author_name || currentVersion.author_email || "unknown"
                    }`
                  : undefined
              }
              versionCount={versions.length}
              dirty={isDirty}
              onSaveVersion={() => setSaveOpen(true)}
              onOpenHistory={() => setHistoryOpen(true)}
              unit={unit}
              onUnitChange={setUnit}
              horizon={horizon}
              unitMap={unitMap}
              stages={guards}
              activeStage={activeStage}
              onStageChange={setActiveStage}
            />

            <FocusedStage
              projectId={projectId}
              stageKey={activeStage}
              defaults={defaults}
              overrides={overrides}
              ctx={ctx}
              hasData={hasData}
              fulfillmentStrategy={fulfillmentStrategy}
              activePreset={activePreset}
              presetAppliedAt={presetAppliedAt}
              saveDefault={saveDefault}
              bulkUpsertOverrides={bulkUpsertOverrides}
              deleteOverride={deleteOverride}
              applyResolvedPreset={applyResolvedPreset}
              clearActivePreset={clearActivePreset}
              saveSnapshot={saveSnapshot}
              selectedVersionId={selectedVersionId}
              policyDirty={isDirty}
              rowsByStage={rowsByStage}
            />

            {loading && (
              <p className="mt-2 font-mono text-[11px] text-muted-foreground">loading policies…</p>
            )}
          </>
        )}

        <SaveVersionDialog
          open={saveOpen}
          onOpenChange={setSaveOpen}
          current={currentVersion}
          onSave={saveSnapshot}
        />
        <PolicyHistorySheet
          open={historyOpen}
          onOpenChange={setHistoryOpen}
          versions={versions}
          selectedVersionId={selectedVersionId}
          onSelect={setSelectedVersionId}
          onRestore={restoreVersion}
          onExport={exportVersion}
          onDelete={deleteVersion}
          onUpdateNotes={updateVersionNotes}
          exportsSection={
            projectId ? (
              <VerifiableExportsSection
                projectId={projectId}
                projectName={selectedProject?.name ?? null}
              />
            ) : null
          }
        />
      </div>
    </PageLayout>
  );
}
