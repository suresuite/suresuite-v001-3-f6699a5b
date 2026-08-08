import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageLayout } from "@/components/shared/PageLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { toast } from "sonner";
import { useCapabilities } from "@/hooks/useCapabilities";
import { useGlobalProject } from "@/hooks/useGlobalProject";
import { useProjects } from "@/hooks/useProjects";
import { useScenarios } from "@/hooks/useScenarios";
import { useSimulationRun } from "@/hooks/useSimulationRun";
import { useScenarioRuns } from "@/hooks/useScenarioRuns";
import { usePolicies } from "@/hooks/usePolicies";
import { useItemMasters } from "@/hooks/useItemMasters";
import { useModelValidation } from "@/hooks/useModelValidation";
import { StageRail, buildStages, type PaneId } from "@/components/sim/StageRail";
import { ExperimentLibraryBox, ScenarioList } from "@/components/sim/ScenarioRail";
import { ScenarioSetupForm } from "@/components/sim/ScenarioSetupForm";
import { ScenarioLibraryPanel } from "@/components/sim/ScenarioLibraryPanel";
import { RunProgressPanel } from "@/components/sim/RunProgressPanel";
import { ResultsDashboard } from "@/components/sim/ResultsDashboard";
import { CompareScenariosPanel } from "@/components/sim/CompareScenariosPanel";
import { DisruptionRecoveryPane, mergeRecovery } from "@/components/sim/DisruptionRecoveryPane";
import {
  StressTestDrawer,
  STRESS_TESTS,
  type StressTestPreset,
} from "@/components/sim/StressTestCard";
import { PreRunValidationPanel } from "@/components/sim/PreRunValidationPanel";
import { GateBar } from "@/components/sim/RunGate";
import { CredibilityBadge } from "@/components/sim/CredibilityBadge";
import {
  compileGateFindings,
  gateFindingsToFindings,
  type Finding,
} from "@/lib/policies/validationService";
import type { RecoveryConfig } from "@/lib/sim/recoveryScore";

interface Props {
  isCollapsed: boolean;
  setIsCollapsed: (c: boolean) => void;
}

type Pane = PaneId;

