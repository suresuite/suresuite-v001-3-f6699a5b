import { useEffect, useState } from "react";
import { PageLayout } from "@/components/shared/PageLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Layers, Compass } from "lucide-react";
import { useGlobalProject } from "@/hooks/useGlobalProject";
import { useProjects } from "@/hooks/useProjects";
import { usePolicies } from "@/hooks/usePolicies";
import { useProjectContext } from "@/hooks/useProjectContext";
import { ProjectContextStrip } from "@/components/policies/ProjectContextStrip";
import { StageRail } from "@/components/policies/StageRail";
import { FocusedStage } from "@/components/policies/FocusedStage";
import { GuidePanel } from "@/components/policies/GuidePanel";
import { PolicyVersionBar } from "@/components/policies/PolicyVersionBar";
import { TimeUnitBar } from "@/components/policies/TimeUnitBar";
import type { StageKey } from "@/lib/policies/stages";

interface Props {
  isCollapsed: boolean;
  setIsCollapsed: (c: boolean) => void;
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
  } = usePolicies(projectId);

  const { ctx, hasData } = useProjectContext({ projectId, fulfillmentStrategy });

  const [tab, setTab] = useState<"stages" | "guide">("stages");
  const [activeStage, setActiveStage] = useState<StageKey>("supplier");

  return (
    <PageLayout isCollapsed={isCollapsed} setIsCollapsed={setIsCollapsed}>
      <div className="px-12 py-8">
        <PageHeader
          title="Supply chain policies"
          subtitle={<ProjectContextStrip project={selectedProject} projectId={projectId} ctx={ctx} />}
          rightContent={
            <Select
              value={projectId || ""}
              onValueChange={(v) => setGlobalSelectedProjectId(v || null)}
            >
              <SelectTrigger className="w-[200px] h-9">
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
          }
        />

        {!projectId ? (
          <Alert>
            <AlertDescription>Select a project to configure policies.</AlertDescription>
          </Alert>
        ) : (
          <div className="flex flex-col gap-6">


            <Tabs value={tab} onValueChange={(v) => setTab(v as "stages" | "guide")}>
              <TabsList className="grid grid-cols-2 w-full max-w-md">
                <TabsTrigger value="stages" className="gap-1.5">
                  <Layers className="h-3.5 w-3.5" /> Stages
                </TabsTrigger>
                <TabsTrigger value="guide" className="gap-1.5">
                  <Compass className="h-3.5 w-3.5" /> Guide me
                </TabsTrigger>
              </TabsList>

              <TabsContent value="stages" className="mt-6 flex flex-col gap-6">
                <PolicyVersionBar
                  versions={versions}
                  selectedVersionId={selectedVersionId}
                  isDirty={isDirty}
                  onSelect={setSelectedVersionId}
                  onSave={saveSnapshot}
                  onRestore={restoreVersion}
                />
                <TimeUnitBar
                  projectId={projectId}
                  startDate={selectedProject?.simulation_start ?? null}
                  endDate={selectedProject?.simulation_end ?? null}
                />
                <StageRail
                  active={activeStage}
                  ctx={ctx}
                  overrides={overrides}
                  hasData={hasData}
                  onSelect={setActiveStage}
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
                />

                {loading && <p className="text-xs text-muted-foreground">Loading policies…</p>}
              </TabsContent>

              <TabsContent value="guide" className="mt-6">
                <GuidePanel
                  onJumpToStage={(s) => {
                    setActiveStage(s);
                    setTab("stages");
                  }}
                />
              </TabsContent>
            </Tabs>
          </div>
        )}
      </div>
    </PageLayout>
  );
}
