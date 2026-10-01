import { useEffect, useMemo, useRef, useState } from "react";
import { useIsMobile } from "@/hooks/use-is-mobile";
import { useSearchParams } from "react-router-dom";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageLayout } from "@/components/shared/PageLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { HDR_PROJECT_SELECT } from "@/components/shared/headerControls";
import { cn } from "@/lib/utils";
import { PAGE_GUTTER } from "@/components/shared/PageBody";
import { toast } from "sonner";
import { useProjectRights } from "@/hooks/useProjectRights";
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
import { RESOLVABLE_PLACEHOLDER, resolveStressSchedule } from "@/lib/sim/stressTargets";
import { fetchProjectLanes } from "@/lib/policies/projectLanes";
import { useAuth } from "@/hooks/useAuth";
import { PreRunValidationPanel } from "@/components/sim/PreRunValidationPanel";
import { CapacityReadinessPanel } from "@/components/sim/CapacityReadiness";
import { RunCard } from "@/components/sim/RunCard";
import { SurrogateCard } from "@/components/sim/SurrogateCard";
import { ReadOnlyFrame } from "@/components/sim/ReadOnlyFrame";
import {
  NewScenarioDialog,
  type NewScenarioRequest,
  type NewScenarioStart,
} from "@/components/sim/NewScenarioDialog";
import { buildScenarioSeed, uniqueName, worldOf } from "@/lib/sim/scenarioSeed";
import { useValidatedBaseline } from "@/hooks/useValidatedBaseline";
import { LabModelStep } from "@/components/sim/LabModelStep";
import { useSimEngines } from "@/hooks/useSimEngines";
import { useMyCapacity } from "@/hooks/useMyCapacity";
import { useSurrogateTrainingSet } from "@/hooks/useSurrogateTrainingSet";
import { dispatchExperiment } from "@/lib/sim/dispatch";
import {
  defaultModel,
  formatBytes,
  modelChoices,
  modelOptionLabel,
  overridesOf,
  protocolDeviations,
  replicationWeeks,
  storageEstimate,
  capacityVerdict,
} from "@/lib/sim/labModel";
import { BASELINE_READONLY_REASON, isValidationBaseline } from "@/lib/sim/validationBaseline";
import { runGateState } from "@/lib/sim/runGate";
import { reuseConfirmRequest } from "@/lib/sim/dispatch";
import { useConfirm } from "@/components/shared/confirm/useConfirm";
import { MobileSimulationLab } from "@/components/sim/MobileSimulationLab";
import { versionDisplayName } from "@/components/policies/PolicyVersionSheets";
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
  const isMobile = useIsMobile();
  const confirm = useConfirm();
  const { globalSelectedProjectId, setGlobalSelectedProjectId } = useGlobalProject();
  const { user } = useAuth();
  const projectId = globalSelectedProjectId;
  const { projects } = useProjects();
  const { scenarios, loading, create, update, remove, duplicate } = useScenarios(projectId);
  const { runsByScenario } = useScenarioRuns(projectId);
  const {
    defaults: policyDefaults,
    overrides: policyOverrides,
    versions: policyVersions,
    selectedVersionId: policyVersionId,
    currentVersion: currentPolicyVersion,
    currentHash: policyHash,
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

  // `?project=` (the Validated Model deep link carries it): open that project.
  const projectParam = searchParams.get("project");
  useEffect(() => {
    if (projectParam) setGlobalSelectedProjectId(projectParam);
  }, [projectParam, setGlobalSelectedProjectId]);

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
  const { latestRun, reps, cancelRun, addReps } = useSimulationRun(selectedId);
  const capacity = useMyCapacity(projectId, user?.id, latestRun ? `${latestRun.id}:${latestRun.status}` : null);
  const trainingSet = useSurrogateTrainingSet(projectId, latestRun ? `${latestRun.id}:${latestRun.status}` : null);
  // The validated baseline is Run & Validate's: the Lab shows it and reuses its
  // run, and never edits or dispatches it (§4 D227).
  const baselineSelected = isValidationBaseline(selected);
  const readOnlyReason = baselineSelected ? BASELINE_READONLY_REASON : null;

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
        // RAW rows, single- or multi-level: the shared grader flattens a
        // multi-level BOM to root → leaf exactly as the engine does
        // (`normalizeBomRows`). Rewriting each parent as a `product_id` here
        // skipped that flatten, so a sub-assembly under the product was
        // reported unsourced and the real purchased materials below it were
        // never checked (§4 D182). Same rows RunValidateStage passes.
        bom: itemMasters.lanes.bom,
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

  // D230 — the project role decides, as /profile shows it: a Viewer member runs nothing
  // here whatever the account role.
  const projectRights = useProjectRights(projectId);
  const canRunSimulations = projectRights.can("simulation_lab");
  const gateFindings = serverFindings ?? clientFindings;
  const gateBlocks = (gateFindings ?? []).filter((f) => f.severity === "block").length;
  const gateWarns = (gateFindings ?? []).filter((f) => f.severity === "warn").length;

  // ── B0b credibility (Phase B0 / G13 / §9.5) ───────────────────────────────
  const cred = useModelValidation(projectId);
  const credibility = cred.resolveScenario(policyHash, selected);

  // ── WP 10.5 — Model → Engine → Scenario → Settings → Run ────────────────
  // The Lab starts from a CHOICE of Validated Model (`labModel.ts`): the one a
  // `?model=` link names (WP 10.3's "Open in Simulation Lab" — it also selects
  // the validated baseline, the scenario the model was validated on), else the
  // newest active one. A run follows the chosen model: its policy VERSION (not
  // the live policies), its protocol (deviations recorded), and its engine
  // choice. An editor may instead run an exploratory, unvalidated model, which is
  // badged everywhere and never a comparison baseline.
  const modelParam = searchParams.get("model");
  const [chosenModelId, setChosenModelId] = useState<string | null>(null);
  const chosenModel =
    (chosenModelId ? cred.allCards.find((c) => c.id === chosenModelId) : null) ??
    defaultModel(cred.allCards, modelParam);
  const models = modelChoices(cred.allCards);
  const canExplore = canRunSimulations && projectRights.can("data_edit_policies");
  const [exploratoryRun, setExploratoryRun] = useState(false);
  const usingModel = !!chosenModel && !exploratoryRun;
  const [advanced, setAdvanced] = useState(false);
  const { engines, loading: enginesLoading } = useSimEngines();
  const [engineId, setEngineId] = useState<string | null>(null);
  const chosenEngineId = engineId ?? engines[0]?.id ?? null;
  const baselineScenario = scenarios.find((s) => isValidationBaseline(s)) ?? null;
  // The model's own credibility: judged with ITS policy hash, because a run of
  // it uses its policy version — so only a newer graph or a changed world makes
  // it stale here, which is exactly when running it would not be faithful.
  const modelCredibility = chosenModel
    ? cred.resolveScenario(chosenModel.policy_hash, baselineScenario)
    : null;
  const openedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!modelParam || openedFor.current === modelParam || searchParams.get("scenario_id")) return;
    if (!baselineScenario) return;
    openedFor.current = modelParam;
    setChosenModelId(modelParam);
    setSelectedId(baselineScenario.id);
  }, [modelParam, baselineScenario, searchParams]);
  const deviations =
    usingModel && selected && !baselineSelected ? protocolDeviations(chosenModel!.protocol, selected) : [];
  const runModelReason = !chosenModel
    ? "There is no Validated Model to run."
    : chosenModel.status !== "active"
      ? "This model is no longer in force — choose the one that is."
      : modelCredibility?.state === "stale"
        ? "A newer graph or a changed world makes this model stale — re-validate it in Policies first."
        : !canRunSimulations
          ? projectRights.refusal("simulation_lab") ?? "Running simulations isn't enabled for your account."
          : null;
  // ONE gate state for the rail, the Run card and the phone (§4 D147): the
  // readout, the stage label, the button and its reason are fields of it.
  const runGate = runGateState({
    permitted: canRunSimulations,
    refusal: projectRights.loading
      ? "Checking your rights on this project…"
      : projectRights.refusal("simulation_lab"),
    isBaseline: baselineSelected,
    blocks: gateBlocks,
    warns: gateWarns,
    acknowledged: ackWarnings,
    // A run of a Validated Model uses the model's own policy version, so there is
    // nothing to save first; an exploratory run binds the live policies.
    needsSave: !usingModel && (policyDirty || !policyVersionId),
    running: latestRun?.status === "running" || latestRun?.status === "queued",
  });
  const runBlockedReason = runGate.reason;

  const validated = useValidatedBaseline({ scenarios, cred, policyHash });
  const [newOpen, setNewOpen] = useState(false);
  const [newStart, setNewStart] = useState<NewScenarioStart>("baseline");
  const newName = uniqueName(
    `Scenario ${scenarios.filter((x) => !isValidationBaseline(x)).length + 1}`,
    scenarios.map((x) => x.name),
  );
  // Inheritance on first render of a never-touched scenario under a validated
  // triple (§2.6) — creation-time inheritance happens in onCreate below.
  const inheritTried = useRef(new Set<string>());
  useEffect(() => {
    if (!selected || !policyVersionId || policyDirty) return;
    if (baselineSelected) return; // Run & Validate owns its settings
    if (selected.inherited_validation_id) return;
    if (selected.warmup_mode !== "auto") return; // hand-set → never override
    if (inheritTried.current.has(selected.id)) return;
    inheritTried.current.add(selected.id);
    void cred.applyIfValidated(selected, policyHash).then((cardId) => {
      if (cardId) toast.message("Warm-up & replications inherited from the model validation.");
    });
  }, [selected, policyVersionId, policyHash, policyDirty, cred, baselineSelected]);

  // WP 10.5 — what a run is bound to. A run of a Validated Model dispatches the
  // model's own policy version, names the model and the engine, and records its
  // deviations from the model's protocol (WP 10.4's `protocol_overrides`, part of
  // the RunKey). An exploratory run binds the live policy version and says so.
  const dispatchRun = async (
    versionId: string,
    forceRerun = false,
    target: { id: string; name: string } & Parameters<typeof protocolDeviations>[1] = selected!,
  ) => {
    if (!projectId || !target) return;
    if (!canRunSimulations) {
      toast.error(projectRights.refusal("simulation_lab") ?? "Running simulations isn't enabled for your account.");
      return;
    }
    try {
      const followModel = usingModel && chosenModel;
      const result = await dispatchExperiment({
        projectId,
        scenarioId: target.id,
        policyVersionId: followModel ? chosenModel!.policy_version_id : versionId,
        acknowledgeWarnings: ackWarnings,
        forceRerun,
        engineId: chosenEngineId,
        actorUserId: user?.id ?? null,
        bytesEstimate: storageEstimate(target.replications, target.horizon_days).bytes,
        ...(followModel
          ? {
              validatedModelId: chosenModel!.id,
              protocolOverrides: overridesOf(protocolDeviations(chosenModel!.protocol, target)),
            }
          : { exploratory: true }),
      });
      if (result.queued) {
        toast.success(
          result.attached
            ? `${target.name} is already running with identical inputs — showing that run`
            : `Queued: ${target.name}`,
        );
        setPane("run");
        return;
      }
      // Reuse-or-rerun (G17 / §9.2 read-path slice): identical completed
      // results exist. Reuse is ALWAYS the user's explicit choice — on reuse
      // the stored run is surfaced (it is this scenario's newest completed
      // run), on re-run we dispatch again with force_rerun.
      if (result.status === "reuse_available" && result.reuseCandidate) {
        const reuse = await confirm(reuseConfirmRequest(result.reuseCandidate));
        if (reuse) {
          toast.success("Reusing the stored run — no recompute needed.");
          setPane("results");
          return;
        }
        await dispatchRun(versionId, true, target);
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
    if (!projectId || !selected) return;
    if (usingModel && chosenModel) {
      await dispatchRun(chosenModel.policy_version_id);
      return;
    }
    if (!policyVersionId || policyDirty) return;
    await dispatchRun(policyVersionId);
  };

  // "Run this model" from the read-only validated baseline: the scenario a run
  // of the model uses is SEEDED FROM THE MODEL (`buildScenarioSeed` with its
  // protocol), found by name if it already exists, so running a model twice does
  // not litter the list — and the second run is then a RunKey reuse.
  const runChosenModel = async () => {
    if (!projectId || !chosenModel || runModelReason) return;
    const name = `${chosenModel.name ?? "Validated model"}${
      chosenModel.version_no != null ? ` v${chosenModel.version_no}` : ""
    } — run`;
    let target = scenarios.find((s) => s.name === name && !isValidationBaseline(s)) ?? null;
    if (!target) {
      target = await create(
        name,
        buildScenarioSeed({
          name,
          world: validated.world,
          baseline: validated.baseline,
          description: `A faithful run of ${modelOptionLabel(chosenModel)}.`,
          protocol: chosenModel.protocol,
        }),
      );
      if (!target) return;
    }
    setSelectedId(target.id);
    await dispatchRun(chosenModel.policy_version_id, false, target);
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
    if (!canRunSimulations) {
      toast.error(projectRights.refusal("simulation_lab") ?? "Running simulations isn't enabled for your account.");
      return;
    }
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
    gate: runGate,
    run: latestRun && {
      status: latestRun.status,
      rep_count_done: latestRun.rep_count_done,
      rep_count_target: latestRun.rep_count_target,
      current: !policyDirty && latestRun.policy_version_id === policyVersionId,
    },
    scenariosWithResults: scenarios.filter((s) => runsByScenario[s.id]).length,
  });

  // The scenario mutations the aside owns, lifted so both trees dispatch the
  // identical call. Every new scenario is seeded from the validated baseline's
  // world (scenarioSeed.ts, §4 D219), so inheritance can match its card.
  const inherit = (s: (typeof scenarios)[number]) => {
    inheritTried.current.add(s.id);
    void cred.applyIfValidated(s, policyHash).then((cardId) => {
      if (cardId) toast.message("Warm-up & replications inherited from the model validation.");
    });
  };
  // "+" asks first (WP 9.4 slice 5) instead of creating "Scenario N" on the spot.
  const createScenario = () => {
    setNewStart("baseline");
    setNewOpen(true);
  };
  const createFromRequest = async (req: NewScenarioRequest) => {
    if (req.start === "stress") {
      const t = STRESS_TESTS.find((p) => p.id === req.presetId);
      if (t) await launchStress(t.scenario, req);
      return;
    }
    const fromBaseline = req.start === "baseline";
    const seed = buildScenarioSeed({
      name: req.name,
      world: fromBaseline ? validated.world : worldOf(null, null),
      baseline: fromBaseline ? validated.baseline : null,
      primary_kpi: req.primary_kpi,
      horizon_days: req.horizon_days,
    });
    const s = await create(req.name, seed);
    if (!s) return;
    if (fromBaseline) inherit(s);
    setSelectedId(s.id);
    setPane("setup");
  };
  const duplicateScenario = async (s: (typeof scenarios)[number]) => {
    // The baseline's copy button starts a new scenario FROM it — through the
    // dialog, so the new one is an experiment in the baseline's world.
    if (isValidationBaseline(s)) {
      setNewStart("baseline");
      setNewOpen(true);
      return;
    }
    const d = await duplicate(s);
    if (d) setSelectedId(d.id);
  };
  const deleteScenario = async (id: string) => {
    await remove(id);
    if (selectedId === id) setSelectedId(null);
  };
  const launchStress = async (
    preset: StressTestPreset,
    opts?: { name?: string; primary_kpi?: string; horizon_days?: number },
  ) => {
    // §4 D172 — a placeholder target never reaches a scenario. `supplier:primary`
    // is resolved here to the project's top-volume supplier (the same weekly
    // normalization the lane ETL applies), and a project that cannot name one
    // gets a refusal with the reason — not a scenario whose event the engine
    // will silently drop, whose run would then present the undisrupted
    // baseline under a stress-test name.
    let schedule = preset.disruption_schedule;
    let description = preset.description;
    if (schedule.some((e) => e.target === RESOLVABLE_PLACEHOLDER)) {
      if (!globalSelectedProjectId) {
        toast.error("Select a project first — the primary supplier is resolved from its inbound lanes.");
        return;
      }
      // The one established read for the lane tables (they are absent from the
      // generated client types; `projectLanes` is the module that owns that
      // fact and the truncation reporting that comes with it).
      const lanes = await fetchProjectLanes(globalSelectedProjectId, user);
      if (lanes.truncated.includes("inbound_logistics")) {
        toast.error(
          "Cannot resolve the primary supplier: the inbound read came back truncated, " +
          "so the largest supplier cannot be named with confidence.",
        );
        return;
      }
      const resolved = resolveStressSchedule(schedule, lanes.inbound);
      if ("error" in resolved) {
        toast.error(`Cannot launch this stress test: ${resolved.error}.`);
        return;
      }
      schedule = resolved.schedule;
      if (resolved.note) description = `${description} ${resolved.note}`;
    }
    const name = opts?.name ?? preset.name;
    const s = await create(
      name,
      buildScenarioSeed({
        name,
        world: validated.world,
        baseline: validated.baseline,
        description,
        disruption_schedule: schedule,
        primary_kpi: opts?.primary_kpi,
        horizon_days: opts?.horizon_days,
      }),
    );
    if (!s) return;
    // Stress scenarios share the baseline world (events are excluded from the
    // fingerprint, §2.3) — they inherit too.
    inherit(s);
    setSelectedId(s.id);
    setPane("recovery");
    toast.success(`Stress test ready: ${preset.name.replace(/^\[Stress\]\s*/, "")}`);
  };

  const runVersion = latestRun?.policy_version_id
    ? policyVersions.find((v) => v.id === latestRun.policy_version_id) ?? null
    : null;
  const runVersionLabel = latestRun?.policy_version_id
    ? (runVersion ? versionDisplayName(runVersion) : latestRun.policy_version_id.slice(0, 8))
    : null;
  // The version in force is the one whose CONTENT is live (WP 10.2, §4 D242) —
  // the same answer /policies gives, so a validated model never reads as missing
  // here just because this page has not saved anything yet.
  const versionText = usingModel && chosenModel
    ? `Validated Model ${modelOptionLabel(chosenModel)}`
    : (!currentPolicyVersion
        ? "Exploratory · unsaved policy edits — they match no saved version"
        : `Exploratory · policy ${versionDisplayName(currentPolicyVersion)}`);

  // WP 10.5 — the run's size before it is dispatched: replication-weeks (what
  // WP 10.7 will meter) and the storage its replications take, with the basis.
  // WP 10.7 — against what the plan leaves: the pool and this member's share,
  // forecast in the dispatcher's own order (the database stays the authority).
  const runSize = selected
    ? (() => {
        const est = storageEstimate(selected.replications, selected.horizon_days);
        const repWeeks = replicationWeeks(selected.replications, selected.horizon_days);
        const verdict = capacityVerdict(capacity, { replications: selected.replications, repWeeks, bytes: est.bytes });
        return {
          line:
            `${selected.replications} replication(s) × ${Math.ceil(selected.horizon_days / 7)} weeks = ` +
            `${repWeeks.toLocaleString()} replication-weeks · ` +
            `expected storage ≈ ${formatBytes(est.bytes)} · ${verdict.line}`,
          refusal: verdict.refusal,
          bytes: est.bytes,
          basis: est.basis,
        };
      })()
    : null;
  const runEstimate = runSize ? (
    <div
      className="rounded-sm border border-[--hair-rule] bg-white px-3 py-[7px] font-mono text-[11.5px] text-[#52525b]"
      title={`storage estimate: ${runSize.basis}`}
      data-testid="run-estimate"
    >
      <p>{runSize.line}</p>
      {runSize.refusal ? (
        <p className="mt-1 font-sans text-[12px] text-[#b45309]" data-testid="run-capacity-refusal">
          Over capacity: {runSize.refusal}.
        </p>
      ) : null}
    </div>
  ) : null;
  // The Settings pane is LOCKED to the model's protocol until "Advanced" is open
  // (the recovery pane — the experiment's own events — never is).
  const settingsLockReason =
    readOnlyReason ??
    (usingModel && !advanced
      ? "Locked to the Validated Model's protocol — open Advanced in the Model step to deviate; a deviation is recorded on the run."
      : null);
  const evidenceModelOf = useMemo(
    () =>
      Object.fromEntries(
        cred.allCards.filter((c) => c.evidence_run_id).map((c) => [c.evidence_run_id as string, c.id]),
      ),
    [cred.allCards],
  );
  const modelStep = projectId ? (
    <LabModelStep
      models={models}
      chosen={chosenModel}
      onChoose={(id) => {
        setChosenModelId(id);
        setAdvanced(false);
      }}
      credibility={modelCredibility}
      exploratory={exploratoryRun}
      onExploratory={setExploratoryRun}
      canExplore={canExplore}
      engines={engines}
      enginesLoading={enginesLoading}
      engineId={chosenEngineId}
      onEngine={setEngineId}
      deviations={deviations}
      advanced={advanced}
      onAdvanced={setAdvanced}
      onRunModel={baselineSelected && usingModel ? runChosenModel : undefined}
      runModelReason={runModelReason}
    />
  ) : null;

  // What capacity this run will use, and whether it is real (§4 D167) — one
  // line with details on demand; the same node on desktop and phone (D224).
  // Beside the gate rather than inside it: a product with no capacity figure is
  // not a finding, but the number it resolves to is max(2·demand, 1000), chosen
  // so capacity never binds, and the run has to say so before it is dispatched.
  // The targets the engine can disrupt besides the plant (disruptionEvents.ts).
  const supplierIds = useMemo(
    () => itemMasters.suppliers.map((s) => s.supplier_id).filter(Boolean),
    [itemMasters.suppliers],
  );
  const uncapacitated = useMemo(
    () =>
      itemMasters.suppliers
        .filter((s) => !(Number(s.capacity_per_week) > 0))
        .map((s) => s.supplier_id),
    [itemMasters.suppliers],
  );
  const capacityLine = (
    <CapacityReadinessPanel
      compact
      products={itemMasters.products}
      suppliers={itemMasters.suppliers}
      outbound={itemMasters.lanes.outbound}
      defaults={policyDefaults}
      overrides={policyOverrides}
    />
  );

  // Below md the desktop rail + aside + pane grid is not reflowed, it is
  // replaced: MobileSimulationLab is the phone composition (PAGES.md 14 · 15).
  // Both trees are fed from the state above, and the branch sits below every
  // hook so hook order is identical on either platform — the rule G5 and G9
  // set and the reason they work.
  if (isMobile) {
    return (
      <PageLayout isCollapsed={isCollapsed} setIsCollapsed={setIsCollapsed}>
        <MobileSimulationLab
          projects={projects as Array<{ id: string; name: string }>}
          projectId={projectId}
          onProjectChange={(v) => setGlobalSelectedProjectId(v || null)}
          scenarios={scenarios}
          scenariosLoading={loading}
          selected={selected}
          selectedId={selectedId}
          credibilityFor={(s) => cred.resolveScenario(policyHash, s)}
          onSelectScenario={setSelectedId}
          onCreateScenario={createScenario}
          onDuplicateScenario={duplicateScenario}
          onDeleteScenario={deleteScenario}
          onBrowseLibrary={() => setLibraryOpen(true)}
          stressCount={STRESS_TESTS.length}
          stressOpen={stressOpen}
          onToggleStress={() => setStressOpen((v) => !v)}
          onLaunchStress={launchStress}
          pane={pane}
          onPane={setPane}
          onSaveScenario={(patch) => selected && !baselineSelected && update(selected.id, patch)}
          projectRecovery={projectRecovery}
          effectiveRecovery={effectiveRecovery}
          policyVersionLabel={
            usingModel && chosenModel
              ? modelOptionLabel(chosenModel)
              : currentPolicyVersion
                ? versionDisplayName(currentPolicyVersion)
                : null
          }
          policyDirty={!usingModel && policyDirty}
          credibility={credibility}
          runCredibility={cred.resolveRun(latestRun)}
          gateFindings={gateFindings}
          gateBlocks={gateBlocks}
          gateWarns={gateWarns}
          ackWarnings={ackWarnings}
          onAckWarnings={setAckWarnings}
          runBlockedReason={runBlockedReason}
          runGate={runGate}
          capacity={capacityLine}
          readOnlyReason={readOnlyReason}
          findingsSource={serverFindings ? "gate rejection" : "pre-run check"}
          supplierIds={itemMasters.suppliers.map((s) => s.supplier_id)}
          latestRun={latestRun}
          reps={reps}
          runVersionLabel={runVersionLabel}
          onRun={handleRun}
          onSaveVersionAndRun={handleSaveVersionAndRun}
          onCancel={handleCancel}
          onAddReps={handleAddReps}
          runsByScenario={runsByScenario}
          compareModelId={usingModel ? chosenModel?.id ?? null : null}
          settingsLockReason={settingsLockReason}
          modelStep={modelStep}
          trainingSet={trainingSet}
          runEstimate={runSize ? runSize.line + (runSize.refusal ? ` · Over capacity: ${runSize.refusal}` : "") : null}
        />
        <NewScenarioDialog
          open={newOpen}
          onOpenChange={setNewOpen}
          defaultName={newName}
          initialStart={newStart}
          hasBaseline={!!validated.baseline || !!validated.card}
          world={validated.world}
          card={validated.card}
          onCreate={createFromRequest}
          onBrowseLibrary={() => setLibraryOpen(true)}
        />
        {projectId && (
          <ScenarioLibraryPanel
            open={libraryOpen}
            projectId={projectId}
            world={validated.world}
            baseline={validated.baseline}
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

  return (
    <PageLayout isCollapsed={isCollapsed} setIsCollapsed={setIsCollapsed}>
      <div className={PAGE_GUTTER}>
        <PageHeader
          title="Simulation Lab"
          rightContent={
            <div className="flex items-center gap-2">
              <Select
                value={projectId || ""}
                onValueChange={(v) => setGlobalSelectedProjectId(v || null)}
              >
                {/* §2.4/G3 Case A: the right slot is `shrink-0` beside a
                    truncating title, so a fixed 200px starves the title at
                    320px. 42vw exceeds 200px from 477px up, which pins the
                    desktop literal without a second breakpoint. The desktop
                    header handoff makes that literal the product-wide project
                    select — 200 × 36 with the `--border-strong` hairline. */}
                <SelectTrigger className={cn('h-11 md:h-9 w-[clamp(130px,42vw,200px)]', HDR_PROJECT_SELECT)}>
                  <SelectValue placeholder="Select project" />
                </SelectTrigger>
                <SelectContent>
                  {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                  {projects.map((p: any) => (
                    <SelectItem key={p.id} value={p.id} className="min-h-11 md:min-h-0">
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          }
        />

        {!projectId ? (
          <div className="rounded-sm border border-[--hair-rule] bg-white px-3 py-[10px] text-[12.5px] text-[--zinc-quiet]">
            No project selected
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {selected ? (
              <StageRail stages={stages} active={pane} onSelect={setPane} gate={gateReadout} />
            ) : null}

            <div className="flex flex-col gap-4 md:flex-row md:items-start">
              <aside className="w-full min-w-0 md:w-64 md:shrink-0">
                <ExperimentLibraryBox
                  count={STRESS_TESTS.length}
                  open={stressOpen}
                  onToggle={() => setStressOpen((v) => !v)}
                />
                {stressOpen ? <StressTestDrawer onLaunch={launchStress} /> : null}
                <SurrogateCard training={trainingSet} />
                <ScenarioList
                  scenarios={scenarios}
                  selectedId={selectedId}
                  loading={loading}
                  credibilityFor={(s) => cred.resolveScenario(policyHash, s)}
                  onSelect={setSelectedId}
                  onBrowseSaved={() => setLibraryOpen(true)}
                  onCreate={createScenario}
                  onDuplicate={duplicateScenario}
                  onDelete={deleteScenario}
                />
              </aside>

              <div className="flex-1 min-w-0 flex flex-col gap-3">
                {modelStep}
                {fromNetwork && (
                  <span className="w-fit rounded-sm bg-[#f0f0f2] px-[7px] py-px text-[11px] text-[#52525b]">
                    from network map
                  </span>
                )}

                {!selected ? (
                  <div className="rounded-sm border border-[--hair-rule] bg-white px-3 py-[10px] text-[12.5px] text-[--zinc-quiet]">
                    No scenario selected
                  </div>
                ) : pane === "setup" ? (
                  <ReadOnlyFrame reason={settingsLockReason}>
                    <ScenarioSetupForm
                      scenario={selected}
                      projectId={projectId}
                      onSave={(patch) => update(selected.id, patch)}
                    />
                  </ReadOnlyFrame>
                ) : pane === "recovery" ? (
                  <ReadOnlyFrame reason={readOnlyReason}>
                    <DisruptionRecoveryPane
                      scenario={selected}
                      projectRecovery={projectRecovery}
                      onSave={(patch) => update(selected.id, patch)}
                      supplierIds={supplierIds}
                      uncapacitated={uncapacitated}
                    />
                  </ReadOnlyFrame>
                ) : pane === "run" ? (
                  <RunCard
                    versionText={versionText}
                    credibility={credibility}
                    gate={runGate}
                    warns={gateWarns}
                    acknowledged={ackWarnings}
                    onAcknowledgedChange={setAckWarnings}
                    findingsCount={gateFindings ? gateFindings.length : null}
                    needsSave={!usingModel && (policyDirty || !policyVersionId)}
                    onRun={handleRun}
                    estimate={runEstimate}
                    onSaveVersionAndRun={handleSaveVersionAndRun}
                    findings={
                      <PreRunValidationPanel
                        projectId={projectId}
                        findings={gateFindings}
                        source={serverFindings ? "gate rejection" : "pre-run check"}
                        acknowledged={ackWarnings}
                        supplierIds={itemMasters.suppliers.map((s) => s.supplier_id)}
                      />
                    }
                    capacity={capacityLine}
                    progress={
                      <RunProgressPanel
                        run={latestRun}
                        reps={reps}
                        versionLabel={runVersionLabel}
                        credibility={cred.resolveRun(latestRun)}
                        onCancel={handleCancel}
                        onAddReps={handleAddReps}
                      />
                    }
                  />
                ) : pane === "results" ? (
                  <ResultsDashboard
                    run={latestRun}
                    reps={reps}
                    primaryKpi={selected.primary_kpi}
                    scenario={selected}
                    credibility={cred.resolveRun(latestRun)}
                  />
                ) : (
                  <CompareScenariosPanel
                    scenarios={scenarios}
                    runsByScenario={runsByScenario}
                    modelId={usingModel ? chosenModel?.id ?? null : null}
                    evidenceModelOf={evidenceModelOf}
                  />
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      <NewScenarioDialog
        open={newOpen}
        onOpenChange={setNewOpen}
        defaultName={newName}
        initialStart={newStart}
        hasBaseline={!!validated.baseline || !!validated.card}
        world={validated.world}
        card={validated.card}
        onCreate={createFromRequest}
        onBrowseLibrary={() => setLibraryOpen(true)}
      />
      {projectId && (
        <ScenarioLibraryPanel
          open={libraryOpen}
          projectId={projectId}
          world={validated.world}
          baseline={validated.baseline}
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
