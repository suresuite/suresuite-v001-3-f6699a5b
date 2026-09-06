// Stage 4 — Run & Validate. 5 ordered sub-steps (§9.5):
//   1. Verification  →  2. Run simulation  →  3. Warm-up detection  →
//   4. Validation  →  5. Adopt
//
// Run-simulation has two tabs (single run / multi-run). Warm-up detection
// has two sub-steps (replication adequacy + warm-up estimation). Validation
// is a CSV upload + KS/Welch comparison panel. Adopt persists the pipeline
// outcome as a model card (model_validations, Phase B0 / G13 / §9.5(6)) bound
// to the provenance triple — the card, not localStorage, is the source of
// truth for the adopted warm-up / target precision; localStorage remains a
// draft cache only. Card content is computed, never asserted — adoption is a
// user action (A3 guardrail, §12).
//
// §9.5.1 law for this surface: everything rendered is persisted engine output
// (run_replications / simulation_runs) — synthetic or illustrative data is
// banned here, even labeled. Pre-run states are empty states.
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip as RTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { ChevronDown, ChevronRight, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  KX_TIGHT,
  LAYER,
  MonoChip,
  Segmented,
  StatusDot,
  SURFACE,
  TD,
  TH,
  Toggle,
  tint,
} from "@/components/intelligence/piUi";
import {
  RAIL,
  RAIL_EYEBROW,
  RAIL_STAGE_ROW_OPEN,
  RAIL_STAGE_ROW_OPEN_STYLE,
  RailChevron,
  RailMarker,
  RailStageCard,
  type RailState,
} from "@/components/sim/StageRail";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import type { StageRow } from "@/hooks/useStageRows";
import { useItemMasters } from "@/hooks/useItemMasters";
import { useDatasetVersion } from "@/hooks/useDatasetVersion";
import { useTimeUnit } from "@/hooks/useTimeUnit";
import { useScenarios } from "@/hooks/useScenarios";
import { useSimulationRun } from "@/hooks/useSimulationRun";
import {
  fetchScenarioFingerprintHash,
  useModelValidation,
  type Credibility,
} from "@/hooks/useModelValidation";
import { CredibilityBadge } from "@/components/sim/CredibilityBadge";
import { verifyProjectPolicies, type Finding } from "@/lib/policies/verification";
import { fieldWalkToRoute } from "@/lib/policies/dataMap";
import { FindingsList } from "./FindingsList";
import {
  cancelBrowserRun,
  EngineCancelledError,
  ensureEngine,
  fetchPolicySnapshot,
  persistEngineResult,
  runInBrowser,
  selfTest,
  type EngineDataset,
  type EngineResult,
  type LoadPhase,
} from "@/lib/sim/pyodideEngine";
import { ksStatistic, welchTTest, welchWarmup, mser5 } from "@/lib/sim/validationStats";
import { ConvergencePlot } from "@/components/sim/ConvergencePlot";
import { ItemSeriesExplorer } from "@/components/sim/ItemSeriesExplorer";
import { ReplicationSeedExplorer } from "@/components/sim/ReplicationSeedExplorer";
import type { Replication, SimulationRun } from "@/hooks/useSimulationRun";
import type { PolicyBundle, FulfillmentStrategy } from "@/lib/policies/schemas";
import type { OverrideRow } from "@/lib/policies/resolve";
import { MappingWarningsCard } from "@/components/sim/RunProgressPanel";
import { RunQueueConsole } from "@/components/sim/RunQueueConsole";

// Runs launched from the policies stage all reuse this single auto-managed
// scenario so the Lab's scenario list doesn't fill up with validation runs.
const VALIDATION_SCENARIO_NAME = "Policy validation (auto)";

interface Props {
  projectId: string | null | undefined;
  plantName: string | null | undefined;
  defaults: PolicyBundle;
  overrides: OverrideRow[];
  fulfillmentStrategy: FulfillmentStrategy;
  saveSnapshot: (label?: string) => Promise<string | null>;
  /** The policy leg of the card's provenance triple (usePolicies): the
   *  selected version and whether live edits have drifted from it. */
  selectedVersionId: string | null;
  policyDirty: boolean;
  /** The lines of each setup stage, loaded once at the page level (the step
   *  track counts them) and verified here. */
  supplierRows: StageRow[];
  plantRows: StageRow[];
  customerRows: StageRow[];
}

// Engine KPI vocabulary (kpi/compute.py::compute_replication_kpis) — every
// option here is a real key on run_replications.kpis. The first five are the
// defaults. Omitted on purpose: produced_value (identical to revenue) and
// ttr/tts/pre_disruption_fill_rate (only present on disruption runs, and
// validation runs are baseline — no disruption schedule).
const KPI_OPTIONS = [
  { id: "fill_rate", label: "Fill rate", unit: "%" },
  { id: "max_backlog", label: "Max backlog", unit: "units" },
  { id: "avg_on_hand_value", label: "On-hand value", unit: "€" },
  { id: "revenue", label: "Revenue", unit: "€" },
  { id: "lost_sales_value", label: "Lost sales", unit: "€" },
  { id: "demand_value", label: "Demand value", unit: "€" },
  { id: "lost_units", label: "Lost units", unit: "units" },
  { id: "lost_inbound_units", label: "Lost inbound units", unit: "units" },
  { id: "capacity_utilization", label: "Capacity utilization", unit: "%" },
  { id: "cost_of_resilience", label: "Cost of resilience", unit: "€" },
  { id: "cost_ss_holding", label: "Cost — safety-stock holding", unit: "€" },
  { id: "cost_backup_premium", label: "Cost — backup premium", unit: "€" },
  { id: "cost_multi_sourcing_premium", label: "Cost — multi-sourcing premium", unit: "€" },
  { id: "cost_expediting", label: "Cost — expediting", unit: "€" },
  { id: "cost_overtime", label: "Cost — overtime", unit: "€" },
  { id: "cost_lost_sales", label: "Cost — lost sales", unit: "€" },
  { id: "cost_allocation_labor", label: "Cost — allocation labor", unit: "€" },
  { id: "cost_fg_ss_holding", label: "Cost — FG safety-stock holding", unit: "€" },
  { id: "cost_backorder_penalty", label: "Cost — backorder penalty", unit: "€" },
  { id: "cost_monitoring", label: "Cost — monitoring", unit: "€" },
] as const;
type KpiId = (typeof KPI_OPTIONS)[number]["id"];

// The per-component cost lines of the financial statement (§9.5.1 step 1b) —
// mirrors scsim core.context.COST_COMPONENTS, persisted as kpis.cost_<name>.
const COST_COMPONENT_OPTIONS = KPI_OPTIONS.filter(
  (k) => k.id.startsWith("cost_") && k.id !== "cost_of_resilience",
);

// The four weekly per-replication series the worker persists on
// run_replications.time_series (scsim engine ProgressFn contract).
const SERIES_CHARTS = [
  { key: "fill_rate", label: "Fill rate", unit: "fraction" },
  { key: "backlog_units", label: "Backlog", unit: "units" },
  { key: "on_hand_value", label: "On-hand value", unit: "€" },
  { key: "revenue_value", label: "Revenue", unit: "€/week" },
] as const;
type SeriesKey = (typeof SERIES_CHARTS)[number]["key"];

// Weekly per-rep series persisted by the worker (run_replications.time_series
// keys) per KPI. lost_sales has no weekly trace → per-rep scalars only.
const SERIES_KEY: Partial<Record<KpiId, SeriesKey>> = {
  fill_rate: "fill_rate",
  max_backlog: "backlog_units",
  avg_on_hand_value: "on_hand_value",
  revenue: "revenue_value",
};

/** Weekly per-rep traces for one persisted time_series key. */
function rawSeries(reps: Replication[], key: SeriesKey): number[][] {
  return reps
    .map((r) => r.time_series?.[key])
    .filter((s): s is number[] => Array.isArray(s) && s.length > 0);
}

/** Weekly per-rep series for a KPI from completed replications. */
function repsSeries(reps: Replication[], kpi: KpiId): number[][] {
  const key = SERIES_KEY[kpi];
  if (!key) return [];
  return rawSeries(reps, key);
}

interface MultiRunCfg {
  seeds_mode: "auto" | "list";
  replications: number;
  seeds_list: string;
  horizon_days: number;
  kpis: KpiId[];
  confidence: number;
}

interface SingleRunCfg {
  seed: number;
  horizon_days: number;
  /** Inspection mode (G17/§9.5.1): raise the engine trace and persist the
   *  per-product / per-material weekly series of this ONE replication. */
  inspection: boolean;
}

interface WarmupCfg {
  warmup_days: number;
  method: "engine" | "welch" | "mser5";
  target_precision: number; // CI half-width as fraction of mean
}

interface IndicatorUpload {
  id: KpiId;
  fileName?: string;
  points?: number;
}

const DEFAULT_SINGLE: SingleRunCfg = { seed: 1, horizon_days: 365, inspection: false };
const DEFAULT_MULTI: MultiRunCfg = {
  seeds_mode: "auto",
  replications: 10,
  seeds_list: "1,2,3,4,5",
  horizon_days: 365,
  kpis: ["fill_rate", "max_backlog"],
  confidence: 0.95,
};
const DEFAULT_WARMUP: WarmupCfg = { warmup_days: 30, method: "engine", target_precision: 0.05 };

const STEPS = [
  { id: "verify", label: "Verification" },
  { id: "run", label: "Run simulation" },
  { id: "warmup", label: "Warm-up detection" },
  { id: "validate", label: "Validation" },
];

function meanCI(values: number[], confidence: number) {
  const n = values.length;
  if (n === 0) return { mean: 0, std: 0, half: 0, n: 0 };
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, n - 1);
  const std = Math.sqrt(variance);
  // z-approximation
  const z = confidence >= 0.99 ? 2.576 : confidence >= 0.95 ? 1.96 : 1.645;
  const half = (z * std) / Math.sqrt(n);
  return { mean, std, half, n };
}

