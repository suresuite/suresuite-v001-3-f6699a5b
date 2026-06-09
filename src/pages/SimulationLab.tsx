import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { PageLayout } from "@/components/shared/PageLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { ProjectSelector } from "@/components/shared";
import { BookOpen, Play, Zap } from "lucide-react";
import { toast } from "sonner";
import { useGlobalProject } from "@/hooks/useGlobalProject";
import { useProjects } from "@/hooks/useProjects";
import { useScenarios } from "@/hooks/useScenarios";
import { useSimulationRun } from "@/hooks/useSimulationRun";
import { usePolicies } from "@/hooks/usePolicies";
import { ScenarioRail } from "@/components/sim/ScenarioRail";
import { ScenarioSetupForm } from "@/components/sim/ScenarioSetupForm";
import { ScenarioLibraryPanel } from "@/components/sim/ScenarioLibraryPanel";
import { RunProgressPanel } from "@/components/sim/RunProgressPanel";
import { ResultsDashboard } from "@/components/sim/ResultsDashboard";
import { CompareScenariosPanel } from "@/components/sim/CompareScenariosPanel";
import { ExperimentDesigner } from "@/components/sim/ExperimentDesigner";
import { DisruptionRecoveryPane } from "@/components/sim/DisruptionRecoveryPane";
import { DisruptionDialog } from "@/components/DisruptionDialog";
import type { RecoveryConfig } from "@/lib/sim/recoveryScore";

interface Props {
  isCollapsed: boolean;
  setIsCollapsed: (c: boolean) => void;
}

type Pane = "setup" | "recovery" | "run" | "results" | "compare" | "experiments";