export default function SimulationLab({ isCollapsed, setIsCollapsed }: Props) {
  const [searchParams] = useSearchParams();
  const { globalSelectedProjectId, setGlobalSelectedProjectId } = useGlobalProject();
  const projectId = globalSelectedProjectId;
  const { projects } = useProjects();
  const { scenarios, loading, create, update, remove, duplicate } = useScenarios(projectId);
  const { runsByScenario } = useScenarioRuns(projectId);
  const {
    defaults: policyDefaults,
    versions: policyVersions,
    selectedVersionId: policyVersionId,
    isDirty: policyDirty,
    saveSnapshot: savePolicySnapshot,
  } = usePolicies(projectId);
  const projectRecovery = (policyDefaults?.recovery ?? null) as RecoveryConfig | null;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pane, setPane] = useState<Pane>("setup");
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [stressOpen, setStressOpen] = useState(false);

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
    if (paramId) return;
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

  // ── §8.1 required-data gate, surfaced PRE-dispatch (Phase B0 / G6) ────────
  // Grade the same manifest the sim-command gate grades, client-side through
  // the shared module, so the findings are visible (and fixable) before the
  // Run click — and render the server's own typed copy after a 422.
  const itemMasters = useItemMasters(projectId);
  const clientFindings = useMemo<Finding[] | null>(() => {
    if (!projectId || itemMasters.loading || !itemMasters.lanes.loaded) return null;
    const gate = compileGateFindings(
      {
        defaults: policyDefaults,
        materials: itemMasters.materials as unknown as Record<string, unknown>[],
        products: itemMasters.products as unknown as Record<string, unknown>[],
        suppliers: itemMasters.suppliers as unknown as Record<string, unknown>[],
        inbound: itemMasters.lanes.inbound,
        outbound: itemMasters.lanes.outbound,
        // Multi-level BOM lanes carry higher_level_component_id — grade them
        // through the single-level shape exactly as the edge gate does.
        bom: itemMasters.lanes.bom.map((r) =>
          r.product_id == null && r.higher_level_component_id != null
            ? { ...r, product_id: r.higher_level_component_id }
            : r,
        ),
      },
      (selected?.disruption_schedule as unknown as Record<string, unknown>[]) ?? [],
    );
    return gateFindingsToFindings(gate);
    // Depend on the hook's stable state slices — the result object itself is
    // rebuilt every render and would wipe the acknowledgment state below.
  }, [
    projectId,
    itemMasters.loading,
    itemMasters.materials,
    itemMasters.products,
    itemMasters.suppliers,
    itemMasters.lanes,
    policyDefaults,
    selected?.disruption_schedule,
  ]);

  // The server's findings (from a 422) win until the underlying data changes,
  // at which point the live client grading takes over again.
  const [serverFindings, setServerFindings] = useState<Finding[] | null>(null);
  const [ackWarnings, setAckWarnings] = useState(false);
  useEffect(() => {
    setServerFindings(null);
    setAckWarnings(false);
  }, [selectedId, clientFindings]);

  const { canFeature } = useCapabilities();
  const canRunSimulations = canFeature("simulation_lab");
  const gateFindings = serverFindings ?? clientFindings;
  const gateBlocks = (gateFindings ?? []).filter((f) => f.severity === "block").length;
  const gateWarns = (gateFindings ?? []).filter((f) => f.severity === "warn").length;
  const runBlockedReason = !canRunSimulations
    ? "Running simulations isn't enabled for your account. Contact an administrator."
    : gateBlocks > 0
      ? "Blocking findings below must be fixed before the run can dispatch"
      : gateWarns > 0 && !ackWarnings
      ? "Acknowledge the warnings below to run with engine defaults"
      : null;

  // ── B0b credibility (Phase B0 / G13 / §9.5) ───────────────────────────────
  const cred = useModelValidation(projectId);
  const credibility = cred.resolveScenario(policyVersionId, selected, { dirty: policyDirty });
  // Inheritance on first render of a never-touched scenario under a validated
  // triple (§2.6) — creation-time inheritance happens in onCreate below.
  const inheritTried = useRef(new Set<string>());
  useEffect(() => {
    if (!selected || !policyVersionId || policyDirty) return;
    if (selected.inherited_validation_id) return;
    if (selected.warmup_mode !== "auto") return; // hand-set → never override
    if (inheritTried.current.has(selected.id)) return;
    inheritTried.current.add(selected.id);
    void cred.applyIfValidated(selected, policyVersionId).then((cardId) => {
      if (cardId) toast.message("Warm-up & replications inherited from the model validation.");
    });
  }, [selected, policyVersionId, policyDirty, cred]);

  const dispatchRun = async (versionId: string, forceRerun = false) => {
    if (!projectId || !selected) return;
    if (!canRunSimulations) {
      toast.error("Running simulations isn't enabled for your account.");
      return;
    }
    try {
      const result = await runExperiment(projectId, versionId, ackWarnings, forceRerun);
      if (result.queued) {
        toast.success(`Queued: ${selected.name}`);
        setPane("run");
        return;
      }
      // Reuse-or-rerun (G17 / §9.2 read-path slice): identical completed
      // results exist. Reuse is ALWAYS the user's explicit choice — on reuse
      // the stored run is surfaced (it is this scenario's newest completed
      // run), on re-run we dispatch again with force_rerun.
      if (result.status === "reuse_available" && result.reuseCandidate) {
        const c = result.reuseCandidate;
        const when = c.ended_at ? new Date(c.ended_at).toLocaleString() : "earlier";
        const reuse = window.confirm(
          `Identical results already exist from ${when} ` +
            `(${c.rep_count_done ?? "?"} replication(s), engine ${c.code_version || "unknown"}).\n\n` +
            `OK — reuse the stored results (no recompute).\n` +
            `Cancel — re-run the simulation from scratch.`,
        );
        if (reuse) {
          toast.success("Reusing the stored run — no recompute needed.");
          setPane("results");
          return;
        }
        await dispatchRun(versionId, true);
        return;
      }
      // Typed 422: render the gate's findings structurally in the run pane.
      setServerFindings(gateFindingsToFindings(result.findings ?? []));
      setPane("run");
      toast.warning(
        result.status === "blocked"
          ? "Run rejected — blocking data gaps. See the findings panel."
          : "Run paused — acknowledge the warnings in the findings panel to run.",
      );
    } catch (e) {
      toast.error(`Failed to queue run: ${(e as Error).message}`);
    }
  };

  const handleRun = async () => {
    if (!projectId || !selected || !policyVersionId || policyDirty) return;
    await dispatchRun(policyVersionId);
  };

  const handleSaveVersionAndRun = async () => {
    if (!projectId || !selected) return;
    const versionId = await savePolicySnapshot(
      `Run: ${selected.name} — ${new Date().toLocaleString()}`,
    );
    if (!versionId) return;
    await dispatchRun(versionId);
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

  // ── Stage rail (UI pass) ──────────────────────────────────────────────────
  // Every sub-label is a fact the page already holds. "Results done" means the
  // newest completed run was dispatched under the model version in force —
  // a run from a superseded version is history, not the current answer.
  const effectiveRecovery = useMemo(
    () => mergeRecovery(projectRecovery, (selected?.recovery_overrides ?? null) as Record<string, unknown> | null),
    [projectRecovery, selected?.recovery_overrides],
  );
  const { stages, gate: gateReadout } = buildStages({
    scenario: selected ?? { horizon_days: 0, replications: 0, primary_kpi: "" },
    eventCount: selected?.disruption_schedule?.length ?? 0,
    leverCount: effectiveRecovery.response?.length ?? 0,
    recoveryEnabled: !!effectiveRecovery.enabled,
    gate: { blocks: gateBlocks, warns: gateWarns, reason: runBlockedReason },
    run: latestRun && {
      status: latestRun.status,
      rep_count_done: latestRun.rep_count_done,
      rep_count_target: latestRun.rep_count_target,
      current: !policyDirty && latestRun.policy_version_id === policyVersionId,
    },
    scenariosWithResults: scenarios.filter((s) => runsByScenario[s.id]).length,
  });

  return (
    <PageLayout isCollapsed={isCollapsed} setIsCollapsed={setIsCollapsed}>
      <div className="px-12 py-6">
        <PageHeader
          title="Simulation Lab"
          rightContent={
            <div className="flex items-center gap-2">
              <Select
                value={projectId || ""}
                onValueChange={(v) => setGlobalSelectedProjectId(v || null)}
              >
                <SelectTrigger className="w-[200px] h-9">
                  <SelectValue placeholder="Select project" />
                </SelectTrigger>
                <SelectContent>
                  {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                  {projects.map((p: any) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          }
        />

        {!projectId ? (
          <div className="rounded-sm border border-[#e0e0e3] bg-white px-3 py-[10px] text-[12.5px] text-[#71717a]">
            No project selected
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {selected ? (
              <StageRail stages={stages} active={pane} onSelect={setPane} gate={gateReadout} />
            ) : null}

            <div className="flex gap-4 items-start">
              <aside className="w-64 shrink-0">
                <ExperimentLibraryBox
                  count={STRESS_TESTS.length}
                  open={stressOpen}
                  onToggle={() => setStressOpen((v) => !v)}
                />
                {stressOpen ? (
                  <StressTestDrawer
                    onLaunch={async (preset: StressTestPreset) => {
                      const s = await create(preset.name);
                      if (!s) return;
                      await update(s.id, {
                        description: preset.description,
                        disruption_schedule: preset.disruption_schedule,
                      });
                      // Stress scenarios share the baseline world (events are
                      // excluded from the fingerprint, §2.3) — they inherit too.
                      inheritTried.current.add(s.id);
                      void cred.applyIfValidated(s, policyVersionId, { dirty: policyDirty });
                      setSelectedId(s.id);
                      setPane("recovery");
                      toast.success(`Stress test ready: ${preset.name.replace(/^\[Stress\]\s*/, "")}`);
                    }}
                  />
                ) : null}
                <ScenarioList
                  scenarios={scenarios}
                  selectedId={selectedId}
                  loading={loading}
                  credibilityFor={(s) => cred.resolveScenario(policyVersionId, s, { dirty: policyDirty })}
                  onSelect={setSelectedId}
                  onBrowseSaved={() => setLibraryOpen(true)}
                  onCreate={async () => {
                    const s = await create(`Scenario ${scenarios.length + 1}`);
                    if (!s) return;
                    // §2.6: scenarios created under a validated triple inherit
                    // the adopted warm-up + replication count at birth.
                    inheritTried.current.add(s.id);
                    void cred
                      .applyIfValidated(s, policyVersionId, { dirty: policyDirty })
                      .then((cardId) => {
                        if (cardId) {
                          toast.message("Warm-up & replications inherited from the model validation.");
                        }
                      });
                    setSelectedId(s.id);
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
              </aside>

              <div className="flex-1 min-w-0 flex flex-col gap-3">
                {fromNetwork && (
                  <span className="w-fit rounded-sm bg-[#f0f0f2] px-[7px] py-px text-[11px] text-[#52525b]">
                    from network map
                  </span>
                )}

                {!selected ? (
                  <div className="rounded-sm border border-[#e0e0e3] bg-white px-3 py-[10px] text-[12.5px] text-[#71717a]">
                    No scenario selected
                  </div>
                ) : pane === "setup" ? (
                  <ScenarioSetupForm
                    scenario={selected}
                    projectId={projectId}
                    onSave={(patch) => update(selected.id, patch)}
                  />
                ) : pane === "recovery" ? (
                  <DisruptionRecoveryPane
                    scenario={selected}
                    projectRecovery={projectRecovery}
                    onSave={(patch) => update(selected.id, patch)}
                  />
                ) : pane === "run" ? (
                  <div className="flex flex-col gap-3">
                    {/* Model version + the gate, with the blocked reason as
                        visible text instead of a title attribute. */}
                    <section className="overflow-hidden rounded-sm border border-[#e0e0e3] bg-white">
                      <div className="flex flex-wrap items-center gap-2 px-3 py-[9px] text-[12.5px] text-[#18181b]">
                        {policyDirty
                          ? policyVersionId
                            ? `Policy settings changed since version "${
                                policyVersions.find((v) => v.id === policyVersionId)?.label ??
                                policyVersionId.slice(0, 8)
                              }"`
                            : "No saved model version — runs require a saved policy version"
                          : `Model version: ${
                              policyVersions.find((v) => v.id === policyVersionId)?.label ??
                              policyVersionId?.slice(0, 8)
                            }`}
                        <CredibilityBadge credibility={credibility} />
                      </div>
                      <GateBar
                        blocks={gateBlocks}
                        warns={gateWarns}
                        acknowledged={ackWarnings}
                        reason={runBlockedReason}
                        dirty={policyDirty}
                        onRun={handleRun}
                        onSaveVersionAndRun={handleSaveVersionAndRun}
                        onShowFindings={() => setPane("run")}
                      />
                    </section>
                    <PreRunValidationPanel
                      projectId={projectId}
                      findings={gateFindings}
                      source={serverFindings ? "gate rejection" : "pre-run check"}
                      acknowledged={ackWarnings}
                      onAcknowledgedChange={setAckWarnings}
                      supplierIds={itemMasters.suppliers.map((s) => s.supplier_id)}
                    />
                    <RunProgressPanel
                      run={latestRun}
                      reps={reps}
                      versionLabel={
                        latestRun?.policy_version_id
                          ? policyVersions.find((v) => v.id === latestRun.policy_version_id)?.label ??
                            latestRun.policy_version_id.slice(0, 8)
                          : null
                      }
                      credibility={cred.resolveRun(latestRun)}
                      onCancel={handleCancel}
                      onAddReps={handleAddReps}
                    />
                  </div>
                ) : pane === "results" ? (
                  <ResultsDashboard
                    run={latestRun}
                    reps={reps}
                    primaryKpi={selected.primary_kpi}
                    scenario={selected}
                    credibility={cred.resolveRun(latestRun)}
                  />
                ) : (
                  <CompareScenariosPanel scenarios={scenarios} runsByScenario={runsByScenario} />
                )}
              </div>
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
    </PageLayout>
  );
}