export function RunValidateStage({
  projectId,
  plantName,
  defaults,
  overrides,
  fulfillmentStrategy,
  saveSnapshot,
  selectedVersionId,
  policyDirty,
  supplierRows,
  plantRows,
  customerRows,
}: Props) {
  const itemMasters = useItemMasters(projectId);
  const dataset = useDatasetVersion(projectId);
  const { unit: timeUnit } = useTimeUnit(projectId);
  const { user } = useAuth();
  const modelValidation = useModelValidation(projectId);

  // Reuse the working experiment.run pipeline (same as Simulation Lab): a saved
  // policy version + a scenario bound to the run, dispatched to the Fly worker.
  const { scenarios, create: createScenario, update: updateScenario } = useScenarios(projectId);
  const [validationScenarioId, setValidationScenarioId] = useState<string | null>(null);
  const {
    latestRun: dbRun,
    reps: dbReps,
    history,
    cancelRun,
    addReps,
    loadReps,
    refresh: refreshRuns,
  } = useSimulationRun(validationScenarioId);

  // In-memory result of a run computed by the BROWSER engine (offline
  // fallback). It renders the engine output immediately and independently of
  // the DB round-trip — persistence (which needs the anon-write migrations)
  // is best-effort on top. Server runs never touch this: their rows arrive
  // through the realtime subscription (dbRun/dbReps) and win the ?? below.
  const [localRun, setLocalRun] = useState<SimulationRun | null>(null);
  const [localReps, setLocalReps] = useState<Replication[]>([]);

  // Loud, PERSISTENT run status (not a vanishing toast). This is the single
  // "did it run?" signal the whole redesign is about.
  type RunPhase =
    | { kind: "idle" }
    | { kind: "loading"; detail: string }
    | { kind: "computing"; done?: number; total?: number }
    | { kind: "succeeded"; summary: string; persisted: boolean | null }
    | { kind: "failed"; step: string; message: string };
  const [runPhase, setRunPhase] = useState<RunPhase>({ kind: "idle" });

  // One-click engine self-test (fixed input, no user data / DB).
  const [selfTestState, setSelfTestState] = useState<
    | { kind: "idle" }
    | { kind: "running"; detail: string }
    | { kind: "ok"; fillRate: number; reps: number; version: string }
    | { kind: "fail"; error: string }
  >({ kind: "idle" });

  const loadDetail = (p: LoadPhase): string =>
    p === "loading-runtime"
      ? "Loading simulation runtime (one-time, ~20 MB)…"
      : p === "loading-packages"
      ? "Loading numpy / scipy…"
      : p === "loading-engine"
      ? "Loading the scsim engine…"
      : "Engine ready";

  // Prefer freshly persisted DB output; fall back to the in-memory result.
  const latestRun = dbRun ?? localRun;
  const reps = dbReps.length > 0 ? dbReps : localReps;

  // ── Run-queue console (6.E) ───────────────────────────────────────────────
  // All jobs, newest-first: the persisted history plus, when a browser run
  // hasn't been persisted, the in-memory localRun (so an offline run still
  // shows as its own job row). cancelRun already cancels any run by id.
  const jobs = useMemo<SimulationRun[]>(() => {
    const list = [...history];
    if (localRun && !list.some((r) => r.id === localRun.id)) list.unshift(localRun);
    return list;
  }, [history, localRun]);

  // Which job the inspection dashboard below the queue shows. Null = the
  // latest run (default). "View" on a completed row selects it; its reps are
  // loaded on demand (the realtime path only keeps the latest run's reps hot).
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [selectedReps, setSelectedReps] = useState<Replication[]>([]);
  const inspectedRun = useMemo(
    () => (selectedRunId ? jobs.find((r) => r.id === selectedRunId) ?? latestRun : latestRun),
    [selectedRunId, jobs, latestRun],
  );
  // Reps for the inspected run: reuse the hot latest-run reps when it IS the
  // latest, else the on-demand-loaded set.
  const inspectedReps =
    inspectedRun && inspectedRun.id === latestRun?.id ? reps : selectedReps;

  const onViewRun = (job: SimulationRun) => {
    if (job.id === latestRun?.id) {
      setSelectedRunId(null);
      setSelectedReps([]);
      return;
    }
    setSelectedRunId(job.id);
    setSelectedReps([]);
    void loadReps(job.id).then(setSelectedReps);
  };

  // Cancel one job — the semantics already supported by the stack: a browser
  // run terminates the Pyodide worker; a server run is cancelled by id via
  // experiment.cancel (works for ANY queued/running run, not just the latest).
  const cancelJob = (job: SimulationRun) => {
    const isBrowserInFlight =
      job.id === localRun?.id || (activeRunPath === "browser" && job.id === latestRun?.id);
    if (isBrowserInFlight) cancelBrowserRun();
    if (
      projectId &&
      history.some((r) => r.id === job.id) &&
      (job.status === "queued" || job.status === "running")
    ) {
      void cancelRun(projectId, job.id);
    }
  };
  const cancelAllActive = (active: SimulationRun[]) => active.forEach(cancelJob);

  // Re-attach to the auto-managed validation scenario on mount, so engine
  // output persisted by earlier sessions renders immediately — previously the
  // run panel only appeared after dispatching a fresh run in this session.
  useEffect(() => {
    if (validationScenarioId) return;
    const scen = scenarios.find((s) => s.name === VALIDATION_SCENARIO_NAME);
    if (scen) setValidationScenarioId(scen.id);
  }, [scenarios, validationScenarioId]);

  // ── Real run output (run_replications) — the source for every chart,
  //    warm-up estimate and validation statistic below. ────────────────────
  const doneReps = useMemo(
    () => reps.filter((r) => r.status === "done" && r.kpis),
    [reps],
  );
  /** Per-rep weekly series for a KPI (empty when the worker didn't persist one). */
  const seriesFor = (kpi: KpiId): number[][] => repsSeries(doneReps, kpi);
  /** Fill-rate weekly series — the warm-up estimation basis (engine's too). */
  const frSeries = useMemo(
    () =>
      doneReps
        .map((r) => r.time_series?.fill_rate)
        .filter((s): s is number[] => Array.isArray(s) && s.length > 0),
    [doneReps],
  );
  /** Per-rep scalar sample for a KPI. */
  const scalarSample = (kpi: KpiId): number[] =>
    doneReps.map((r) => Number(r.kpis[kpi])).filter((n) => Number.isFinite(n));
  /** Sim-side sample for validation: steady-state weekly values when a weekly
   *  series exists, else per-rep scalars. */
  const simSample = (kpi: KpiId, warmupWeeks: number): { values: number[]; source: string } => {
    const series = seriesFor(kpi);
    if (series.length > 0) {
      return {
        values: series.flatMap((s) => s.slice(Math.max(0, warmupWeeks))),
        source: "weekly series",
      };
    }
    return { values: scalarSample(kpi), source: "per-rep scalars" };
  };
  const hasRealData = doneReps.length > 0;

  const [step, setStep] = useState(0);
  const [findings, setFindings] = useState<Finding[] | null>(null);
  const [verifiedAt, setVerifiedAt] = useState<Date | null>(null);

  // Run cfg — localStorage is a DRAFT CACHE only (G13): once a model card
  // exists, its adopted warm-up / target precision override these values on
  // load (see the seed effect below); results are never persisted here.
  // v3: KPI ids switched to the engine vocabulary — stale persisted configs
  // with the old fake ids (backorders/throughput/…) must not load.
  const persistKey = `policy.runcfg.v3.${projectId ?? "global"}`;
  const persisted = useMemo(() => {
    if (typeof window === "undefined") return null;
    try {
      const raw = localStorage.getItem(persistKey);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }, [persistKey]);
  const [singleCfg, setSingleCfg] = useState<SingleRunCfg>({ ...DEFAULT_SINGLE, ...(persisted?.single ?? {}) });
  const [multiCfg, setMultiCfg] = useState<MultiRunCfg>({ ...DEFAULT_MULTI, ...(persisted?.multi ?? {}) });
  const [warmCfg, setWarmCfg] = useState<WarmupCfg>({ ...DEFAULT_WARMUP, ...(persisted?.warm ?? {}) });

  // Where the engine computes. "server" (default) dispatches to the Fly
  // worker and lets realtime stream the results in; "browser" is the offline
  // fallback — the same scsim engine via Pyodide in a Web Worker. Long or
  // many-replication studies belong on the server: the browser engine is
  // WASM (2–5× slower, single-threaded) and only exists so a run is always
  // possible with nothing but the static frontend.
  type ComputeMode = "server" | "browser";
  const [computeMode, setComputeMode] = useState<ComputeMode>(
    persisted?.mode === "browser" ? "browser" : "server",
  );
  // Which path the CURRENT run went down (a server-mode click can still fall
  // back to the browser when sim-command is unreachable) — drives status +
  // cancel semantics for the run in flight.
  const [activeRunPath, setActiveRunPath] = useState<ComputeMode | null>(null);
  const [serverRunId, setServerRunId] = useState<string | null>(null);

  // Server runs: the worker owns the compute, realtime owns the data — this
  // effect just mirrors the run row (status / rep_count_done / rep_count_target)
  // into the same loud banner the browser path drives, so "did it run?" reads
  // identically on both paths.
  useEffect(() => {
    if (!serverRunId || !dbRun || dbRun.id !== serverRunId) return;
    if (dbRun.status === "queued") {
      setRunPhase({ kind: "loading", detail: "Queued on the simulation server…" });
    } else if (dbRun.status === "running") {
      setRunPhase({
        kind: "computing",
        done: dbRun.rep_count_done ?? 0,
        total: dbRun.rep_count_target ?? undefined,
      });
    } else if (dbRun.status === "done") {
      const agg = dbRun.aggregate_kpis ?? {};
      const fr = agg.fill_rate != null ? `${(agg.fill_rate * 100).toFixed(1)}%` : "—";
      const rev = agg.revenue != null ? `€${Math.round(agg.revenue).toLocaleString()}` : "—";
      setRunPhase({
        kind: "succeeded",
        summary: `fill rate ${fr} · revenue ${rev} · ${dbRun.rep_count_done} replication(s) · ${dbRun.code_version || "server"} (server)`,
        persisted: true,
      });
    } else if (dbRun.status === "failed") {
      setRunPhase({
        kind: "failed",
        step: "simulation server",
        message: dbRun.error_message ?? "the worker reported a failure — see the run history",
      });
    } else if (dbRun.status === "cancelled") {
      setRunPhase({ kind: "idle" });
    }
  }, [serverRunId, dbRun]);

  useEffect(() => {
    if (!projectId) return;
    try {
      localStorage.setItem(
        persistKey,
        JSON.stringify({ single: singleCfg, multi: multiCfg, warm: warmCfg, mode: computeMode }),
      );
    } catch {
      /* noop */
    }
  }, [persistKey, projectId, singleCfg, multiCfg, warmCfg, computeMode]);

  // Eagerly warm the engine when the user reaches the Run step, so the ~20 MB
  // Pyodide/numpy/scipy first-load overlaps with reading + configuring instead
  // of starting only after the Run click (which felt like a freeze). Only in
  // browser mode — server runs never need the local runtime.
  const [engineWarming, setEngineWarming] = useState(false);
  const [engineWarm, setEngineWarm] = useState(false);
  useEffect(() => {
    if (step !== 1 || computeMode !== "browser" || engineWarm || engineWarming) return;
    let alive = true;
    setEngineWarming(true);
    ensureEngine()
      .then(() => alive && setEngineWarm(true))
      .catch(() => {/* the actual run re-reports any load error loudly */})
      .finally(() => alive && setEngineWarming(false));
    return () => {
      alive = false;
    };
  }, [step, computeMode, engineWarm, engineWarming]);

  const [singleQueuedAt, setSingleQueuedAt] = useState<Date | null>(null);
  const [multiQueuedAt, setMultiQueuedAt] = useState<Date | null>(null);
  const [submitting, setSubmitting] = useState<"single" | "multi" | null>(null);
  const [runTab, setRunTab] = useState<"single" | "multi">("single");
  const [showDiagnostics, setShowDiagnostics] = useState(false);

  // Warm-up
  const [indicators, setIndicators] = useState<IndicatorUpload[]>([]);
  const [warmupComputed, setWarmupComputed] = useState(false);

  // The adopted warm-up cut in weeks — the user-adopted estimate once one is
  // computed, else the engine's detected week. Drawn on every weekly chart.
  const adoptedWarmupWeeks = warmupComputed
    ? Math.round(warmCfg.warmup_days / 7)
    : latestRun?.warmup_detected_at ?? null;

  // Validation
  const [empirical, setEmpirical] = useState<Record<string, { fileName: string; values: number[] }>>({});
  const [validationResult, setValidationResult] = useState<
    Array<{
      kpi: KpiId;
      ks: number;
      ksP: number;
      t: number;
      tP: number;
      n: number;
      source: string;
      pass: boolean;
    }> | null
  >(null);

  // ── Adopt (§9.5 step 6): persist the pipeline outcome as a model card ────
  const [faceAck, setFaceAck] = useState(false);
  const [adopting, setAdopting] = useState(false);

  // The scenario leg of the provenance triple: the validation scenario's
  // baseline fingerprint hash, computed by the ONE canonicalization point
  // (the scenario_fingerprint_hash RPC) — never hashed client-side.
  const [scenarioHash, setScenarioHash] = useState<string | null>(null);
  const validationScenario = scenarios.find((s) => s.id === validationScenarioId) ?? null;
  const validationScenarioUpdatedAt = validationScenario?.updated_at ?? null;
  useEffect(() => {
    if (!validationScenarioId) {
      setScenarioHash(null);
      return;
    }
    let alive = true;
    void fetchScenarioFingerprintHash(validationScenarioId).then((h) => {
      if (alive) setScenarioHash(h);
    });
    return () => {
      alive = false;
    };
  }, [validationScenarioId, validationScenarioUpdatedAt]);

  // Badge derivation (§2.4 of the B0 design): validated / stale / unvalidated
  // computed at read time against the active card — staleness is never stored.
  const liveCredibility = modelValidation.resolve({
    policyVersionId: selectedVersionId,
    policyDirty,
    graphHash: dataset.currentHash,
    scenarioHash,
  });
  // The run panel's badge adds the advisory engine check: a completed run
  // whose code_version differs from the card's evidence fingerprint is stale.
  const runCredibility = modelValidation.resolve({
    policyVersionId: selectedVersionId,
    policyDirty,
    graphHash: dataset.currentHash,
    scenarioHash,
    runCodeVersion: latestRun?.status === "done" ? latestRun.code_version : null,
  });

  // The persisted card — not localStorage — is the source of truth for the
  // adopted warm-up / target precision (G13). Seed the config from the card
  // in force (the resolved one, else the project's latest active card); the
  // localStorage persistence below then only caches the user's draft edits.
  const seedCard =
    liveCredibility.state !== "unvalidated" ? liveCredibility.card : modelValidation.cards[0] ?? null;
  const seededCardId = useRef<string | null>(null);
  useEffect(() => {
    if (!seedCard || seededCardId.current === seedCard.id) return;
    seededCardId.current = seedCard.id;
    setWarmCfg((c) => ({
      ...c,
      warmup_days: seedCard.adopted_warmup_days,
      method: seedCard.warmup_method,
      target_precision: seedCard.replication_basis?.target_precision ?? c.target_precision,
    }));
    setWarmupComputed(true);
  }, [seedCard]);

  const blockCount = useMemo(() => (findings ?? []).filter((f) => f.severity === "block").length, [findings]);
  const warnCount = useMemo(() => (findings ?? []).filter((f) => f.severity === "warn").length, [findings]);

  // Replication adequacy math for the card content (§9.5 step 3): per focal
  // KPI mean ± CI at the chosen confidence and n* = (z·s/(ε·x̄))² — the
  // recommendation Lab scenarios inherit. Computed from real replications.
  const adequacy = useMemo(() => {
    if (doneReps.length === 0 || multiCfg.kpis.length === 0) return null;
    const z = multiCfg.confidence >= 0.99 ? 2.576 : multiCfg.confidence >= 0.95 ? 1.96 : 1.645;
    const perKpi: Record<string, { mean: number; half: number; rel: number; n: number; n_star: number }> = {};
    for (const kpi of multiCfg.kpis) {
      const values = doneReps.map((r) => Number(r.kpis[kpi])).filter((n) => Number.isFinite(n));
      if (values.length === 0) continue;
      const { mean, std, half, n } = meanCI(values, multiCfg.confidence);
      const rel = mean !== 0 ? half / Math.abs(mean) : 0;
      const nStar =
        mean !== 0 && warmCfg.target_precision > 0
          ? Math.max(1, Math.ceil(((z * std) / (warmCfg.target_precision * Math.abs(mean))) ** 2))
          : n;
      perKpi[kpi] = { mean, half, rel, n, n_star: nStar };
    }
    if (Object.keys(perKpi).length === 0) return null;
    const recommended = Math.max(1, ...Object.values(perKpi).map((s) => s.n_star));
    return { perKpi, recommended };
  }, [doneReps, multiCfg.kpis, multiCfg.confidence, warmCfg.target_precision]);

  // Basis (§2.5): statistical when empirical tests actually ran; face
  // validation (explicitly acknowledged) is the Sargent-style fallback when
  // no empirical series exist.
  const testsRan = (validationResult ?? []).filter((r) => r.n > 0);
  const statisticalPass = testsRan.some((r) => r.pass);
  const adoptBasis: "statistical" | "face" = testsRan.length > 0 ? "statistical" : "face";

  const completed = useMemo(() => {
    const s = new Set<number>();
    if (findings !== null && blockCount === 0) s.add(0);
    // Completed replications in the DB are the real evidence; a queued
    // multi-run also counts so the stepper stays responsive while it runs.
    if (multiQueuedAt || hasRealData) s.add(1);
    if (warmupComputed && warmCfg.warmup_days > 0) s.add(2);
    if (validationResult) s.add(3);
    return s;
  }, [findings, blockCount, multiQueuedAt, hasRealData, warmupComputed, warmCfg.warmup_days, validationResult]);

  const canContinue = (i: number): boolean => {
    if (i === 0) return findings !== null && blockCount === 0;
    if (i === 1) return multiQueuedAt !== null || hasRealData;
    if (i === 2) return warmupComputed && warmCfg.warmup_days > 0;
    return true;
  };

  // --- handlers ------------------------------------------------------------
  const onVerify = () => {
    const result = verifyProjectPolicies({
      defaults,
      overrides,
      fulfillmentStrategy,
      supplierRows,
      plantRows,
      customerRows,
      timeUnit: timeUnit ?? null,
      materials: itemMasters.materials,
      products: itemMasters.products,
      suppliers: itemMasters.suppliers,
      inbound: itemMasters.lanes.inbound,
      outbound: itemMasters.lanes.outbound,
      bom: itemMasters.lanes.bom,
      dataReady: !itemMasters.loading && itemMasters.lanes.loaded,
    });
    if (result.status === "loading") {
      // Never grade partial data — this surface once said "all clear" while
      // the server gate (grading the full tables) blocked the dispatch.
      toast.warning("Project data is still loading — try Run checks again in a moment.");
      return;
    }
    const f = result.findings;
    setFindings(f);
    setVerifiedAt(new Date());
    const blockers = f.filter((x) => x.severity === "block").length;
    if (blockers === 0) toast.success(`Verification complete — ${f.length} finding(s).`);
    else toast.error(`Verification found ${blockers} blocker(s).`);
  };

  // Find-or-create the reusable validation scenario, patch it with this run's
  // config (no disruptions = baseline), and return its id.
  const ensureValidationScenario = async (
    patch: { replications: number; seed: number; horizon_days: number; primary_kpi: string },
  ): Promise<string | null> => {
    if (!projectId) return null;
    let scen = scenarios.find((s) => s.name === VALIDATION_SCENARIO_NAME);
    if (!scen) scen = await createScenario(VALIDATION_SCENARIO_NAME);
    if (!scen) return null;
    // Skip the write when nothing changes: a no-op UPDATE still bumps
    // updated_at, which would defeat the §9.2 reuse-or-rerun check (run
    // identity treats "scenario row unchanged since the candidate ran" as
    // the seed-spec/disruption guard).
    const unchanged =
      scen.replications === patch.replications &&
      scen.seed === patch.seed &&
      scen.horizon_days === patch.horizon_days &&
      scen.primary_kpi === patch.primary_kpi &&
      (scen.disruption_schedule ?? []).length === 0 &&
      Object.keys(scen.recovery_overrides ?? {}).length === 0;
    if (!unchanged) {
      await updateScenario(scen.id, {
        ...patch,
        disruption_schedule: [],
        recovery_overrides: {},
      });
    }
    return scen.id;
  };

  // Dispatch through sim-command (the §8.1 validation gate + the queued
  // simulation_runs row), returning the new run_id. In server mode the Fly
  // worker consumes the enqueued command and streams results back over
  // realtime; in browser mode (`computeClient`) sim-command keeps the gate +
  // version-bound run row but does NOT enqueue — this client computes and
  // persists instead, so the two writers never race on one run.
  const dispatchRun = async (
    scenarioId: string,
    policyVersionId: string,
    computeClient = false,
    inspection = false,
    forceRerun = false,
  ): Promise<{ runId: string; reused: boolean }> => {
    const { data, error } = await supabase.functions.invoke("sim-command", {
      body: {
        project_id: projectId,
        scenario_id: scenarioId,
        kind: "experiment.run",
        // Runs from this stage always follow a verification pass in which any
        // warn-level manifest findings were displayed — that is the §8.1
        // acknowledgment the sim-command gate requires for `recommended` gaps.
        payload: {
          policy_version_id: policyVersionId,
          acknowledge_warnings: true,
          ...(computeClient ? { compute: "client" } : {}),
          ...(inspection ? { inspection: true } : {}),
          ...(forceRerun ? { force_rerun: true } : {}),
        },
        client_ts: Date.now(),
      },
    });
    if (!error) {
      const runId = (data as { run_id?: string } | null)?.run_id;
      if (!runId) throw new Error("sim-command did not return a run_id");
      return { runId, reused: false };
    }
    // Reuse-or-rerun (G17 / §9.2 read-path slice): the dispatcher found a
    // completed run with the identical (policy_hash, graph_hash, scenario
    // fingerprint, seed spec) and answers 409 instead of recomputing. Reuse
    // is ALWAYS the user's choice — never silent.
    const reuseCtx = (error as { context?: Response }).context;
    if (reuseCtx?.status === 409 && typeof reuseCtx.json === "function") {
      let reuseBody: {
        reuse_candidate?: {
          run_id: string;
          ended_at?: string | null;
          code_version?: string | null;
          rep_count_done?: number;
        };
      } | null = null;
      try {
        reuseBody = await reuseCtx.clone().json();
      } catch {
        /* fall through to normal error handling */
      }
      const cand = reuseBody?.reuse_candidate;
      if (cand?.run_id) {
        const when = cand.ended_at ? new Date(cand.ended_at).toLocaleString() : "earlier";
        const reuse = window.confirm(
          `Identical results already exist from ${when} ` +
            `(${cand.rep_count_done ?? "?"} replication(s), engine ${cand.code_version || "unknown"}).\n\n` +
            `OK — reuse the stored results (no recompute).\n` +
            `Cancel — re-run the simulation from scratch.`,
        );
        if (reuse) {
          toast.success("Reusing the stored run — no recompute needed.");
          return { runId: cand.run_id, reused: true };
        }
        return dispatchRun(scenarioId, policyVersionId, computeClient, inspection, true);
      }
    }
    // Surface the server's actual response instead of supabase-js's generic
    // "non-2xx" message — a §8.1 gate rejection carries typed findings, and
    // operational failures carry an error string worth reading.
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === "function") {
      let body: {
        error?: unknown;
        validation?: string;
        findings?: Array<{ message: string }>;
      } | null = null;
      try {
        body = await ctx.json();
      } catch {
        /* non-JSON body — fall through to the status line */
      }
      if (body?.validation) {
        const lines = (body.findings ?? []).slice(0, 4).map((f) => f.message).join(" · ");
        throw new Error(
          `run rejected by the required-data gate (${body.validation}): ${lines || "see verification step"}`,
        );
      }
      if (body?.error) {
        const msg = typeof body.error === "string" ? body.error : JSON.stringify(body.error);
        throw new Error(`sim-command HTTP ${ctx.status}: ${msg.slice(0, 300)}`);
      }
      throw new Error(
        `sim-command HTTP ${ctx.status} — check the function logs in the Supabase dashboard ` +
        `(a 503 boot error means a stale/broken function version is deployed)`,
      );
    }
    throw error;
  };

  /** The dataset the serverless engine needs — exactly the rows the hooks
   *  already loaded (via the SECURITY DEFINER lane RPC + item masters), so no
   *  new DB reads and no RLS surface. */
  const engineDataset = (): EngineDataset => ({
    suppliers: itemMasters.suppliers as unknown as Record<string, unknown>[],
    materials: itemMasters.materials as unknown as Record<string, unknown>[],
    products: itemMasters.products as unknown as Record<string, unknown>[],
    inbound: itemMasters.lanes.inbound,
    bom: itemMasters.lanes.bom,
    outbound: itemMasters.lanes.outbound,
  });

  // Full run: gate + queued row via sim-command, then compute on the
  // serverless engine and persist the result. Returns nothing; the run panel
  // updates over realtime as rows land.
  // Build the v2 snapshot the engine consumes directly from the current
  // defaults/overrides/strategy — the reproducible fallback when the saved
  // policy_versions row can't be read (e.g. anon read blocked).
  const buildClientSnapshot = (): Record<string, unknown> => ({
    schema_version: 2,
    defaults: defaults as unknown as Record<string, unknown>,
    fulfillment_strategy: fulfillmentStrategy,
    overrides: overrides.map((o) => ({
      scope: o.scope,
      target_key: o.target_key,
      family: o.family,
      patch: o.patch,
    })),
  });

  // Full run, two compute paths behind the toggle:
  //   • server (default) — dispatch via sim-command and STOP: the Fly worker
  //     is the sole writer of results, and the realtime subscription streams
  //     the run row + replications into the panels (dbRun/dbReps already win
  //     over local state). Nothing is computed in this tab.
  //   • browser (offline fallback, or auto-fallback when sim-command is
  //     unreachable) — best-effort gate + run row, then compute the REAL
  //     engine in the browser (Pyodide), render immediately, persist
  //     best-effort. Only hard dependency: the static frontend.
  const runValidationScenario = async (
    scenarioId: string,
    versionId: string | null,
    scenario: { seed: number; horizon_days: number; replications: number; inspection?: boolean },
  ) => {
    setValidationScenarioId(scenarioId);
    const inspection = scenario.inspection === true && scenario.replications === 1;

    // ── Server path ─────────────────────────────────────────────────────
    // Server mode NEVER silently computes in the browser: the whole point of
    // "Run on server" is that the run executes on the Fly worker, so a
    // dispatch failure fails loudly (with the real reason) instead of quietly
    // producing browser numbers the user thinks came from the server. The
    // browser engine is reached only by explicitly choosing "Run in browser
    // (offline)".
    if (computeMode === "server") {
      // The worker path needs a real scenario row + saved policy version
      // (sim-command rejects otherwise). If either save failed, that's a
      // hard stop in server mode — not a reason to switch engines behind the
      // user's back.
      if (!versionId || scenarioId.startsWith("local:")) {
        setRunPhase({
          kind: "failed",
          step: "server dispatch",
          message:
            "Could not save the policy snapshot / scenario needed to run on the server. " +
            "Check your connection and try again, or switch to “Run in browser (offline)”.",
        });
        throw new Error("server run not eligible: policy snapshot or scenario could not be saved");
      }
      try {
        setRunPhase({ kind: "loading", detail: "Dispatching to the simulation server…" });
        const { runId, reused } = await dispatchRun(scenarioId, versionId, false, inspection);
        // Clear any previous browser run so stale local rows can't shadow
        // the incoming realtime rows while rep_count_done is still 0.
        setLocalRun(null);
        setLocalReps([]);
        setActiveRunPath("server");
        setServerRunId(runId);
        if (reused) {
          // §9.2 read-path slice: the user chose to reuse the stored run —
          // surface it (it is this scenario's newest completed run) instead
          // of waiting on realtime events that will never come.
          await refreshRuns();
          return;
        }
        setRunPhase({ kind: "loading", detail: "Queued on the simulation server…" });
        return; // realtime drives the UI from here (see the status effect)
      } catch (err) {
        const msg = (err as Error).message ?? String(err);
        const step = msg.includes("required-data gate") ? "validation gate" : "server dispatch";
        setRunPhase({ kind: "failed", step, message: msg });
        throw err; // no browser fallback in server mode
      }
    }

    // ── Browser path (offline / fallback) ───────────────────────────────
    setActiveRunPath("browser");
    setServerRunId(null);

    // Step 1 — gate + run row (best-effort; a client UUID keeps us going if
    // sim-command is unavailable, so "see it run" never depends on it).
    // compute:"client" keeps the deployed worker out of this run.
    let runId: string;
    let snapshot: Record<string, unknown> | null = null;
    if (versionId) {
      try {
        const dispatched = await dispatchRun(scenarioId, versionId, true, inspection);
        if (dispatched.reused) {
          // The user chose to reuse the stored run — surface it, skip compute.
          setActiveRunPath("server");
          setServerRunId(dispatched.runId);
          await refreshRuns();
          return;
        }
        runId = dispatched.runId;
        snapshot = await fetchPolicySnapshot(versionId);
      } catch (err) {
        // A hard gate rejection (missing required data) must still stop the run.
        const msg = (err as Error).message ?? String(err);
        if (msg.includes("required-data gate")) {
          setRunPhase({ kind: "failed", step: "validation gate", message: msg });
          throw err;
        }
        console.warn("sim-command unavailable, running unbound:", msg);
        runId = crypto.randomUUID();
      }
    } else {
      runId = crypto.randomUUID();
    }
    if (!snapshot) snapshot = buildClientSnapshot();

    // Step 2 — compute the real engine in the browser (off-thread worker).
    // Show a preliminary "running" panel so the per-rep grid renders empty and
    // fills in live; clear any prior run's reps first.
    setRunPhase({ kind: "loading", detail: loadDetail("loading-runtime") });
    setLocalReps([]);
    setLocalRun(preliminaryRun(runId, scenarioId, projectId!, scenario.replications));
    let result: EngineResult;
    try {
      result = await runInBrowser(
        {
          runId,
          projectId: projectId!,
          snapshot,
          scenario: { ...scenario, crn: true },
          projectModel: fulfillmentStrategy,
          dataset: engineDataset(),
        },
        (p) => setRunPhase(p === "ready" ? { kind: "computing", done: 0, total: scenario.replications } : { kind: "loading", detail: loadDetail(p) }),
        // Live per-replication streaming — each finished rep lands in the grid.
        (rep, done, total) => {
          const mapped = engineRepToReplication(runId, rep);
          setLocalReps((cur) => {
            const next = cur.filter((r) => r.rep_index !== mapped.rep_index);
            next.push(mapped);
            next.sort((a, b) => a.rep_index - b.rep_index);
            return next;
          });
          setLocalRun((r) => (r ? { ...r, rep_count_done: done, rep_count_target: total } : r));
          setRunPhase({ kind: "computing", done, total });
        },
      );
    } catch (err) {
      if (err instanceof EngineCancelledError) {
        setRunPhase({ kind: "idle" });
        setLocalRun((r) => (r ? { ...r, status: "cancelled" } : r));
        throw err;
      }
      setRunPhase({ kind: "failed", step: "engine", message: (err as Error).message ?? String(err) });
      throw err;
    }

    // Step 3 — render the authoritative final result from memory.
    setLocalRun(engineResultToRun(runId, scenarioId, projectId!, result));
    setLocalReps(engineResultToReps(result));

    // Step 4 — persist best-effort; surface the outcome (never silent).
    const persisted = await persistEngineResult(runId, projectId!, result);

    const agg = (result.runUpdate.aggregate_kpis as Record<string, number>) ?? {};
    const fr = agg.fill_rate != null ? `${(agg.fill_rate * 100).toFixed(1)}%` : "—";
    const rev = agg.revenue != null ? `€${Math.round(agg.revenue).toLocaleString()}` : "—";
    setRunPhase({
      kind: "succeeded",
      summary: `fill rate ${fr} · revenue ${rev} · ${result.replications.length} replication(s) · scsim ${result.engineVersion}`,
      persisted,
    });
  };

  const onSelfTest = async () => {
    setSelfTestState({ kind: "running", detail: loadDetail("loading-runtime") });
    const r = await selfTest((p) =>
      setSelfTestState({ kind: "running", detail: loadDetail(p) }),
    );
    if (r.ok) {
      const fill = r.fillRate ?? NaN;
      setSelfTestState({ kind: "ok", fillRate: fill, reps: r.reps ?? 0, version: r.engineVersion ?? "scsim" });
      toast.success(`Engine works in your browser — scsim ${r.engineVersion ?? ""}, fill rate ${(fill * 100).toFixed(1)}%`);
    } else {
      const err = r.error ?? "unknown error";
      setSelfTestState({ kind: "fail", error: err });
      toast.error(`Engine self-test failed: ${err}`);
    }
  };

  const onRunSingle = async () => {
    if (!projectId || findings === null || blockCount > 0) {
      toast.warning("Run verification with no blockers first.");
      return;
    }
    setSubmitting("single");
    try {
      // saveSnapshot / scenario are best-effort — a run must not be blocked by
      // a DB write; it computes in the browser regardless.
      const versionId = await saveSnapshot(`Validate single — ${new Date().toLocaleString()}`);
      const scenarioId =
        (await ensureValidationScenario({
          replications: 1,
          seed: singleCfg.seed,
          horizon_days: singleCfg.horizon_days,
          primary_kpi: "fill_rate",
        })) ?? `local:${projectId}`;
      setSingleQueuedAt(new Date());
      await runValidationScenario(scenarioId, versionId, {
        seed: singleCfg.seed,
        horizon_days: singleCfg.horizon_days,
        replications: 1,
        inspection: singleCfg.inspection,
      });
    } catch (err) {
      setSingleQueuedAt(null);
      if (err instanceof EngineCancelledError) {
        toast.message("Run cancelled.");
      } else {
        console.error(err);
        toast.error(`Run failed: ${(err as Error).message ?? err}`);
      }
    } finally {
      setSubmitting(null);
    }
  };

  const onRunMulti = async () => {
    if (!projectId || findings === null || blockCount > 0) {
      toast.warning("Run verification with no blockers first.");
      return;
    }
    if (multiCfg.kpis.length === 0) {
      toast.warning("Select at least one focal KPI.");
      return;
    }
    setSubmitting("multi");
    try {
      const seeds =
        multiCfg.seeds_mode === "auto"
          ? Array.from({ length: multiCfg.replications }, (_, i) => i + 1)
          : multiCfg.seeds_list.split(/[\s,]+/).map((s) => parseInt(s, 10)).filter((n) => !Number.isNaN(n));
      if (seeds.length === 0) {
        toast.warning("Provide at least one seed.");
        return;
      }
      const versionId = await saveSnapshot(`Validate ×${seeds.length} — ${new Date().toLocaleString()}`);
      const scenarioId =
        (await ensureValidationScenario({
          replications: seeds.length,
          seed: seeds[0],
          horizon_days: multiCfg.horizon_days,
          primary_kpi: multiCfg.kpis[0],
        })) ?? `local:${projectId}`;
      setMultiQueuedAt(new Date());
      await runValidationScenario(scenarioId, versionId, {
        seed: seeds[0],
        horizon_days: multiCfg.horizon_days,
        replications: seeds.length,
      });
    } catch (err) {
      setMultiQueuedAt(null);
      if (err instanceof EngineCancelledError) {
        toast.message("Run cancelled.");
      } else {
        console.error(err);
        toast.error(`Run failed: ${(err as Error).message ?? err}`);
      }
    } finally {
      setSubmitting(null);
    }
  };

  // Warm-up from REAL run output: the engine's adopted week, or Welch/MSER-5
  // computed client-side from the persisted weekly fill-rate series.
  const detectWarmup = () => {
    if (!hasRealData) {
      toast.warning("Run replications first — warm-up is detected from real run output.");
      return;
    }
    let weeks: number | null = null;
    let label = warmCfg.method;
    if (warmCfg.method === "engine") {
      weeks = latestRun?.warmup_detected_at ?? null;
      if (weeks == null && frSeries.length > 0) {
        weeks = welchWarmup(frSeries);
        label = "welch";
        toast.message("Engine warm-up not recorded on this run — used Welch instead.");
      }
    } else if (frSeries.length > 0) {
      weeks = warmCfg.method === "welch" ? welchWarmup(frSeries) : mser5(frSeries);
    }
    if (weeks == null) {
      toast.warning("No weekly series on this run — cannot estimate warm-up.");
      return;
    }
    const days = Math.round(weeks * 7);
    setWarmCfg((c) => ({ ...c, warmup_days: days }));
    setWarmupComputed(true);
    toast.success(`Warm-up via ${label}: week ${weeks} (${days} days) — from ${doneReps.length} replication(s).`);
  };

  const onIndicatorFile = async (id: KpiId, file: File | null) => {
    if (!file) return;
    try {
      const text = await file.text();
      const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      const points = lines.length > 0 && /[a-z]/i.test(lines[0]) ? lines.length - 1 : lines.length;
      setIndicators((cur) => {
        const found = cur.find((x) => x.id === id);
        if (found) return cur.map((x) => (x.id === id ? { ...x, fileName: file.name, points } : x));
        return [...cur, { id, fileName: file.name, points }];
      });
      toast.success(`Loaded ${points} points for ${id}`);
    } catch (err) {
      console.error(err);
      toast.error("Failed to read file");
    }
  };

  const onEmpiricalFile = async (kpi: KpiId, file: File | null) => {
    if (!file) return;
    const text = await file.text();
    const values = text
      .split(/\r?\n/)
      .map((l) => l.split(/[,;\t]/).pop()?.trim() ?? "")
      .map((s) => parseFloat(s))
      .filter((n) => !Number.isNaN(n));
    setEmpirical((cur) => ({ ...cur, [kpi]: { fileName: file.name, values } }));
    toast.success(`Loaded ${values.length} empirical points for ${kpi}`);
  };

  // Real two-sample tests: uploaded empirical values vs the run's persisted
  // output (steady-state weekly fill-rate, or per-rep scalars for the rest).
  const runValidation = () => {
    if (!hasRealData) {
      toast.warning("Run replications first — validation compares against real run output.");
      return;
    }
    const warmupWeeks = Math.round(warmCfg.warmup_days / 7);
    const kpis = multiCfg.kpis;
    const results = kpis.map((kpi) => {
      const emp = empirical[kpi];
      if (!emp || emp.values.length < 5) {
        return { kpi, ks: NaN, ksP: NaN, t: NaN, tP: NaN, n: 0, source: "—", pass: false };
      }
      const sim = simSample(kpi, warmupWeeks);
      if (sim.values.length < 2) {
        return { kpi, ks: NaN, ksP: NaN, t: NaN, tP: NaN, n: 0, source: sim.source, pass: false };
      }
      const ks = ksStatistic(emp.values, sim.values);
      const tt = welchTTest(emp.values, sim.values);
      const pass = ks.p >= 0.05 && tt.p >= 0.05;
      return {
        kpi,
        ks: Number(ks.d.toFixed(3)),
        ksP: Number(ks.p.toFixed(3)),
        t: Number(tt.t.toFixed(3)),
        tP: Number(tt.p.toFixed(3)),
        n: sim.values.length,
        source: sim.source,
        pass,
      };
    });
    setValidationResult(results);
    const passing = results.filter((r) => r.pass).length;
    toast.success(
      `Validation done against ${doneReps.length} replication(s): ${passing}/${results.length} KPIs passed.`,
    );
  };

  // Adoption readiness (§2.5): steps 1–4 green, or 1–3 plus the explicit
  // face-validation acknowledgment when no empirical series were uploaded.
  const adoptReady =
    !!projectId &&
    findings !== null &&
    blockCount === 0 &&
    hasRealData &&
    adequacy !== null &&
    warmupComputed &&
    warmCfg.warmup_days > 0 &&
    !!validationScenarioId &&
    (statisticalPass || (testsRan.length === 0 && faceAck));

  // "Mark model valid" (§2.5): snapshot the exact policy + dataset, then
  // persist the card through record_model_validation. Everything on the card
  // is computed above from persisted run output — nothing is asserted (A3).
  const onMarkValid = async () => {
    if (!projectId || !validationScenarioId || !adequacy) return;
    setAdopting(true);
    try {
      // 1 — the exact policy snapshot (save first if live edits drifted)
      const versionId =
        policyDirty || !selectedVersionId
          ? await saveSnapshot("Validated model")
          : selectedVersionId;
      if (!versionId) throw new Error("could not save the policy snapshot");
      // 2 — the exact world (dedup-or-insert dataset snapshot, §8.4)
      const datasetVersionId = await dataset.snapshot();
      if (!datasetVersionId) throw new Error("could not snapshot the dataset");
      // 3 — the card (supersedes the same-triple active card server-side)
      await modelValidation.record({
        projectId,
        policyVersionId: versionId,
        datasetVersionId,
        scenarioId: validationScenarioId,
        adoptedWarmupDays: warmCfg.warmup_days,
        warmupMethod: warmCfg.method,
        recommendedReplications: adequacy.recommended,
        replicationBasis: {
          confidence: multiCfg.confidence,
          target_precision: warmCfg.target_precision,
          per_kpi: adequacy.perKpi,
        },
        validationTests: testsRan.map((r) => ({
          kpi: r.kpi,
          ks: r.ks,
          ks_p: r.ksP,
          t: r.t,
          t_p: r.tP,
          n: r.n,
          source: r.source,
          pass: r.pass,
        })),
        findings: findings ?? [],
        verdict: "validated",
        basis: adoptBasis,
        // Evidence must be drillable: only a run row that exists in the DB
        // qualifies (an unpersisted browser run would break the FK).
        evidenceRunId: dbRun?.id ?? null,
        userId: user?.id ?? null,
        userEmail: user?.email ?? null,
      });
      // Re-read the scenario fingerprint so the badge flips without waiting
      // on the next realtime tick.
      void fetchScenarioFingerprintHash(validationScenarioId).then(setScenarioHash);
      toast.success("Model card recorded — Lab scenarios can now inherit this validation.");
    } catch (err) {
      console.error(err);
      toast.error(`Adoption failed: ${(err as Error).message ?? err}`);
    } finally {
      setAdopting(false);
    }
  };

  // --- render --------------------------------------------------------------
  const stepMeta = (i: number): { text: string; blocked?: boolean } => {
    if (i === 0)
      return findings === null
        ? { text: "not run" }
        : blockCount > 0
          ? { text: `${blockCount} blocker(s)`, blocked: true }
          : { text: `${findings.length} finding(s)` };
    if (i === 1)
      return hasRealData
        ? { text: `${doneReps.length} replication(s)` }
        : { text: "no run yet" };
    if (i === 2)
      return warmupComputed && warmCfg.warmup_days > 0
        ? { text: `${warmCfg.warmup_days} days · ${warmCfg.method}` }
        : { text: "not detected", blocked: hasRealData };
    if (i === 3)
      return validationResult
        ? { text: `${testsRan.filter((r) => r.pass).length}/${testsRan.length} passed` }
        : { text: "not run" };
    return { text: liveCredibility.state };
  };

  const doneCount = completed.size;

  return (
    <div className="flex flex-col gap-2.5">
      {/* Section D as a band — the sim-lab surface, zinc ramp. */}
      <div className={RAIL_STAGE_ROW_OPEN} style={RAIL_STAGE_ROW_OPEN_STYLE}>
        <div className="flex w-[192px] shrink-0 flex-col justify-center gap-[3px] pr-2.5">
          <span className="flex items-center gap-[7px]">
            <RailMarker>D</RailMarker>
            <span className={RAIL_EYEBROW} style={{ color: RAIL.zinc.body }}>
              Run &amp; validate
            </span>
          </span>
          <span className="font-mono text-[11px] tabular-nums" style={{ paddingLeft: 23 }}>
            <b className="font-medium" style={{ color: RAIL.zinc.ink }}>
              {doneCount}
            </b>
            <span style={{ color: RAIL.zinc.quiet }}> / {STEPS.length} done</span>
          </span>
        </div>

        <div className="flex min-w-0 flex-1 items-stretch gap-[10px]">
          {STEPS.map((s, i) => {
            const meta = stepMeta(i);
            const done = completed.has(i);
            const state: RailState = step === i ? "current" : done ? "done" : "todo";
            return (
              <React.Fragment key={s.id}>
                {i > 0 ? <RailChevron palette="zinc" /> : null}
                <RailStageCard
                  palette="zinc"
                  state={state}
                  needsSetup={!done && meta.blocked}
                  numeral={String(i + 1)}
                  label={s.label}
                  sub={meta.text}
                  onSelect={() => setStep(i)}
                  title={`${s.label} — ${meta.text}`}
                />
              </React.Fragment>
            );
          })}
        </div>
      </div>

      <>
        {/* 1 — VERIFICATION */}
        {step === 0 && (
          <StepShell
            index={0}
            title="Verification"
            action={
              <Button size="sm" className="h-[26px] px-2.5 text-[11.5px]" onClick={onVerify}>
                Run checks
              </Button>
            }
          >
            <div className="flex flex-wrap items-center gap-2 font-mono text-[11px] text-muted-foreground">
              <span className={KX_TIGHT}>Dataset</span>
              <span className="text-foreground">{dataset.currentHash?.slice(0, 8) ?? "—"}</span>
              <MonoChip>
                {dataset.neverSnapshotted
                  ? "not snapshotted"
                  : dataset.isDirty
                    ? "changed since snapshot"
                    : "up to date"}
              </MonoChip>
              <span className={KX_TIGHT}>Credibility</span>
              <CredibilityBadge credibility={liveCredibility} />
              {liveCredibility.state === "validated" && (
                <span>
                  card {liveCredibility.card.id.slice(0, 8)} ·{" "}
                  {new Date(liveCredibility.card.validated_at).toLocaleDateString()}
                </span>
              )}
              {verifiedAt && <span>verified {verifiedAt.toLocaleTimeString()}</span>}
            </div>
            {findings !== null && (
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center gap-2.5 font-mono text-[11px] text-muted-foreground">
                  <span className="inline-flex items-center gap-1.5">
                    <StatusDot ok={blockCount === 0} />
                    {findings.length} finding(s)
                  </span>
                  {blockCount > 0 && (
                    <span style={{ color: LAYER.brand }}>{blockCount} blocker(s)</span>
                  )}
                  {warnCount > 0 && (
                    <span style={{ color: LAYER.firm }}>{warnCount} warning(s)</span>
                  )}
                </div>
                {findings.length > 0 && (
                  <FindingsList
                    findings={findings}
                    className="max-h-60"
                    walkTo={(f) => (f.field ? fieldWalkToRoute(f.field, projectId) : null)}
                  />
                )}
              </div>
            )}
          </StepShell>
        )}

        {/* 2 — RUN SIMULATION */}
        {step === 1 && (
          <StepShell
            index={1}
            title="Run simulation"
            action={
              <Segmented<ComputeMode>
                size="sm"
                value={computeMode}
                onChange={setComputeMode}
                options={[
                  { value: "server", label: "server", title: "Compute on the simulation server" },
                  { value: "browser", label: "browser", title: "Offline fallback — the same engine, locally" },
                ]}
              />
            }
          >
            {/* Diagnostics: engine self-test + build marker. Real signals, but
                not model evidence — collapsed so the step reads as engine
                output only (§9.5.1). */}
            <button
              type="button"
              onClick={() => setShowDiagnostics((v) => !v)}
              className="flex items-center gap-1 self-start font-mono text-[10.5px] text-muted-foreground transition-colors hover:text-foreground"
            >
              {showDiagnostics ? (
                <ChevronDown className="h-3 w-3" />
              ) : (
                <ChevronRight className="h-3 w-3" />
              )}
              diagnostics
            </button>
            {showDiagnostics && (
            <div className={cn(SURFACE, "flex flex-wrap items-center gap-2 px-2.5 py-1.5")}>
              <Button size="sm" variant="outline" className="h-[24px] px-2.5 text-[11px]"
                onClick={onSelfTest} disabled={selfTestState.kind === "running"}>
                {selfTestState.kind === "running" ? "Testing…" : "Test engine"}
              </Button>
              {selfTestState.kind === "running" && (
                <span className="font-mono text-[11px] text-muted-foreground">{selfTestState.detail}</span>
              )}
              {selfTestState.kind === "ok" && (
                <span className="inline-flex items-center gap-1.5 font-mono text-[11px]">
                  <StatusDot ok /> scsim {selfTestState.version} · fill rate{" "}
                  {(selfTestState.fillRate * 100).toFixed(1)}% · {selfTestState.reps} reps
                </span>
              )}
              {selfTestState.kind === "fail" && (
                <span className="inline-flex items-center gap-1.5 font-mono text-[11px]" style={{ color: LAYER.brand }}>
                  <StatusDot /> {selfTestState.error}
                </span>
              )}
              {selfTestState.kind === "idle" && engineWarming && (
                <span className="inline-flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
                  <StatusDot pending /> preparing engine…
                </span>
              )}
              {selfTestState.kind === "idle" && engineWarm && (
                <span className="inline-flex items-center gap-1.5 font-mono text-[11px]">
                  <StatusDot ok /> engine ready
                </span>
              )}
              <span className="ml-auto font-mono text-[10px] text-[#c4c4c4]" title="Deployed build">
                build {String(__BUILD_SHA__)} · {String(__BUILD_TIME__)}
              </span>
            </div>
            )}

            {runPhase.kind !== "idle" && <RunStatusBanner phase={runPhase} />}

            <Tabs value={runTab} onValueChange={(v) => setRunTab(v as "single" | "multi")} className="w-full">
              <TabsList className="grid h-8 w-full grid-cols-2">
                <TabsTrigger value="single" className="text-[11.5px]">
                  Single run
                  {singleQueuedAt && <MonoChip className="ml-1.5">queued</MonoChip>}
                </TabsTrigger>
                <TabsTrigger value="multi" className="text-[11.5px]">
                  Multiple runs
                  {multiQueuedAt && <MonoChip className="ml-1.5">queued</MonoChip>}
                </TabsTrigger>
              </TabsList>

              <TabsContent value="single" className="mt-2.5 flex flex-col gap-2.5">
                <div className="flex flex-wrap items-end gap-[18px]">
                  <Field label="Seed">
                    <Input
                      type="number"
                      className="h-6 w-[94px] text-right font-mono text-[11.5px] tabular-nums"
                      value={singleCfg.seed}
                      onChange={(e) => setSingleCfg((c) => ({ ...c, seed: parseInt(e.target.value, 10) || 1 }))}
                    />
                  </Field>
                  <Field label="Horizon (days)">
                    <Input
                      type="number"
                      className="h-6 w-[94px] text-right font-mono text-[11.5px] tabular-nums"
                      value={singleCfg.horizon_days}
                      onChange={(e) => setSingleCfg((c) => ({ ...c, horizon_days: parseInt(e.target.value, 10) || 1 }))}
                    />
                  </Field>
                  {/* Inspection mode (G17/§9.5.1 — W3): opt-in per-item evidence
                      for this ONE replication at the chosen seed. */}
                  <Field label="Inspection mode">
                    <Toggle
                      checked={singleCfg.inspection}
                      onChange={(v) => setSingleCfg((c) => ({ ...c, inspection: v }))}
                      label="per-item weekly series"
                    />
                  </Field>
                  <Button
                    size="sm"
                    className="h-[26px] px-2.5 text-[11.5px]"
                    onClick={onRunSingle}
                    disabled={submitting === "single"}
                  >
                    {submitting === "single" ? "Queueing…" : singleQueuedAt ? "Re-run single" : "Run single"}
                  </Button>
                </div>
              </TabsContent>

              <TabsContent value="multi" className="mt-2.5 flex flex-col gap-2.5">
                <div className="grid grid-cols-1 gap-2.5 lg:grid-cols-[320px_minmax(0,1fr)]">
                  {/* Setup card (compact, fixed width on desktop) */}
                  <div className={cn(SURFACE, "flex flex-col gap-2.5 p-2.5")}>
                    <span className={KX_TIGHT}>Setup</span>
                    <Field label="Seeds">
                      <div className="flex items-center gap-2">
                        <Select
                          value={multiCfg.seeds_mode}
                          onValueChange={(v) => setMultiCfg((c) => ({ ...c, seeds_mode: v as MultiRunCfg["seeds_mode"] }))}
                        >
                          <SelectTrigger className="h-6 w-20 font-mono text-[11px]"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="auto">auto</SelectItem>
                            <SelectItem value="list">list</SelectItem>
                          </SelectContent>
                        </Select>
                        {multiCfg.seeds_mode === "auto" ? (
                          <Input
                            type="number"
                            min={1}
                            className="h-6 flex-1 text-right font-mono text-[11.5px] tabular-nums"
                            value={multiCfg.replications}
                            onChange={(e) => setMultiCfg((c) => ({ ...c, replications: parseInt(e.target.value, 10) || 1 }))}
                          />
                        ) : (
                          <Input
                            className="h-6 flex-1 font-mono text-[11.5px]"
                            placeholder="1,2,3,4,5"
                            value={multiCfg.seeds_list}
                            onChange={(e) => setMultiCfg((c) => ({ ...c, seeds_list: e.target.value }))}
                          />
                        )}
                      </div>
                    </Field>
                    <Field label="Simulation time (days)">
                      <Input
                        type="number"
                        className="h-6 w-[94px] text-right font-mono text-[11.5px] tabular-nums"
                        value={multiCfg.horizon_days}
                        onChange={(e) => setMultiCfg((c) => ({ ...c, horizon_days: parseInt(e.target.value, 10) || 1 }))}
                      />
                    </Field>
                    <Field label="Confidence">
                      <Segmented<string>
                        size="sm"
                        value={String(multiCfg.confidence)}
                        onChange={(v) => setMultiCfg((c) => ({ ...c, confidence: parseFloat(v) }))}
                        options={[
                          { value: "0.9", label: "90%" },
                          { value: "0.95", label: "95%" },
                          { value: "0.99", label: "99%" },
                        ]}
                      />
                    </Field>
                    <Field label="Focal KPIs">
                      <div className="flex flex-wrap gap-1">
                        {KPI_OPTIONS.map((k) => {
                          const selected = multiCfg.kpis.includes(k.id);
                          return (
                            <button
                              key={k.id}
                              type="button"
                              onClick={() =>
                                setMultiCfg((c) => ({
                                  ...c,
                                  kpis: selected ? c.kpis.filter((x) => x !== k.id) : [...c.kpis, k.id],
                                }))
                              }
                              className={cn(
                                "rounded-sm border px-[7px] py-px font-mono text-[10px] transition-colors",
                                selected
                                  ? "border-foreground bg-foreground text-background"
                                  : "border-[--hair-border] bg-background text-[--hair-quiet] hover:border-foreground hover:text-foreground",
                              )}
                            >
                              {k.label}
                            </button>
                          );
                        })}
                      </div>
                    </Field>
                    <Button
                      size="sm"
                      className="mt-auto h-[26px] px-2.5 text-[11.5px]"
                      onClick={onRunMulti}
                      disabled={submitting === "multi"}
                    >
                      {submitting === "multi" ? "Queueing…" : multiQueuedAt ? "Re-run replications" : "Run replications"}
                    </Button>
                  </div>

                  {/* Results panel: persisted run data only — weekly traces,
                      per-KPI convergence. Empty state before the first run. */}
                  <MultiRunResultsPanel
                    kpis={multiCfg.kpis}
                    confidence={multiCfg.confidence}
                    reps={doneReps}
                    warmupWeeks={adoptedWarmupWeeks}
                  />
                </div>
              </TabsContent>
            </Tabs>

            {/* Live run evidence — the queued experiment.run flows to the Fly
                worker; the engine badge flips to "scsim engine <version>" and
                the persisted per-replication output renders the moment the
                worker writes it. This section, not the animation above, is
                the proof the simulation actually ran. */}
            {validationScenarioId && (
              <div className="mt-2 flex flex-col gap-2.5 border-t border-[--hair-border] pt-3">
                <span className={KX_TIGHT}>Engine run</span>
                {/* Run-queue console (6.E): every job from history, not just
                    the latest — per-row Cancel/View/Retry, status tally, filter
                    and bulk Cancel-all / Clear-finished. cancelJob reuses the
                    existing cancelRun / cancelBrowserRun; no backend change. */}
                <RunQueueConsole
                  jobs={jobs}
                  activeReps={reps}
                  activeRepsRunId={latestRun?.id ?? null}
                  selectedRunId={inspectedRun?.id ?? null}
                  credibility={runCredibility}
                  onCancel={cancelJob}
                  onCancelAllActive={cancelAllActive}
                  onView={onViewRun}
                  onRetry={(job) => ((job.rep_count_target ?? 1) > 1 ? onRunMulti() : onRunSingle())}
                />
                {/* Inspection detail for the selected run (defaults to latest):
                    the engine's mapping report + the model-behaviour dashboard. */}
                {inspectedRun && (
                  <MappingWarningsCard
                    warnings={inspectedRun.mapping_warnings}
                    status={inspectedRun.status}
                  />
                )}
                {inspectedRun && inspectedReps.some((r) => r.status === "done" && r.kpis) && (
                  <EngineOutputSummary
                    run={inspectedRun}
                    reps={inspectedReps.filter((r) => r.status === "done" && r.kpis)}
                    warmupWeeks={
                      inspectedRun.id === latestRun?.id
                        ? adoptedWarmupWeeks
                        : inspectedRun.warmup_detected_at ?? null
                    }
                  />
                )}
              </div>
            )}
          </StepShell>
        )}

        {/* 3 — WARM-UP DETECTION */}
        {step === 2 && (
          <StepShell index={2} title="Warm-up detection">
            <div className="flex flex-col gap-4">
              {/* (a) replication adequacy */}
              <section className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <span className={KX_TIGHT}>a · Replication adequacy</span>
                  <span className="font-mono text-[10.5px] text-muted-foreground">
                    half-width ≤ {(warmCfg.target_precision * 100).toFixed(0)}% of mean
                  </span>
                </div>
                <ReplicationAdequacy
                  kpis={multiCfg.kpis}
                  reps={doneReps}
                  confidence={multiCfg.confidence}
                  target={warmCfg.target_precision}
                  onAddReps={(extra) => {
                    if (projectId && latestRun) {
                      void addReps(projectId, latestRun.id, extra);
                      toast.success(`Queued +${extra} replications on the real run.`);
                    }
                  }}
                  onTargetChange={(v) => setWarmCfg((c) => ({ ...c, target_precision: v }))}
                />
              </section>

              {/* (b) warm-up estimation */}
              <section className="flex flex-col gap-2 border-t border-[--hair-border] pt-3">
                <span className={KX_TIGHT}>b · Warm-up estimation</span>
                <Field label="Indicators">
                  <div className="flex flex-wrap gap-1">
                    {KPI_OPTIONS.map((ind) => {
                      const selected = indicators.some((x) => x.id === ind.id);
                      return (
                        <button
                          key={ind.id}
                          type="button"
                          onClick={() =>
                            setIndicators((cur) =>
                              selected ? cur.filter((x) => x.id !== ind.id) : [...cur, { id: ind.id }],
                            )
                          }
                          className={cn(
                            "rounded-sm border px-[7px] py-px font-mono text-[10px] transition-colors",
                            selected
                              ? "border-foreground bg-foreground text-background"
                              : "border-[--hair-border] bg-background text-[--hair-quiet] hover:border-foreground hover:text-foreground",
                          )}
                        >
                          {ind.label}
                        </button>
                      );
                    })}
                  </div>
                </Field>
                {indicators.length > 0 && (
                  <Field label="Empirical time-series (optional)">
                    <div className="flex w-full flex-col gap-1">
                      {indicators.map((ind) => {
                        const meta = KPI_OPTIONS.find((x) => x.id === ind.id)!;
                        return (
                          <div key={ind.id} className={cn(SURFACE, "flex items-center gap-2 p-1.5")}>
                            <span className="w-40 shrink-0 text-[12px]">{meta.label}</span>
                            <label className="flex-1 cursor-pointer">
                              <input
                                type="file"
                                accept=".csv,text/csv"
                                className="hidden"
                                onChange={(e) => onIndicatorFile(ind.id, e.target.files?.[0] ?? null)}
                              />
                              <div className="flex h-6 items-center gap-1.5 rounded-sm border border-dashed border-[--zinc-border] px-2 font-mono text-[11px] text-muted-foreground hover:border-foreground">
                                <Upload className="h-3 w-3" />
                                {ind.fileName ? (
                                  <span className="truncate">
                                    {ind.fileName} · {ind.points} pts
                                  </span>
                                ) : (
                                  <span>CSV (t,value)</span>
                                )}
                              </div>
                            </label>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6"
                              onClick={() => setIndicators((cur) => cur.filter((x) => x.id !== ind.id))}
                            >
                              <X className="h-3 w-3" />
                            </Button>
                          </div>
                        );
                      })}
                    </div>
                  </Field>
                )}
                <div className="flex flex-wrap items-end gap-[18px] pt-1">
                  <Field label="Method">
                    <Segmented<WarmupCfg["method"]>
                      size="sm"
                      value={warmCfg.method}
                      onChange={(v) => setWarmCfg((c) => ({ ...c, method: v }))}
                      options={[
                        { value: "engine", label: "engine", title: "Engine (most conservative)" },
                        { value: "welch", label: "welch", title: "Welch moving average" },
                        { value: "mser5", label: "mser5", title: "MSER-5" },
                      ]}
                    />
                  </Field>
                  <Field label="Warm-up (days)">
                    <Input
                      type="number"
                      className="h-6 w-[94px] text-right font-mono text-[11.5px] tabular-nums"
                      value={warmCfg.warmup_days}
                      onChange={(e) => setWarmCfg((c) => ({ ...c, warmup_days: parseInt(e.target.value, 10) || 0 }))}
                    />
                  </Field>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-[26px] px-2.5 text-[11.5px]"
                    onClick={detectWarmup}
                  >
                    Auto-detect
                  </Button>
                </div>
                {warmupComputed && (
                  <div className="mt-1 flex flex-col gap-2.5">
                    <div className={cn(SURFACE, "flex flex-wrap items-center gap-2.5 px-2.5 py-1.5")}>
                      <span className={KX_TIGHT}>Detected warm-up</span>
                      <span className="font-mono text-[11.5px] font-medium">{warmCfg.warmup_days} days</span>
                      <span className="font-mono text-[11px] text-muted-foreground">
                        method <b className="font-medium text-foreground">{warmCfg.method}</b> · reps{" "}
                        <b className="font-medium text-foreground">{doneReps.length}</b>
                      </span>
                      <div className="flex-1" />
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-[24px] px-2.5 text-[11px]"
                        onClick={() => setStep(3)}
                      >
                        Apply to validation
                      </Button>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {(indicators.length > 0 ? indicators.map((i) => i.id) : multiCfg.kpis).map((kpi) => (
                        <KpiWeeklyChart
                          key={kpi}
                          kpi={kpi}
                          reps={doneReps}
                          warmup={warmCfg.warmup_days}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </section>
            </div>
          </StepShell>
        )}

        {/* 4 — VALIDATION */}
        {step === 3 && (
          <StepShell
            index={3}
            title="Validation"
            sub={`t > ${warmCfg.warmup_days}d · KS + Welch t`}
            action={
              <Button
                size="sm"
                className="h-[26px] px-2.5 text-[11.5px]"
                onClick={runValidation}
                disabled={Object.keys(empirical).length === 0}
              >
                Run validation
              </Button>
            }
          >
            {multiCfg.kpis.length === 0 ? (
              <span className="font-mono text-[11px] text-muted-foreground">
                no focal KPI selected in step 2
              </span>
            ) : (
              <>
                <div className="flex flex-col gap-1">
                  {multiCfg.kpis.map((kpi) => {
                    const meta = KPI_OPTIONS.find((x) => x.id === kpi)!;
                    const emp = empirical[kpi];
                    return (
                      <div key={kpi} className={cn(SURFACE, "flex items-center gap-2 p-1.5")}>
                        <span className="w-40 shrink-0 text-[12px]">{meta.label}</span>
                        <label className="flex-1 cursor-pointer">
                          <input
                            type="file"
                            accept=".csv,text/csv"
                            className="hidden"
                            onChange={(e) => onEmpiricalFile(kpi, e.target.files?.[0] ?? null)}
                          />
                          <div className="flex h-6 items-center gap-1.5 rounded-sm border border-dashed border-[--zinc-border] px-2 font-mono text-[11px] text-muted-foreground hover:border-foreground">
                            <Upload className="h-3 w-3" />
                            {emp ? (
                              <span className="truncate">
                                {emp.fileName} · {emp.values.length} pts
                              </span>
                            ) : (
                              <span>CSV ({meta.unit})</span>
                            )}
                          </div>
                        </label>
                      </div>
                    );
                  })}
                </div>
                {validationResult && (
                  <div className={cn(SURFACE, "overflow-x-auto")}>
                    <table className="w-full">
                      <thead>
                        <tr>
                          <th className={TH}>KPI</th>
                          <th className={cn(TH, "text-right")}>KS D</th>
                          <th className={cn(TH, "text-right")}>KS p</th>
                          <th className={cn(TH, "text-right")}>t</th>
                          <th className={cn(TH, "text-right")}>t p</th>
                          <th className={cn(TH, "text-right")}>n sim</th>
                          <th className={TH}>Source</th>
                          <th className={cn(TH, "text-right")}>Result</th>
                        </tr>
                      </thead>
                      <tbody>
                        {validationResult.map((r) => {
                          const meta = KPI_OPTIONS.find((x) => x.id === r.kpi)!;
                          const num = (v: number) =>
                            Number.isNaN(v) ? "—" : String(v);
                          return (
                            <tr key={r.kpi}>
                              <td className={TD}>{meta.label}</td>
                              <td className={cn(TD, "text-right font-mono tabular-nums")}>{num(r.ks)}</td>
                              <td className={cn(TD, "text-right font-mono tabular-nums")}>{num(r.ksP)}</td>
                              <td className={cn(TD, "text-right font-mono tabular-nums")}>{num(r.t)}</td>
                              <td className={cn(TD, "text-right font-mono tabular-nums")}>{num(r.tP)}</td>
                              <td className={cn(TD, "text-right font-mono tabular-nums")}>{r.n || "—"}</td>
                              <td className={cn(TD, "font-mono text-[11px] text-muted-foreground")}>{r.source}</td>
                              <td className={cn(TD, "text-right")}>
                                <span className="inline-flex items-center gap-1.5 font-mono text-[11px]">
                                  {Number.isNaN(r.ks) ? (
                                    <>
                                      <StatusDot pending /> no data
                                    </>
                                  ) : r.pass ? (
                                    <>
                                      <StatusDot ok /> pass
                                    </>
                                  ) : (
                                    <>
                                      <StatusDot /> fail
                                    </>
                                  )}
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}

            {/* Adoption (§9.5 step 6, G13): persist the validated model card
               from the validation result — there is no separate Adopt step. */}
            <div className="mt-3 flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className={KX_TIGHT}>Adopt</span>
                <CredibilityBadge credibility={liveCredibility} />
              </div>
              <AdoptStep
                findings={findings}
                blockCount={blockCount}
                hasRealData={hasRealData}
                repCount={doneReps.length}
                engineVersion={latestRun?.code_version ?? null}
                evidenceRunId={dbRun?.id ?? null}
                warmupComputed={warmupComputed}
                warmCfg={warmCfg}
                confidence={multiCfg.confidence}
                adequacy={adequacy}
                validationResult={validationResult}
                basis={adoptBasis}
                statisticalPass={statisticalPass}
                faceAck={faceAck}
                onFaceAck={setFaceAck}
                credibility={liveCredibility}
                triple={{
                  versionId: selectedVersionId,
                  policyDirty,
                  graphHash: dataset.currentHash,
                  scenarioHash,
                }}
                ready={adoptReady}
                adopting={adopting}
                onMarkValid={onMarkValid}
              />
            </div>
          </StepShell>
        )}
      </>

      {/* Persistent footer */}
      <div className="flex items-center justify-between">
        <Button
          variant="outline"
          size="sm"
          className="h-[26px] px-2.5 text-[11.5px]"
          onClick={() => setStep((s) => Math.max(0, s - 1))}
          disabled={step === 0}
        >
          Back
        </Button>
        <span className="font-mono text-[11px] text-muted-foreground">
          step {step + 1} / {STEPS.length}
        </span>
        <Button
          size="sm"
          className="h-[26px] px-2.5 text-[11.5px]"
          onClick={() => setStep((s) => Math.min(STEPS.length - 1, s + 1))}
          disabled={step === STEPS.length - 1 || !canContinue(step)}
          title={!canContinue(step) ? "Complete the current step first" : undefined}
        >
          Continue
        </Button>
      </div>
    </div>
  );
}

// ============= Inline sub-components ==========================================

/** The step panel: mono STEP kicker, title, optional action — tied to the
 *  selected step card by the same 2px top rule the grid uses. */
function StepShell({
  index,
  title,
  sub,
  action,
  children,
}: {
  index: number;
  title: string;
  sub?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className={cn(SURFACE, "min-h-[340px] border-t-2 border-t-foreground")}>
      <div className="flex flex-wrap items-center gap-[9px] border-b border-[--hair-border] bg-[#fafafa] px-3 py-2">
        <span className={KX_TIGHT}>step {index + 1}</span>
        <span className="text-[13px] font-medium tracking-[-0.01em]">{title}</span>
        {sub && <span className="font-mono text-[11px] text-muted-foreground">{sub}</span>}
        <div className="flex-1" />
        {action}
      </div>
      <div className="flex flex-col gap-3 p-3">{children}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
        {label}
      </span>
      {children}
    </div>
  );
}

// ── Adopt step (§9.5 step 6 / B0 design §2.5) ────────────────────────────────
// Summarizes the pipeline outcome — adopted warm-up + method + evidence,
// replication recommendation per focal KPI from the adequacy math, validation
// verdict with its basis — and persists it as a model card on user action.
// Every number shown here is computed from persisted run output above;
// nothing is asserted (A3).

interface AdequacyStats {
  perKpi: Record<string, { mean: number; half: number; rel: number; n: number; n_star: number }>;
  recommended: number;
}

interface AdoptStepProps {
  findings: Finding[] | null;
  blockCount: number;
  hasRealData: boolean;
  repCount: number;
  engineVersion: string | null;
  evidenceRunId: string | null;
  warmupComputed: boolean;
  warmCfg: WarmupCfg;
  confidence: number;
  adequacy: AdequacyStats | null;
  validationResult: Array<{ kpi: KpiId; ks: number; ksP: number; t: number; tP: number; n: number; source: string; pass: boolean }> | null;
  basis: "statistical" | "face";
  statisticalPass: boolean;
  faceAck: boolean;
  onFaceAck: (v: boolean) => void;
  credibility: Credibility;
  triple: {
    versionId: string | null;
    policyDirty: boolean;
    graphHash: string | null;
    scenarioHash: string | null;
  };
  ready: boolean;
  adopting: boolean;
  onMarkValid: () => void;
}

function AdoptChecklistRow({ ok, label, detail }: { ok: boolean; label: string; detail: string }) {
  return (
    <tr>
      <td className={cn(TD, "w-6")}>
        <StatusDot ok={ok} pending={!ok} />
      </td>
      <td className={cn(TD, "w-48 font-medium")}>{label}</td>
      <td className={cn(TD, "font-mono text-[11px] text-muted-foreground")}>{detail}</td>
    </tr>
  );
}

function AdoptStep({
  findings,
  blockCount,
  hasRealData,
  repCount,
  engineVersion,
  evidenceRunId,
  warmupComputed,
  warmCfg,
  confidence,
  adequacy,
  validationResult,
  basis,
  statisticalPass,
  faceAck,
  onFaceAck,
  credibility,
  triple,
  ready,
  adopting,
  onMarkValid,
}: AdoptStepProps) {
  const testsRan = (validationResult ?? []).filter((r) => r.n > 0);
  const passing = testsRan.filter((r) => r.pass).length;
  return (
    <div className="flex flex-col gap-3">
      {/* pipeline prerequisites — the §2.5 enablement, made visible */}
      <div className={cn(SURFACE, "overflow-x-auto")}>
        <table className="w-full"><tbody>
          <AdoptChecklistRow
            ok={findings !== null && blockCount === 0}
            label="Verification"
            detail={
              findings === null
                ? "not run yet (step 1)"
                : blockCount > 0
                ? `${blockCount} blocker(s) — fix them first`
                : `${findings.length} finding(s), no blockers`
            }
          />
          <AdoptChecklistRow
            ok={hasRealData}
            label="Evidence run"
            detail={
              hasRealData
                ? `${repCount} completed replication(s)${engineVersion ? ` · ${engineVersion}` : ""}${
                    evidenceRunId ? ` · run ${evidenceRunId.slice(0, 8)}…` : " · not persisted — card will carry no run reference"
                  }`
                : "run replications first (step 2)"
            }
          />
          <AdoptChecklistRow
            ok={warmupComputed && warmCfg.warmup_days > 0}
            label="Warm-up"
            detail={
              warmupComputed && warmCfg.warmup_days > 0
                ? `${warmCfg.warmup_days} days (${warmCfg.method})`
                : "detect the warm-up first (step 3)"
            }
          />
          <AdoptChecklistRow
            ok={adequacy !== null}
            label="Replication adequacy"
            detail={
              adequacy
                ? `recommend n = ${adequacy.recommended} for ±${(warmCfg.target_precision * 100).toFixed(0)}% at ${(confidence * 100).toFixed(0)}% confidence`
                : "needs completed replications on focal KPIs"
            }
          />
          <AdoptChecklistRow
            ok={testsRan.length > 0 ? statisticalPass : faceAck}
            label="Validation"
            detail={
              testsRan.length > 0
                ? `${passing}/${testsRan.length} KPI(s) passed KS + Welch-t (statistical basis)`
                : "no empirical series — face validation requires the acknowledgment below"
            }
          />
        </tbody></table>
      </div>

      {/* replication recommendation per focal KPI — the adequacy math the
          card stores as replication_basis */}
      {adequacy && (
        <div className={cn(SURFACE, "overflow-x-auto")}>
          <table className="w-full">
            <thead>
              <tr>
                <th className={TH}>Focal KPI</th>
                <th className={cn(TH, "text-right")}>Mean</th>
                <th className={cn(TH, "text-right")}>Half-width</th>
                <th className={cn(TH, "text-right")}>Rel.</th>
                <th className={cn(TH, "text-right")}>n run</th>
                <th className={cn(TH, "text-right")}>n* required</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(adequacy.perKpi).map(([kpi, s]) => {
                const meta = KPI_OPTIONS.find((x) => x.id === kpi);
                return (
                  <tr key={kpi}>
                    <td className={TD}>{meta?.label ?? kpi}</td>
                    <td className={cn(TD, "text-right font-mono tabular-nums")}>{s.mean.toFixed(3)}</td>
                    <td className={cn(TD, "text-right font-mono tabular-nums")}>{s.half.toFixed(3)}</td>
                    <td className={cn(TD, "text-right font-mono tabular-nums")}>{(s.rel * 100).toFixed(1)}%</td>
                    <td className={cn(TD, "text-right font-mono tabular-nums")}>{s.n}</td>
                    <td className={cn(TD, "text-right font-mono font-medium tabular-nums")}>{s.n_star}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="border-t border-[--hair-border] px-2.5 py-1 font-mono text-[10px] text-muted-foreground">
            n* = (z·s / (ε·x̄))² · card recommends {adequacy.recommended}
          </div>
        </div>
      )}

      {/* face-validation acknowledgment (legitimate Sargent-style outcome for
          greenfield models — the badge tooltip discloses the basis) */}
      {testsRan.length === 0 && (
        <label
          className="flex cursor-pointer items-start gap-2 rounded-sm border p-2.5 text-[12px]"
          style={{ borderColor: tint(LAYER.firm, 0.4), background: tint(LAYER.firm, 0.06) }}
        >
          <Checkbox
            checked={faceAck}
            onCheckedChange={(v) => onFaceAck(v === true)}
            className="mt-0.5"
          />
          <span>
            <b>Face validation</b> — no empirical series, no statistical tests. I judge the
            model's behavior plausible for its purpose. The card records <b>basis: face</b>.
          </span>
        </label>
      )}

      {/* the provenance triple the card binds to (§9.5 identity) */}
      <div className={cn(SURFACE, "flex flex-wrap gap-x-4 gap-y-1 bg-[#fafafa] px-2.5 py-1.5 font-mono text-[11px] text-muted-foreground")}>
        <span>
          policy version{" "}
          <b className="font-medium text-foreground">
            {triple.versionId ? triple.versionId.slice(0, 8) : "unsaved"}
          </b>
          {triple.policyDirty && (
            <b className="font-medium" style={{ color: LAYER.firm }}>
              {" "}· dirty — a new version is saved on adoption
            </b>
          )}
        </span>
        <span>
          graph <b className="font-medium text-foreground">{triple.graphHash?.slice(0, 8) ?? "—"}</b>
        </span>
        <span>
          scenario <b className="font-medium text-foreground">{triple.scenarioHash?.slice(0, 8) ?? "—"}</b>
        </span>
      </div>

      {credibility.state === "validated" && (
        <div className="flex items-center gap-2 font-mono text-[11px] text-muted-foreground">
          <StatusDot ok />
          active card {new Date(credibility.card.validated_at).toLocaleString()}
          {credibility.card.author_email ? ` · ${credibility.card.author_email}` : ""} · basis{" "}
          {credibility.card.basis} · re-adopting supersedes it
        </div>
      )}

      <Button
        className="h-[26px] self-start px-2.5 text-[11.5px]"
        size="sm"
        onClick={onMarkValid}
        disabled={!ready || adopting}
      >
        {adopting ? "Recording…" : "Mark model valid"}
      </Button>
    </div>
  );
}

/** Per-replication weekly traces for one persisted time_series key, with the
 *  adopted warm-up cut line (in weeks). The §9.5.1 dashboard building block. */
function WeeklySeriesChart({
  seriesKey,
  title,
  unit,
  reps,
  warmupWeeks,
  height = 140,
}: {
  seriesKey: SeriesKey;
  title: string;
  unit: string;
  reps: Replication[];
  warmupWeeks?: number | null;
  height?: number;
}) {
  const traces = useMemo(() => rawSeries(reps, seriesKey).slice(0, 8), [reps, seriesKey]);
  const data = useMemo(() => {
    if (traces.length === 0) return [];
    const n = Math.min(...traces.map((s) => s.length));
    return Array.from({ length: n }, (_, week) => {
      const row: Record<string, number> = { week };
      traces.forEach((s, i) => {
        row[`r${i}`] = s[week];
      });
      return row;
    });
  }, [traces]);

  if (data.length === 0) {
    return (
      <div className={cn(SURFACE, "border-dashed p-2.5 font-mono text-[11px] text-muted-foreground")}>
        {title} · no weekly trace yet
      </div>
    );
  }
  return (
    <div className={cn(SURFACE, "p-2")}>
      <div className="mb-1 flex items-center gap-2">
        <span className={KX_TIGHT}>
          {title} ({unit})
        </span>
        <span className="font-mono text-[10px] text-muted-foreground">
          engine data · {traces.length} rep(s)
        </span>
      </div>
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid strokeOpacity={0.15} />
          <XAxis dataKey="week" tick={{ fontSize: 9 }} />
          <YAxis tick={{ fontSize: 9 }} width={36} domain={["auto", "auto"]} />
          <RTooltip contentStyle={{ fontSize: 10 }} />
          {warmupWeeks != null && warmupWeeks > 0 && (
            <ReferenceLine x={warmupWeeks} stroke={LAYER.brand} strokeDasharray="4 3" label={{ value: "warm-up", fontSize: 9, fill: LAYER.brand }} />
          )}
          {traces.map((_, i) => (
            <Line
              key={i}
              type="monotone"
              dataKey={`r${i}`}
              stroke={`hsl(${(i * 47) % 360} 70% 50%)`}
              strokeWidth={1.2}
              dot={false}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Weekly traces for a KPI with a persisted weekly series; scalar-only KPIs
 *  get an explanatory note. Warm-up passed in days (charts draw weeks). */
function KpiWeeklyChart({
  kpi,
  reps,
  warmup,
}: {
  kpi: KpiId;
  reps: Replication[];
  warmup?: number;
}) {
  const meta = KPI_OPTIONS.find((x) => x.id === kpi)!;
  const key = SERIES_KEY[kpi];
  if (!key) {
    return (
      <div className={cn(SURFACE, "border-dashed p-2.5 font-mono text-[11px] text-muted-foreground")}>
        {meta.label} · no weekly series — validated from per-replication values
      </div>
    );
  }
  return (
    <WeeklySeriesChart
      seriesKey={key}
      title={meta.label}
      unit={meta.unit}
      reps={reps}
      warmupWeeks={warmup !== undefined ? Math.round(warmup / 7) : null}
    />
  );
}

function ReplicationAdequacy({
  kpis,
  reps,
  confidence,
  target,
  onAddReps,
  onTargetChange,
}: {
  kpis: KpiId[];
  reps: Replication[];
  confidence: number;
  target: number;
  onAddReps: (n: number) => void;
  onTargetChange: (v: number) => void;
}) {
  // REAL per-replication KPI values from run_replications.kpis. Beyond the
  // focal KPIs, adequacy always covers the cost KPIs (§9.5.1 step 1d): cost
  // estimates gate the financial statement's trustworthiness. Cost components
  // at zero on every replication are skipped.
  const rows = useMemo(() => {
    if (kpis.length === 0 || reps.length === 0) return [];
    const sample = (kpi: KpiId) =>
      reps.map((r) => Number(r.kpis[kpi])).filter((n) => Number.isFinite(n));
    const ids: KpiId[] = [...kpis];
    for (const cost of ["cost_of_resilience" as const, ...COST_COMPONENT_OPTIONS.map((c) => c.id)]) {
      if (ids.includes(cost)) continue;
      if (cost === "cost_of_resilience" || sample(cost).some((v) => v !== 0)) ids.push(cost);
    }
    return ids.map((kpi) => {
      const values = sample(kpi);
      const stats = meanCI(values, confidence);
      const rel = stats.mean !== 0 ? stats.half / Math.abs(stats.mean) : 0;
      return { kpi, ...stats, rel, adequate: rel <= target, focal: kpis.includes(kpi) };
    });
  }, [kpis, reps, confidence, target]);

  if (kpis.length === 0) {
    return (
      <span className="font-mono text-[11px] text-muted-foreground">
        no focal KPI selected in step 2
      </span>
    );
  }
  if (reps.length === 0) {
    return (
      <span className="font-mono text-[11px] text-muted-foreground">
        no completed replications yet
      </span>
    );
  }
  const insufficient = rows.filter((r) => !r.adequate);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
          Target half-width
        </span>
        <Input
          type="number"
          step={0.01}
          min={0.01}
          max={0.5}
          className="h-6 w-20 text-right font-mono text-[11.5px] tabular-nums"
          value={target}
          onChange={(e) => onTargetChange(parseFloat(e.target.value) || 0.05)}
        />
      </div>
      <div className={cn(SURFACE, "overflow-x-auto")}>
        <table className="w-full">
          <thead>
            <tr>
              <th className={TH}>KPI</th>
              <th className={cn(TH, "text-right")}>Mean</th>
              <th className={cn(TH, "text-right")}>Std</th>
              <th className={cn(TH, "text-right")}>n</th>
              <th className={cn(TH, "text-right")}>Half-width</th>
              <th className={cn(TH, "text-right")}>Rel.</th>
              <th className={cn(TH, "text-right")}>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const meta = KPI_OPTIONS.find((x) => x.id === r.kpi)!;
              return (
                <tr key={r.kpi} className={r.focal ? undefined : "text-muted-foreground"}>
                  <td className={TD}>
                    {meta.label}
                    {!r.focal && <MonoChip className="ml-1.5">cost</MonoChip>}
                  </td>
                  <td className={cn(TD, "text-right font-mono tabular-nums")}>{r.mean.toFixed(3)}</td>
                  <td className={cn(TD, "text-right font-mono tabular-nums")}>{r.std.toFixed(3)}</td>
                  <td className={cn(TD, "text-right font-mono tabular-nums")}>{r.n}</td>
                  <td className={cn(TD, "text-right font-mono tabular-nums")}>{r.half.toFixed(3)}</td>
                  <td className={cn(TD, "text-right font-mono tabular-nums")}>{(r.rel * 100).toFixed(1)}%</td>
                  <td className={cn(TD, "text-right")}>
                    <span className="inline-flex items-center gap-1.5 font-mono text-[11px]">
                      <StatusDot ok={r.adequate} />
                      {r.adequate ? "adequate" : "need more"}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {insufficient.length > 0 && (
        <Button
          size="sm"
          variant="outline"
          className="h-[26px] self-start px-2.5 text-[11.5px]"
          onClick={() => onAddReps(10)}
        >
          Add 10 replications
        </Button>
      )}
    </div>
  );
}

// Multi-run results panel (§9.5.1 step 1d): persisted run data ONLY — weekly
// per-replication traces with the adopted warm-up cut, plus a running-mean
// convergence plot per focal KPI. Before the first run it is an empty state;
// nothing synthetic is ever rendered here.
function MultiRunResultsPanel({
  kpis,
  confidence,
  reps,
  warmupWeeks,
}: {
  kpis: KpiId[];
  confidence: number;
  reps: Replication[];
  warmupWeeks: number | null;
}) {
  const [activeKpi, setActiveKpi] = useState<KpiId | null>(kpis[0] ?? null);
  useEffect(() => {
    if (activeKpi && kpis.includes(activeKpi)) return;
    setActiveKpi(kpis[0] ?? null);
  }, [kpis, activeKpi]);

  if (kpis.length === 0 || !activeKpi) {
    return (
      <div className={cn(SURFACE, "flex items-center justify-center border-dashed p-6 font-mono text-[11px] text-muted-foreground")}>
        no focal KPI selected
      </div>
    );
  }

  if (reps.length === 0) {
    return (
      <div className={cn(SURFACE, "flex items-center justify-center border-dashed p-6 font-mono text-[11px] text-muted-foreground")}>
        no replications yet
      </div>
    );
  }

  const meta = KPI_OPTIONS.find((k) => k.id === activeKpi)!;
  const values = reps
    .map((r) => Number(r.kpis[activeKpi]))
    .filter((n) => Number.isFinite(n));
  const overall = meanCI(values, confidence);
  return (
    <div className={cn(SURFACE, "flex flex-col")}>
      <div className="flex items-center gap-1 overflow-x-auto border-b border-[--hair-border] bg-[#fafafa] px-2 py-1.5">
        {kpis.map((id) => {
          const k = KPI_OPTIONS.find((x) => x.id === id)!;
          const active = id === activeKpi;
          return (
            <button
              key={id}
              type="button"
              onClick={() => setActiveKpi(id)}
              className={cn(
                "whitespace-nowrap rounded-sm border px-[7px] py-px font-mono text-[10px] transition-colors",
                active
                  ? "border-foreground bg-foreground text-background"
                  : "border-transparent text-[--hair-quiet] hover:text-foreground",
              )}
            >
              {k.label}
            </button>
          );
        })}
        <span className="ml-auto whitespace-nowrap pr-1 font-mono text-[10px] text-muted-foreground">
          engine data · {reps.length} rep(s)
        </span>
      </div>
      <div className="grid grid-cols-4 gap-2 border-b border-[--hair-border] px-2.5 py-1.5 text-[11px]">
        <Stat label="Mean" value={overall.mean.toFixed(3)} unit={meta.unit} />
        <Stat label="Std" value={overall.std.toFixed(3)} />
        <Stat label="CI half-width" value={overall.half.toFixed(3)} />
        <Stat label="n reps" value={String(values.length)} />
      </div>
      <div className="flex flex-col gap-2 p-2">
        {/* Per-seed filter (W1): mean ± CI band by default; selecting a seed
            overlays or isolates that replication's trace + its KPI row. */}
        <ReplicationSeedExplorer
          reps={reps}
          warmupWeeks={warmupWeeks}
          confidence={confidence}
          title="Weekly traces by seed"
        />
        <ConvergencePlot reps={reps} primaryKpi={activeKpi} warmupAt={null} />
      </div>
    </div>
  );
}

function fmtKpi(id: string, v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  if (id === "fill_rate" || id === "capacity_utilization") return `${(v * 100).toFixed(1)}%`;
  return Math.abs(v) >= 1000 ? Math.round(v).toLocaleString() : v.toFixed(2);
}

function fmtEuro(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `€${Math.abs(v) >= 1000 ? Math.round(v).toLocaleString() : v.toFixed(2)}`;
}

const SUMMARY_TILES = [
  { id: "fill_rate", label: "Fill rate" },
  { id: "revenue", label: "Revenue (€)" },
  { id: "lost_sales_value", label: "Lost sales (€)" },
  { id: "max_backlog", label: "Max backlog (u)" },
] as const;

// The loud, PERSISTENT run-status banner — the definitive "did it run?"
// signal (replaces reliance on vanishing toasts). Green on success with the
// headline KPIs; red on failure naming the exact step; amber while loading
// the engine / computing.
type RunPhaseT =
  | { kind: "idle" }
  | { kind: "loading"; detail: string }
  | { kind: "computing"; done?: number; total?: number }
  | { kind: "succeeded"; summary: string; persisted: boolean | null }
  | { kind: "failed"; step: string; message: string };

function RunStatusBanner({ phase }: { phase: RunPhaseT }) {
  if (phase.kind === "idle") return null;
  const head =
    phase.kind === "failed"
      ? `failed at ${phase.step}`
      : phase.kind === "succeeded"
        ? "succeeded"
        : phase.kind === "computing"
          ? "running"
          : "loading";
  const detail =
    phase.kind === "failed"
      ? phase.message
      : phase.kind === "succeeded"
        ? phase.summary + (phase.persisted === false ? " · this session only — not persisted" : "")
        : phase.kind === "computing"
          ? phase.total
            ? `replication ${Math.min((phase.done ?? 0) + 1, phase.total)} / ${phase.total}`
            : "engine running"
          : phase.detail;
  const color =
    phase.kind === "failed" ? LAYER.brand : phase.kind === "succeeded" ? LAYER.process : LAYER.firm;
  return (
    <div
      className="flex flex-wrap items-center gap-2 rounded-sm border px-2.5 py-1.5"
      style={{ borderColor: tint(color, 0.4), background: tint(color, 0.06) }}
    >
      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: color }} />
      <span className="font-mono text-[11.5px] font-medium">{head}</span>
      <span className="break-words font-mono text-[11.5px] text-muted-foreground">{detail}</span>
    </div>
  );
}

// ── Engine result → UI row shapes (for immediate in-memory rendering) ──────
// The /api/run_simulation function returns the exact persisted-row shapes;
// these adapt them to the SimulationRun / Replication types the panels read,
// so the output renders without waiting on (or requiring) the DB round-trip.

function engineResultToRun(
  runId: string,
  scenarioId: string,
  projectId: string,
  result: EngineResult,
): SimulationRun {
  const u = result.runUpdate as Record<string, unknown>;
  const nowIso = new Date().toISOString();
  return {
    id: runId,
    scenario_id: scenarioId,
    project_id: projectId,
    status: (u.status as SimulationRun["status"]) ?? "done",
    started_at: nowIso,
    ended_at: (u.ended_at as string) ?? nowIso,
    aggregate_kpis: (u.aggregate_kpis as Record<string, number>) ?? {},
    ci_half_widths: (u.ci_half_widths as Record<string, number>) ?? {},
    warmup_detected_at: (u.warmup_detected_at as number | null) ?? null,
    rep_count_target: (u.rep_count_done as number) ?? result.replications.length,
    rep_count_done: (u.rep_count_done as number) ?? result.replications.length,
    error_message: null,
    code_version: (u.code_version as string) ?? `scsim-${result.engineVersion}`,
    policy_version_id: null,
    policy_hash: null,
    mapping_warnings:
      (u.mapping_warnings as SimulationRun["mapping_warnings"]) ?? null,
    created_at: nowIso,
  };
}

function engineResultToReps(result: EngineResult): Replication[] {
  return result.replications.map((r) => {
    const row = r as Record<string, unknown>;
    return {
      id: `${row.run_id}:${row.rep_index}`,
      run_id: String(row.run_id ?? ""),
      rep_index: Number(row.rep_index ?? 0),
      seed_used: Number(row.seed_used ?? 0),
      status: String(row.status ?? "done"),
      kpis: (row.kpis as Record<string, number>) ?? {},
      time_series: (row.time_series as Record<string, number[]>) ?? {},
      warmup_at: (row.warmup_at as number | null) ?? null,
      started_at: null,
      ended_at: (row.ended_at as string) ?? null,
    };
  });
}

/** One streamed replication (from the worker's on_replication hook) → the
 *  Replication row the grid/charts render. */
function engineRepToReplication(runId: string, rep: Record<string, unknown>): Replication {
  return {
    id: `${runId}:${rep.rep_index}`,
    run_id: runId,
    rep_index: Number(rep.rep_index ?? 0),
    seed_used: Number(rep.seed_used ?? 0),
    status: "done",
    kpis: (rep.kpis as Record<string, number>) ?? {},
    time_series: (rep.time_series as Record<string, number[]>) ?? {},
    warmup_at: (rep.warmup_at as number | null) ?? null,
    started_at: null,
    ended_at: null,
  };
}

/** A "running" placeholder run so the progress panel + per-rep grid render
 *  immediately (empty) and fill in live as replications stream in. */
function preliminaryRun(
  runId: string,
  scenarioId: string,
  projectId: string,
  total: number,
): SimulationRun {
  const now = new Date().toISOString();
  return {
    id: runId,
    scenario_id: scenarioId,
    project_id: projectId,
    status: "running",
    started_at: now,
    ended_at: null,
    aggregate_kpis: {},
    ci_half_widths: {},
    warmup_detected_at: null,
    rep_count_target: total,
    rep_count_done: 0,
    error_message: null,
    code_version: null,
    policy_version_id: null,
    policy_hash: null,
    mapping_warnings: null,
    created_at: now,
  };
}

/** Model-behavior inspection dashboard (§9.5.1 step 1c) for the latest
 *  validation run, everything read from simulation_runs / run_replications:
 *  headline KPIs ± CI, inventory dynamics first, then the financial
 *  statement, then every persisted weekly series, then sanity-check scalars.
 *  Nothing here is synthetic. */
function EngineOutputSummary({
  run,
  reps,
  warmupWeeks,
}: {
  run: SimulationRun;
  reps: Replication[];
  warmupWeeks: number | null;
}) {
  const agg = run.aggregate_kpis ?? {};
  const ci = run.ci_half_widths ?? {};
  const streaming = run.status === "running" || run.status === "queued";
  return (
    <div className={SURFACE}>
      <div className="flex flex-wrap items-center gap-2 border-b border-[--hair-border] bg-[#fafafa] px-2.5 py-1.5">
        <span className={KX_TIGHT}>Engine output</span>
        <span className="inline-flex items-center gap-1.5 font-mono text-[10.5px] text-muted-foreground">
          <StatusDot ok={!streaming} pending={streaming} />
          {streaming
            ? `live · ${reps.length} replication(s) streamed`
            : `complete · ${reps.length} replication(s)`}
        </span>
        <div className="flex-1" />
        {run.policy_hash && (
          <span
            className="font-mono text-[10px] text-muted-foreground"
            title="SHA-256 of the policy version this run is bound to"
          >
            policy {run.policy_hash.slice(0, 8)}
          </span>
        )}
        {run.ended_at && (
          <span className="font-mono text-[10px] text-muted-foreground">
            finished {new Date(run.ended_at).toLocaleString()}
          </span>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2 border-b border-[--hair-border] px-2.5 py-1.5 text-[11px] md:grid-cols-4">
        {SUMMARY_TILES.map((t) => (
          <div key={t.id} className="flex flex-col">
            <span className="text-[9px] uppercase tracking-widest text-muted-foreground">
              {t.label}
            </span>
            <span className="font-mono tabular-nums text-foreground">
              {fmtKpi(t.id, agg[t.id])}
              {Number.isFinite(ci[t.id]) && (
                <span className="text-muted-foreground/70 ml-1 text-[10px]">
                  ± {fmtKpi(t.id, ci[t.id])}
                </span>
              )}
            </span>
          </div>
        ))}
      </div>
      <div className="flex flex-col gap-2 p-2">
        {/* 1 — inventory dynamics: does stock settle where the policies say
            it should? The first thing a modeler checks. */}
        <WeeklySeriesChart
          seriesKey="on_hand_value"
          title="Inventory dynamics — on-hand value"
          unit="€"
          reps={reps}
          warmupWeeks={warmupWeeks}
          height={180}
        />
        {/* 2 — the financial statement from the persisted per-rep KPIs. */}
        <FinancialStatement reps={reps} />
        {/* 3 — the remaining persisted weekly series. */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
          {SERIES_CHARTS.filter((s) => s.key !== "on_hand_value").map((s) => (
            <WeeklySeriesChart
              key={s.key}
              seriesKey={s.key}
              title={s.label}
              unit={s.unit}
              reps={reps}
              warmupWeeks={warmupWeeks}
            />
          ))}
        </div>
        {/* 4 — sanity-check scalars. */}
        <SanityScalars reps={reps} />
        {/* 5 — per-seed filter over the persisted weekly traces (W1): only
            meaningful when the run has more than one replication. */}
        {reps.length > 1 && (
          <ReplicationSeedExplorer reps={reps} warmupWeeks={warmupWeeks} />
        )}
        {/* 6 — per-item weekly series (W3, inspection runs only): renders
            nothing when the run persisted no run_item_series rows. */}
        <ItemSeriesExplorer runId={run.id} warmupWeeks={warmupWeeks} />
      </div>
    </div>
  );
}

/** Financial statement (§9.5.1 step 1b): revenue, minus each engine cost
 *  component as its own line, = margin, plus lost-sales value as a memo line.
 *  Values are means over completed replications of run_replications.kpis. */
function FinancialStatement({ reps }: { reps: Replication[] }) {
  const avg = (id: KpiId): number | null => {
    const v = reps.map((r) => Number(r.kpis[id])).filter((n) => Number.isFinite(n));
    return v.length > 0 ? v.reduce((a, b) => a + b, 0) / v.length : null;
  };
  const revenue = avg("revenue");
  const totalCost = avg("cost_of_resilience");
  const margin = revenue != null && totalCost != null ? revenue - totalCost : null;
  const lostSales = avg("lost_sales_value");
  return (
    <div className={SURFACE}>
      <div className="flex items-center gap-2 border-b border-[--hair-border] bg-[#fafafa] px-2.5 py-1.5">
        <span className={KX_TIGHT}>Financial statement</span>
        <span className="font-mono text-[10px] text-muted-foreground">
          mean over {reps.length} rep(s)
        </span>
      </div>
      <table className="w-full">
        <tbody>
          <tr>
            <td className={cn(TD, "font-medium")}>Revenue</td>
            <td className={cn(TD, "text-right font-mono tabular-nums")}>{fmtEuro(revenue)}</td>
          </tr>
          {COST_COMPONENT_OPTIONS.map((c) => {
            const v = avg(c.id);
            return (
              <tr key={c.id} className={v === 0 ? "text-[#c4c4c4]" : "text-muted-foreground"}>
                <td className={cn(TD, "pl-6")}>− {c.label.replace("Cost — ", "")}</td>
                <td className={cn(TD, "text-right font-mono tabular-nums")}>{fmtEuro(v)}</td>
              </tr>
            );
          })}
          <tr className="border-t border-foreground">
            <td className={cn(TD, "font-medium")}>= Margin</td>
            <td className={cn(TD, "text-right font-mono font-medium tabular-nums")}>
              {fmtEuro(margin)}
            </td>
          </tr>
          <tr className="text-muted-foreground">
            <td className={TD}>Lost-sales value</td>
            <td className={cn(TD, "text-right font-mono tabular-nums")}>{fmtEuro(lostSales)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

/** Sanity-check scalars (§9.5.1 step 1c): quantities read for plausibility
 *  rather than optimized — a surprise here means a model-specification issue. */
function SanityScalars({ reps }: { reps: Replication[] }) {
  const avg = (id: KpiId): number | null => {
    const v = reps.map((r) => Number(r.kpis[id])).filter((n) => Number.isFinite(n));
    return v.length > 0 ? v.reduce((a, b) => a + b, 0) / v.length : null;
  };
  const util = avg("capacity_utilization");
  const lostInbound = avg("lost_inbound_units");
  return (
    <div className={cn(SURFACE, "grid grid-cols-2 gap-2 bg-[#fafafa] px-2.5 py-1.5")}>
      <Stat
        label="Capacity utilization"
        value={util != null ? fmtKpi("capacity_utilization", util) : "not recorded"}
      />
      <Stat
        label="Lost inbound units"
        value={lostInbound != null ? fmtKpi("lost_inbound_units", lostInbound) : "—"}
      />
    </div>
  );
}

function Stat({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
        {label}
      </span>
      <span className="font-mono text-[14px] font-medium tabular-nums text-foreground">
        {value}
        {unit && <span className="ml-1 text-[10px] font-normal text-muted-foreground">{unit}</span>}
      </span>
    </div>
  );
}