export default function SimulationLab({ isCollapsed, setIsCollapsed }: Props) {
  const [searchParams] = useSearchParams();
  const { globalSelectedProjectId, setGlobalSelectedProjectId } = useGlobalProject();
  const projectId = globalSelectedProjectId;
  const { projects } = useProjects();
  const { scenarios, loading, create, update, remove, duplicate } = useScenarios(projectId);
  const { defaults: policyDefaults } = usePolicies(projectId);
  const projectRecovery = (policyDefaults?.recovery ?? null) as RecoveryConfig | null;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pane, setPane] = useState<Pane>("setup");
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [disruptionOpen, setDisruptionOpen] = useState(false);

  // If navigated from a network page with ?scenario_id=XYZ, auto-select that scenario
  // and jump to the recovery pane so the user sees the pre-filled disruption.
  useEffect(() => {
    const paramId = searchParams.get("scenario_id");
    const paramPane = searchParams.get("pane") as Pane | null;
    if (paramId) {
      setSelectedId(paramId);
      if (paramPane) setPane(paramPane);
    }
  }, [searchParams]);

  // Auto-select first scenario when list loads (if nothing pre-selected from URL)
  useEffect(() => {
    const paramId = searchParams.get("scenario_id");
    if (paramId) return; // URL param takes precedence
    if (!selectedId && scenarios.length > 0) setSelectedId(scenarios[0].id);
    if (selectedId && !scenarios.find((s) => s.id === selectedId)) {
      setSelectedId(scenarios[0]?.id ?? null);
    }
  }, [scenarios, selectedId, searchParams]);

  const selected = useMemo(
    () => scenarios.find((s) => s.id === selectedId) ?? null,
    [scenarios, selectedId],
  );
  const { latestRun, reps, runExperiment, cancelRun, addReps } = useSimulationRun(selectedId);

  const handleRun = async () => {
    if (!projectId || !selected) return;
    try {
      await runExperiment(projectId);
      toast.success(`Queued: ${selected.name}`);
      setPane("run");
    } catch (e) {
      toast.error(`Failed to queue run: ${(e as Error).message}`);
    }
  };

  const handleCancel = async () => {
    if (!projectId || !latestRun) return;
    try {
      await cancelRun(projectId, latestRun.id);
      toast.success("Cancelling…");
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const handleAddReps = async (n: number) => {
    if (!projectId || !latestRun) return;
    try {
      await addReps(projectId, latestRun.id, n);
      toast.success(`Queued +${n} replications`);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fromNetwork = !!(selected && (selected as any).from_network);

  return (
    <PageLayout isCollapsed={isCollapsed} setIsCollapsed={setIsCollapsed}>
      <div className="px-12 py-6">
        <PageHeader
          title="Simulation Lab"
          subtitle="Scenarios, replications, warm-up auto-detection, and utilization-first KPIs."
          rightContent={
            <ProjectSelector
              projects={projects as any}
              selectedProjectId={projectId}
              onProjectSelect={setGlobalSelectedProjectId}
              className="w-[260px] h-8"
            />
          }
        />

        {!projectId ? (
          <Alert>
            <AlertDescription>Select a project to start designing experiments.</AlertDescription>
          </Alert>
        ) : (
          <div className="flex gap-4 items-start">
            <ScenarioRail
              scenarios={scenarios}
              selectedId={selectedId}
              loading={loading}
              onSelect={setSelectedId}
              onCreate={async () => {
                const s = await create(`Scenario ${scenarios.length + 1}`);
                if (s) setSelectedId(s.id);
              }}
              onDuplicate={async (s) => {
                const d = await duplicate(s);
                if (d) setSelectedId(d.id);
              }}
              onDelete={async (id) => {
                await remove(id);
                if (selectedId === id) setSelectedId(null);
              }}
            />

            <div className="flex-1 min-w-0 flex flex-col gap-3">
              {/* Toolbar row: pane tabs + Browse library button */}
              <div className="flex items-center gap-2 flex-wrap">
                <ToggleGroup
                  type="single"
                  value={pane}
                  onValueChange={(v) => v && setPane(v as Pane)}
                  className="justify-start flex-1"
                >
                  <ToggleGroupItem value="setup" className="text-xs">Setup</ToggleGroupItem>
                  <ToggleGroupItem value="recovery" className="text-xs">Disruptions &amp; Recovery</ToggleGroupItem>
                  <ToggleGroupItem value="run" className="text-xs">Run</ToggleGroupItem>
                  <ToggleGroupItem value="results" className="text-xs">Results</ToggleGroupItem>
                  <ToggleGroupItem value="compare" className="text-xs">Compare</ToggleGroupItem>
                  <ToggleGroupItem value="experiments" className="text-xs">Experiments</ToggleGroupItem>
                </ToggleGroup>

                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 gap-1.5 text-xs"
                  onClick={() => setDisruptionOpen(true)}
                >
                  <Zap className="h-3.5 w-3.5" />
                  Add disruption
                </Button>

                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 gap-1.5 text-xs"
                  onClick={() => setLibraryOpen(true)}
                >
                  <BookOpen className="h-3.5 w-3.5" />
                  Browse library
                </Button>

                {selected && (
                  <Button
                    size="sm"
                    className="h-8 gap-1.5 text-xs"
                    onClick={handleRun}
                    disabled={!selected}
                  >
                    <Play className="h-3 w-3" />
                    Run
                  </Button>
                )}
              </div>

              {/* From-network badge */}
              {fromNetwork && (
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className="text-[10px] gap-1">
                    From network map
                  </Badge>
                  <span className="text-[11px] text-muted-foreground">
                    Disruption was pre-configured from the supply chain network view.
                  </span>
                </div>
              )}

              {!selected ? (
                <Alert>
                  <AlertDescription>
                    No scenario selected. Create one in the rail or browse the library to get started.
                  </AlertDescription>
                </Alert>
              ) : pane === "setup" ? (
                <ScenarioSetupForm
                  scenario={selected}
                  onSave={(patch) => update(selected.id, patch)}
                />
              ) : pane === "recovery" ? (
                <DisruptionRecoveryPane
                  scenario={selected}
                  projectRecovery={projectRecovery}
                  onSave={(patch) => update(selected.id, patch)}
                />
              ) : pane === "run" ? (
                <RunProgressPanel
                  run={latestRun}
                  reps={reps}
                  onCancel={handleCancel}
                  onAddReps={handleAddReps}
                />
              ) : pane === "results" ? (
                <ResultsDashboard run={latestRun} reps={reps} primaryKpi={selected.primary_kpi} scenario={selected} />
              ) : pane === "compare" ? (
                <CompareScenariosPanel />
              ) : (
                <ExperimentDesigner />
              )}
            </div>
          </div>
        )}
      </div>

      {projectId && (
        <ScenarioLibraryPanel
          open={libraryOpen}
          projectId={projectId}
          onClose={() => setLibraryOpen(false)}
          onCloned={(id) => {
            setSelectedId(id);
            setPane("recovery");
          }}
        />
      )}

      {projectId && (
        <DisruptionDialog
          open={disruptionOpen}
          onOpenChange={setDisruptionOpen}
          nodeId={null}
          projectId={projectId}
          plantName={projects.find((p: any) => p.id === projectId)?.plant_name ?? "Project"}
          connectedEdges={[]}
          onSuccess={() => setPane("recovery")}
        />
      )}
    </PageLayout>
  );
}
