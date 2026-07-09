// Stage 4 — Run & Validate. 4 ordered sub-steps:
//   1. Verification  →  2. Run simulation  →  3. Warm-up detection  →  4. Validation
//
// Run-simulation has two tabs (single run / multi-run). Warm-up detection
// has two sub-steps (replication adequacy + warm-up estimation). Validation
// is a CSV upload + KS/Welch comparison panel.
import { useEffect, useMemo, useState } from "react";
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
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertOctagon,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Database,
  Gauge,
  Info,
  PlayCircle,
  Repeat,
  ShieldCheck,
  Sparkles,
  Timer,
  Upload,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useStageRows } from "@/hooks/useStageRows";
import { useItemMasters } from "@/hooks/useItemMasters";
import { useDatasetVersion } from "@/hooks/useDatasetVersion";
import { useTimeUnit } from "@/hooks/useTimeUnit";
import { useScenarios } from "@/hooks/useScenarios";
import { useSimulationRun } from "@/hooks/useSimulationRun";
import { verifyProjectPolicies, type Finding } from "@/lib/policies/verification";
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
import type { Replication, SimulationRun } from "@/hooks/useSimulationRun";
import type { PolicyBundle, FulfillmentStrategy } from "@/lib/policies/schemas";
import type { OverrideRow } from "@/lib/policies/resolve";
import { PolicyRunStepper } from "./PolicyRunStepper";
import { MaterialFlowAnimated } from "./MaterialFlowAnimated";
import { RunProgressPanel } from "@/components/sim/RunProgressPanel";

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
}

// Engine KPI vocabulary (scsim_bridge _BRIDGE_KEYS / kpi/compute.py) — every
// option here is a real key on run_replications.kpis.
const KPI_OPTIONS = [
  { id: "fill_rate", label: "Fill rate", unit: "%" },
  { id: "max_backlog", label: "Max backlog", unit: "units" },
  { id: "avg_on_hand_value", label: "On-hand value", unit: "€" },
  { id: "revenue", label: "Revenue", unit: "€" },
  { id: "lost_sales_value", label: "Lost sales", unit: "€" },
] as const;
type KpiId = (typeof KPI_OPTIONS)[number]["id"];

// Weekly per-rep series persisted by the worker (run_replications.time_series
// keys) per KPI. lost_sales has no weekly trace → per-rep scalars only.
const SERIES_KEY: Partial<Record<KpiId, string>> = {
  fill_rate: "fill_rate",
  max_backlog: "backlog_units",
  avg_on_hand_value: "on_hand_value",
  revenue: "revenue_value",
};

/** Weekly per-rep series for a KPI from completed replications. */
function repsSeries(reps: Replication[], kpi: KpiId): number[][] {
  const key = SERIES_KEY[kpi];
  if (!key) return [];
  return reps
    .map((r) => r.time_series?.[key])
    .filter((s): s is number[] => Array.isArray(s) && s.length > 0);
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

const DEFAULT_SINGLE: SingleRunCfg = { seed: 1, horizon_days: 365 };
const DEFAULT_MULTI: MultiRunCfg = {
  seeds_mode: "auto",
  replications: 10,
  seeds_list: "1,2,3,4,5",
  horizon_days: 365,
  kpis: ["fill_rate", "max_backlog"],
  confidence: 0.95,
};
const DEFAULT_WARMUP: WarmupCfg = { warmup_days: 30, method: "engine", target_precision: 0.05 };

const SEV_ICON = { block: AlertOctagon, warn: AlertTriangle, info: Info } as const;
const SEV_COLOR = {
  block: "text-destructive border-destructive/40 bg-destructive/10",
  warn: "text-amber-700 dark:text-amber-300 border-amber-500/40 bg-amber-500/10",
  info: "text-muted-foreground border-border bg-muted/40",
} as const;

const STEPS = [
  { id: "verify", label: "Verification", description: "Catch input issues" },
  { id: "run", label: "Run simulation", description: "Single + replications" },
  { id: "warmup", label: "Warm-up detection", description: "Adequacy + estimation" },
  { id: "validate", label: "Validation", description: "Compare with empirical" },
];

// --- tiny deterministic PRNG for preview traces (mulberry32) ----------------
function rng(seed: number) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = t;
    r = Math.imul(r ^ (r >>> 15), r | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

// PRE-RUN illustration only — every rendered use is labeled "illustrative
// preview"; all statistics/validation use persisted run output instead.
function simulateKpiTrace(seed: number, horizon: number, kpi: KpiId): { t: number; v: number }[] {
  const r = rng(seed * 9301 + kpi.length);
  const base =
    kpi === "fill_rate" ? 0.85 : kpi === "max_backlog" ? 12 : kpi === "avg_on_hand_value" ? 250 : kpi === "revenue" ? 5000 : 40;
  const amp = kpi === "fill_rate" ? 0.08 : base * 0.2;
  const transient = Math.max(10, horizon * 0.08);
  const out: { t: number; v: number }[] = [];
  // sample ~120 points
  const step = Math.max(1, Math.floor(horizon / 120));
  for (let t = 0; t <= horizon; t += step) {
    // initial transient drift to steady state
    const drift = t < transient ? (1 - t / transient) * amp * 1.5 * (kpi === "fill_rate" ? -1 : 1) : 0;
    const noise = (r() - 0.5) * amp * 0.6;
    out.push({ t, v: Number((base + drift + noise).toFixed(4)) });
  }
  return out;
}

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
}: Props) {
  const supRows = useStageRows({ projectId, plantName, stage: "supplier" });
  const plantRowsQ = useStageRows({ projectId, plantName, stage: "plant" });
  const custRows = useStageRows({ projectId, plantName, stage: "customer" });
  const itemMasters = useItemMasters(projectId);
  const dataset = useDatasetVersion(projectId);
  const { unit: timeUnit } = useTimeUnit(projectId);

  // Reuse the working experiment.run pipeline (same as Simulation Lab): a saved
  // policy version + a scenario bound to the run, dispatched to the Fly worker.
  const { scenarios, create: createScenario, update: updateScenario } = useScenarios(projectId);
  const [validationScenarioId, setValidationScenarioId] = useState<string | null>(null);
  const { latestRun: dbRun, reps: dbReps, cancelRun, addReps } = useSimulationRun(validationScenarioId);

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

  // Run cfg
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
  const [showTopology, setShowTopology] = useState(false);

  // Warm-up
  const [indicators, setIndicators] = useState<IndicatorUpload[]>([]);
  const [warmupComputed, setWarmupComputed] = useState(false);

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

  const blockCount = useMemo(() => (findings ?? []).filter((f) => f.severity === "block").length, [findings]);
  const warnCount = useMemo(() => (findings ?? []).filter((f) => f.severity === "warn").length, [findings]);

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
      supplierRows: supRows.rows,
      plantRows: plantRowsQ.rows,
      customerRows: custRows.rows,
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
    await updateScenario(scen.id, {
      ...patch,
      disruption_schedule: [],
      recovery_overrides: {},
    });
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
  ): Promise<string> => {
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
        },
        client_ts: Date.now(),
      },
    });
    if (!error) {
      const runId = (data as { run_id?: string } | null)?.run_id;
      if (!runId) throw new Error("sim-command did not return a run_id");
      return runId;
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
    scenario: { seed: number; horizon_days: number; replications: number },
  ) => {
    setValidationScenarioId(scenarioId);

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
        const runId = await dispatchRun(scenarioId, versionId);
        // Clear any previous browser run so stale local rows can't shadow
        // the incoming realtime rows while rep_count_done is still 0.
        setLocalRun(null);
        setLocalReps([]);
        setActiveRunPath("server");
        setServerRunId(runId);
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
        runId = await dispatchRun(scenarioId, versionId, true);
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

  // --- preview traces for multi-run chart ---------------------------------
  const previewSeeds = useMemo(() => {
    if (multiCfg.seeds_mode === "auto") return Array.from({ length: Math.min(multiCfg.replications, 10) }, (_, i) => i + 1);
    return multiCfg.seeds_list.split(/[\s,]+/).map((s) => parseInt(s, 10)).filter((n) => !Number.isNaN(n)).slice(0, 10);
  }, [multiCfg.seeds_mode, multiCfg.replications, multiCfg.seeds_list]);

  // --- render --------------------------------------------------------------
  return (
    <div className="flex flex-col gap-4">
      {warmupComputed && (
        <div className="rounded-md border border-primary/30 bg-primary/5 px-3 py-2 flex flex-wrap items-center gap-2 text-xs">
          <Timer className="h-3.5 w-3.5 text-primary" />
          <span className="font-semibold">Warm-up detected</span>
          <Badge className="h-5 bg-primary/15 text-primary border-primary/30">
            {warmCfg.warmup_days} days
          </Badge>
          <span className="text-muted-foreground">
            method <b className="text-foreground">{warmCfg.method}</b> · target half-width{" "}
            <b className="text-foreground">{(warmCfg.target_precision * 100).toFixed(0)}%</b>
          </span>
          <div className="flex-1" />
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setStep(2)}>
            Tune
          </Button>
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setStep(3)}>
            Go to validation
          </Button>
        </div>
      )}
      <PolicyRunStepper steps={STEPS} current={step} completed={completed} onJump={setStep} />

      <div className="rounded-lg border bg-card p-5 min-h-[320px]">
        {/* 1 — VERIFICATION */}
        {step === 0 && (
          <StepShell
            icon={ShieldCheck}
            title="Verify your inputs"
            action={
              <Button size="sm" onClick={onVerify} className="h-8">
                <ShieldCheck className="h-3.5 w-3.5 mr-1.5" />
                Run checks
              </Button>
            }
          >
            <div className="flex items-center flex-wrap gap-2 text-[11px] text-muted-foreground mb-2">
              <Database className="h-3.5 w-3.5" />
              <span>Dataset</span>
              {dataset.currentHash ? (
                <code className="font-mono">{dataset.currentHash.slice(0, 8)}</code>
              ) : (
                <span className="opacity-60">—</span>
              )}
              {dataset.neverSnapshotted ? (
                <Badge variant="secondary" className="h-5">not snapshotted</Badge>
              ) : dataset.isDirty ? (
                <Badge variant="secondary" className="h-5">changed since last snapshot</Badge>
              ) : (
                <Badge variant="outline" className="h-5">up to date</Badge>
              )}
              <span className="opacity-70">· a snapshot is captured automatically when you run</span>
            </div>
            {findings === null ? (
              <p className="text-xs text-muted-foreground">No checks run yet. Click <b>Run checks</b> to start.</p>
            ) : findings.length === 0 ? (
              <div className="flex items-center gap-2 text-xs text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="h-4 w-4" /> All checks passed.
              </div>
            ) : (
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                  <Badge variant="outline" className="h-5">{findings.length} finding(s)</Badge>
                  {blockCount > 0 && <Badge variant="destructive" className="h-5">{blockCount} blocker(s)</Badge>}
                  {warnCount > 0 && <Badge variant="secondary" className="h-5">{warnCount} warning(s)</Badge>}
                  {verifiedAt && <span>· verified {verifiedAt.toLocaleTimeString()}</span>}
                </div>
                <div className="max-h-60 overflow-auto rounded-md border">
                  <ul className="text-xs divide-y">
                    {findings.map((f) => {
                      const Icon = SEV_ICON[f.severity];
                      return (
                        <li key={f.id} className={cn("flex items-start gap-2 px-2.5 py-1.5 border-l-2", SEV_COLOR[f.severity])}>
                          <Icon className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                          <div className="flex-1 min-w-0">
                            <div className="font-medium">{f.message}</div>
                            {(f.rowKey || f.field) && (
                              <div className="text-[10px] opacity-70 font-mono">{f.rowKey} · {f.field}</div>
                            )}
                            {f.hint && <div className="text-[10px] opacity-80 mt-0.5">{f.hint}</div>}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              </div>
            )}
          </StepShell>
        )}

        {/* 2 — RUN SIMULATION */}
        {step === 1 && (
          <StepShell
            icon={PlayCircle}
            title="Run the simulation"
          >
            {/* Engine self-test + build marker: prove the engine works in THIS
                browser, independent of data/DB, and show which build is live. */}
            <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/30 px-3 py-2">
              <Button size="sm" variant="outline" className="h-7 gap-1.5 text-xs"
                onClick={onSelfTest} disabled={selfTestState.kind === "running"}>
                <Gauge className="h-3.5 w-3.5" />
                {selfTestState.kind === "running" ? "Testing…" : "Test engine"}
              </Button>
              {selfTestState.kind === "running" && (
                <span className="text-[11px] text-muted-foreground">{selfTestState.detail}</span>
              )}
              {selfTestState.kind === "ok" && (
                <span className="inline-flex items-center gap-1 text-[11px] text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 className="h-3.5 w-3.5" /> Engine works — scsim {selfTestState.version}, fill rate {(selfTestState.fillRate * 100).toFixed(1)}% ({selfTestState.reps} reps)
                </span>
              )}
              {selfTestState.kind === "fail" && (
                <span className="inline-flex items-center gap-1 text-[11px] text-destructive">
                  <AlertOctagon className="h-3.5 w-3.5" /> Engine failed: {selfTestState.error}
                </span>
              )}
              {selfTestState.kind === "idle" && engineWarming && (
                <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <span className="h-3 w-3 animate-spin rounded-full border-2 border-muted-foreground/50 border-t-transparent" />
                  Preparing engine (one-time ~20 MB download)…
                </span>
              )}
              {selfTestState.kind === "idle" && engineWarm && (
                <span className="inline-flex items-center gap-1 text-[11px] text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 className="h-3.5 w-3.5" /> Engine ready
                </span>
              )}
              <span className="ml-auto text-[10px] font-mono text-muted-foreground/60" title="Deployed build — if this doesn't change after a deploy, the new code isn't live yet">
                build {String(__BUILD_SHA__)} · {String(__BUILD_TIME__)}
              </span>
            </div>

            {/* Compute location. Server is the default — heavy runs must not
                freeze the tab; the in-browser engine remains the offline
                fallback and is auto-used when the server can't be reached. */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex rounded-md border p-0.5" role="group" aria-label="Compute location">
                <button
                  type="button"
                  onClick={() => setComputeMode("server")}
                  className={cn(
                    "rounded px-2.5 py-1 text-[11px] font-medium transition-colors",
                    computeMode === "server"
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  Run on server (default)
                </button>
                <button
                  type="button"
                  onClick={() => setComputeMode("browser")}
                  className={cn(
                    "rounded px-2.5 py-1 text-[11px] font-medium transition-colors",
                    computeMode === "browser"
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  Run in browser (offline)
                </button>
              </div>
              <span className="text-[10px] text-muted-foreground">
                {computeMode === "server"
                  ? "Runs compute on the simulation server and stream in live — the tab stays free, long runs are safe."
                  : "Offline fallback — the same engine runs locally (WebAssembly, slower; keep the tab open)."}
              </span>
            </div>

            {runPhase.kind !== "idle" && <RunStatusBanner phase={runPhase} />}

            <Tabs value={runTab} onValueChange={(v) => setRunTab(v as "single" | "multi")} className="w-full">
              <TabsList className="grid w-full grid-cols-2 h-9">
                <TabsTrigger value="single" className="text-xs gap-1.5">
                  <PlayCircle className="h-3.5 w-3.5" /> Single run
                  {singleQueuedAt && <Badge variant="outline" className="h-4 px-1 text-[9px] ml-1">queued</Badge>}
                </TabsTrigger>
                <TabsTrigger value="multi" className="text-xs gap-1.5">
                  <Repeat className="h-3.5 w-3.5" /> Multiple runs
                  {multiQueuedAt && <Badge variant="outline" className="h-4 px-1 text-[9px] ml-1">queued</Badge>}
                </TabsTrigger>
              </TabsList>

              <TabsContent value="single" className="mt-3 flex flex-col gap-3">
                <p className="text-[11px] text-muted-foreground">
                  Single run validates one deterministic trajectory. Real engine output —
                  status, KPIs and weekly traces persisted by the worker — appears in the
                  panel below the moment the run finishes.
                </p>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <Field label="Seed">
                    <Input
                      type="number"
                      className="h-8 text-xs"
                      value={singleCfg.seed}
                      onChange={(e) => setSingleCfg((c) => ({ ...c, seed: parseInt(e.target.value, 10) || 1 }))}
                    />
                  </Field>
                  <Field label="Horizon (days)">
                    <Input
                      type="number"
                      className="h-8 text-xs"
                      value={singleCfg.horizon_days}
                      onChange={(e) => setSingleCfg((c) => ({ ...c, horizon_days: parseInt(e.target.value, 10) || 1 }))}
                    />
                  </Field>
                  <div className="flex items-end">
                    <Button size="sm" onClick={onRunSingle} disabled={submitting === "single"} className="w-full gap-1.5">
                      <PlayCircle className="h-3.5 w-3.5" />
                      {submitting === "single" ? "Queueing…" : singleQueuedAt ? "Re-run single" : "Run single"}
                    </Button>
                  </div>
                </div>
                {/* The animation is decorative topology only — collapsed by
                    default so it can't be mistaken for simulation output. */}
                <button
                  type="button"
                  onClick={() => setShowTopology((v) => !v)}
                  className="self-start flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                >
                  {showTopology ? (
                    <ChevronDown className="h-3.5 w-3.5" />
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5" />
                  )}
                  Topology preview (illustrative animation — not simulation output)
                </button>
                {showTopology && (
                  <MaterialFlowAnimated
                    suppliers={supRows.rows}
                    plants={plantRowsQ.rows}
                    customers={custRows.rows}
                    seed={singleCfg.seed}
                    horizonDays={singleCfg.horizon_days}
                  />
                )}
              </TabsContent>

              <TabsContent value="multi" className="mt-3 flex flex-col gap-3">
                <p className="text-[11px] text-muted-foreground">
                  Multiple runs ensure statistical significance — estimates KPI mean ± CI across seeds.
                </p>
                <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-3">
                  {/* Setup card (compact, fixed width on desktop) */}
                  <div className="rounded-md border p-3 flex flex-col gap-3">
                    <h4 className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Setup</h4>
                    <Field label="Seeds">
                      <div className="flex items-center gap-2">
                        <Select
                          value={multiCfg.seeds_mode}
                          onValueChange={(v) => setMultiCfg((c) => ({ ...c, seeds_mode: v as MultiRunCfg["seeds_mode"] }))}
                        >
                          <SelectTrigger className="h-8 w-24 text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="auto">Auto</SelectItem>
                            <SelectItem value="list">List</SelectItem>
                          </SelectContent>
                        </Select>
                        {multiCfg.seeds_mode === "auto" ? (
                          <Input
                            type="number"
                            min={1}
                            className="h-8 text-xs flex-1"
                            value={multiCfg.replications}
                            onChange={(e) => setMultiCfg((c) => ({ ...c, replications: parseInt(e.target.value, 10) || 1 }))}
                          />
                        ) : (
                          <Input
                            className="h-8 text-xs flex-1"
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
                        className="h-8 text-xs"
                        value={multiCfg.horizon_days}
                        onChange={(e) => setMultiCfg((c) => ({ ...c, horizon_days: parseInt(e.target.value, 10) || 1 }))}
                      />
                    </Field>
                    <Field label="Confidence">
                      <Select
                        value={String(multiCfg.confidence)}
                        onValueChange={(v) => setMultiCfg((c) => ({ ...c, confidence: parseFloat(v) }))}
                      >
                        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="0.9">90%</SelectItem>
                          <SelectItem value="0.95">95%</SelectItem>
                          <SelectItem value="0.99">99%</SelectItem>
                        </SelectContent>
                      </Select>
                    </Field>
                    <Field label="Focal KPIs">
                      <div className="flex flex-wrap gap-1.5">
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
                                "h-6 px-2 rounded-full text-[11px] border transition-colors",
                                selected
                                  ? "bg-primary text-primary-foreground border-primary"
                                  : "bg-card hover:bg-muted/50 border-border",
                              )}
                            >
                              {k.label}
                            </button>
                          );
                        })}
                      </div>
                    </Field>
                    <Button size="sm" onClick={onRunMulti} disabled={submitting === "multi"} className="mt-auto gap-1.5">
                      <Repeat className="h-3.5 w-3.5" />
                      {submitting === "multi" ? "Queueing…" : multiQueuedAt ? "Re-run replications" : "Run replications"}
                    </Button>
                  </div>

                  {/* Preview panel: real run data when available, labeled
                      synthetic preview before the first run. */}
                  <MultiRunPreviewPanel
                    kpis={multiCfg.kpis}
                    seeds={previewSeeds}
                    horizon={multiCfg.horizon_days}
                    confidence={multiCfg.confidence}
                    reps={doneReps}
                    warmupWeeks={latestRun?.warmup_detected_at ?? null}
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
              <div className="mt-5 border-t pt-4 flex flex-col gap-3">
                <h4 className="text-xs font-semibold">
                  Engine run — live status &amp; persisted output
                </h4>
                <RunProgressPanel
                  run={latestRun}
                  reps={reps}
                  versionLabel={null}
                  onCancel={() => {
                    // Browser runs: terminate the engine worker (the only way
                    // to interrupt a blocking WASM run) and close out the DB
                    // row if one was created. Server runs: experiment.cancel
                    // via sim-command — never touch the local engine worker,
                    // the browser isn't computing anything.
                    if (activeRunPath !== "server") cancelBrowserRun();
                    if (projectId && dbRun && (dbRun.status === "queued" || dbRun.status === "running")) {
                      void cancelRun(projectId, dbRun.id);
                    }
                  }}
                  onAddReps={(n) => {
                    if (projectId && latestRun) void addReps(projectId, latestRun.id, n);
                  }}
                />
                {latestRun && hasRealData && (
                  <EngineOutputSummary run={latestRun} reps={doneReps} />
                )}
              </div>
            )}
          </StepShell>
        )}

        {/* 3 — WARM-UP DETECTION */}
        {step === 2 && (
          <StepShell
            icon={Timer}
            title="Warm-up detection"
          >
            <div className="flex flex-col gap-5">
              {/* (a) replication adequacy */}
              <section className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <Gauge className="h-3.5 w-3.5 text-primary" />
                  <h4 className="text-xs font-semibold">a) Replication adequacy</h4>
                  <span className="text-[10px] text-muted-foreground">target half-width ≤ {(warmCfg.target_precision * 100).toFixed(0)}% of mean</span>
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
              <section className="flex flex-col gap-2 border-t pt-4">
                <div className="flex items-center gap-2">
                  <Timer className="h-3.5 w-3.5 text-primary" />
                  <h4 className="text-xs font-semibold">b) Warm-up estimation</h4>
                </div>
                <div>
                  <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">Indicators</Label>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
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
                            "h-7 px-2.5 rounded-full text-xs border transition-colors",
                            selected
                              ? "bg-primary text-primary-foreground border-primary"
                              : "bg-card hover:bg-muted/50 border-border",
                          )}
                        >
                          {ind.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
                {indicators.length > 0 && (
                  <div className="flex flex-col gap-2">
                    <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">Upload empirical time-series (optional)</Label>
                    {indicators.map((ind) => {
                      const meta = KPI_OPTIONS.find((x) => x.id === ind.id)!;
                      return (
                        <div key={ind.id} className="flex items-center gap-2 rounded-md border p-2">
                          <span className="text-xs font-medium w-40 shrink-0">{meta.label}</span>
                          <label className="flex-1 cursor-pointer">
                            <input
                              type="file"
                              accept=".csv,text/csv"
                              className="hidden"
                              onChange={(e) => onIndicatorFile(ind.id, e.target.files?.[0] ?? null)}
                            />
                            <div className="flex items-center gap-2 h-8 px-2 rounded-md border border-dashed text-xs text-muted-foreground hover:bg-muted/30">
                              <Upload className="h-3.5 w-3.5" />
                              {ind.fileName ? (
                                <span className="truncate">
                                  <b className="text-foreground">{ind.fileName}</b> · {ind.points} pts
                                </span>
                              ) : (
                                <span>Click to upload CSV (t,value)</span>
                              )}
                            </div>
                          </label>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => setIndicators((cur) => cur.filter((x) => x.id !== ind.id))}
                          >
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                )}
                <div className="flex flex-wrap items-end gap-2 pt-1">
                  <div className="flex flex-col gap-1">
                    <Label className="text-[10px] uppercase tracking-widest">Method</Label>
                    <Select
                      value={warmCfg.method}
                      onValueChange={(v) => setWarmCfg((c) => ({ ...c, method: v as WarmupCfg["method"] }))}
                    >
                      <SelectTrigger className="h-8 w-44 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="engine">Engine (most conservative)</SelectItem>
                        <SelectItem value="welch">Welch moving average</SelectItem>
                        <SelectItem value="mser5">MSER-5</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex flex-col gap-1">
                    <Label className="text-[10px] uppercase tracking-widest">Warm-up (days)</Label>
                    <Input
                      type="number"
                      className="h-8 w-32 text-xs"
                      value={warmCfg.warmup_days}
                      onChange={(e) => setWarmCfg((c) => ({ ...c, warmup_days: parseInt(e.target.value, 10) || 0 }))}
                    />
                  </div>
                  <Button size="sm" variant="outline" className="h-8" onClick={detectWarmup}>
                    Auto-detect
                  </Button>
                </div>
                {warmupComputed && (
                  <div className="flex flex-col gap-3 mt-2">
                    <div className="rounded-md border bg-card p-3 flex flex-wrap items-center gap-3">
                      <div className="flex items-center gap-2">
                        <Timer className="h-3.5 w-3.5 text-primary" />
                        <span className="text-xs font-semibold">Detected warm-up</span>
                      </div>
                      <Badge className="h-5 bg-primary/15 text-primary border-primary/30">
                        {warmCfg.warmup_days} days
                      </Badge>
                      <span className="text-[11px] text-muted-foreground">
                        method: <b className="text-foreground">{warmCfg.method}</b>
                      </span>
                      <span className="text-[11px] text-muted-foreground">
                        reps: <b className="text-foreground">{previewSeeds.length}</b>
                      </span>
                      <div className="flex-1" />
                      <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setStep(3)}>
                        Apply to validation
                      </Button>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {(indicators.length > 0 ? indicators.map((i) => i.id) : multiCfg.kpis).map((kpi) => (
                        <KpiPreviewChart
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
            icon={Sparkles}
            title="Validate against empirical data"
            subtitle={`Steady-state (t > ${warmCfg.warmup_days}d) · KS + Welch t-test`}
          >
            <div className="flex flex-col gap-3">
              {multiCfg.kpis.length === 0 ? (
                <div className="rounded-md border border-dashed p-4 text-xs text-muted-foreground">
                  Pick at least one focal KPI in <b>Run simulation</b> first.
                </div>
              ) : (
                <>
                  <div className="flex flex-col gap-2">
                    {multiCfg.kpis.map((kpi) => {
                      const meta = KPI_OPTIONS.find((x) => x.id === kpi)!;
                      const emp = empirical[kpi];
                      return (
                        <div key={kpi} className="flex items-center gap-2 rounded-md border p-2">
                          <span className="text-xs font-medium w-40 shrink-0">{meta.label}</span>
                          <label className="flex-1 cursor-pointer">
                            <input
                              type="file"
                              accept=".csv,text/csv"
                              className="hidden"
                              onChange={(e) => onEmpiricalFile(kpi, e.target.files?.[0] ?? null)}
                            />
                            <div className="flex items-center gap-2 h-8 px-2 rounded-md border border-dashed text-xs text-muted-foreground hover:bg-muted/30">
                              <Upload className="h-3.5 w-3.5" />
                              {emp ? (
                                <span className="truncate">
                                  <b className="text-foreground">{emp.fileName}</b> · {emp.values.length} pts
                                </span>
                              ) : (
                                <span>Click to upload empirical CSV ({meta.unit})</span>
                              )}
                            </div>
                          </label>
                        </div>
                      );
                    })}
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" onClick={runValidation} disabled={Object.keys(empirical).length === 0}>
                      Run validation
                    </Button>
                  </div>
                  {validationResult && (
                    <div className="rounded-md border">
                      <table className="w-full text-xs">
                        <thead className="bg-muted/40">
                          <tr>
                            <th className="text-left px-2 py-1.5">KPI</th>
                            <th className="text-right px-2 py-1.5">KS D</th>
                            <th className="text-right px-2 py-1.5">KS p</th>
                            <th className="text-right px-2 py-1.5">t</th>
                            <th className="text-right px-2 py-1.5">t p</th>
                            <th className="text-right px-2 py-1.5">n sim</th>
                            <th className="text-left px-2 py-1.5">Source</th>
                            <th className="text-right px-2 py-1.5">Result</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y">
                          {validationResult.map((r) => {
                            const meta = KPI_OPTIONS.find((x) => x.id === r.kpi)!;
                            return (
                              <tr key={r.kpi}>
                                <td className="px-2 py-1.5">{meta.label}</td>
                                <td className="text-right px-2 py-1.5 font-mono">{Number.isNaN(r.ks) ? "—" : r.ks}</td>
                                <td className="text-right px-2 py-1.5 font-mono">{Number.isNaN(r.ksP) ? "—" : r.ksP}</td>
                                <td className="text-right px-2 py-1.5 font-mono">{Number.isNaN(r.t) ? "—" : r.t}</td>
                                <td className="text-right px-2 py-1.5 font-mono">{Number.isNaN(r.tP) ? "—" : r.tP}</td>
                                <td className="text-right px-2 py-1.5 font-mono">{r.n || "—"}</td>
                                <td className="px-2 py-1.5 text-muted-foreground">{r.source}</td>
                                <td className="text-right px-2 py-1.5">
                                  {Number.isNaN(r.ks) ? (
                                    <Badge variant="outline" className="h-5">no data</Badge>
                                  ) : r.pass ? (
                                    <Badge className="h-5 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30">pass</Badge>
                                  ) : (
                                    <Badge variant="destructive" className="h-5">fail</Badge>
                                  )}
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
            </div>
          </StepShell>
        )}
      </div>

      {/* Persistent footer */}
      <div className="flex items-center justify-between border-t pt-3">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setStep((s) => Math.max(0, s - 1))}
          disabled={step === 0}
        >
          <ArrowLeft className="h-3.5 w-3.5 mr-1.5" /> Back
        </Button>
        <span className="text-xs text-muted-foreground">
          Step {step + 1} of {STEPS.length}
        </span>
        <Button
          size="sm"
          onClick={() => setStep((s) => Math.min(STEPS.length - 1, s + 1))}
          disabled={step === STEPS.length - 1 || !canContinue(step)}
          title={!canContinue(step) ? "Complete the current step first" : undefined}
        >
          Continue <ArrowRight className="h-3.5 w-3.5 ml-1.5" />
        </Button>
      </div>
    </div>
  );
}

// ============= Inline sub-components ==========================================

function StepShell({
  icon: Icon,
  title,
  subtitle,
  action,
  children,
}: {
  icon: typeof PlayCircle;
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start gap-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
          <Icon className="h-4 w-4" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold">{title}</h3>
          {subtitle && <p className="text-[11px] text-muted-foreground mt-0.5">{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <Label className="text-[10px] uppercase tracking-widest">{label}</Label>
      {children}
    </div>
  );
}

// Lightweight Sankey-style material flow diagram (pure SVG).
function MaterialFlowSankey({
  suppliers,
  plants,
  customers,
}: {
  suppliers: any[];
  plants: any[];
  customers: any[];
}) {
  const sup = suppliers.slice(0, 6);
  const pl = plants.slice(0, 4);
  const cu = customers.slice(0, 6);
  const empty = sup.length + pl.length + cu.length === 0;
  if (empty) {
    return (
      <div className="rounded-md border border-dashed p-3 text-[11px] text-muted-foreground">
        Material flow diagram will appear here once supplier / plant / customer data is loaded.
      </div>
    );
  }
  const W = 720;
  const H = 220;
  const colX = [40, W / 2 - 30, W - 40];
  const rowsY = (n: number) =>
    Array.from({ length: n }, (_, i) => 30 + (i * (H - 60)) / Math.max(1, n - 1 || 1));
  const sY = rowsY(sup.length);
  const pY = rowsY(pl.length);
  const cY = rowsY(cu.length);
  return (
    <div className="rounded-md border bg-card overflow-x-auto">
      <div className="p-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
        Material flow preview
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-[220px]">
        {/* edges sup → plant */}
        {sup.map((s, i) =>
          pl.map((_, j) => (
            <path
              key={`sp-${i}-${j}`}
              d={`M ${colX[0] + 60} ${sY[i]} C ${(colX[0] + colX[1]) / 2} ${sY[i]}, ${(colX[0] + colX[1]) / 2} ${pY[j]}, ${colX[1]} ${pY[j]}`}
              fill="none"
              stroke="hsl(var(--primary))"
              strokeOpacity={0.25}
              strokeWidth={2}
            />
          )),
        )}
        {/* edges plant → cust */}
        {pl.map((_, i) =>
          cu.map((_, j) => (
            <path
              key={`pc-${i}-${j}`}
              d={`M ${colX[1] + 80} ${pY[i]} C ${(colX[1] + colX[2]) / 2} ${pY[i]}, ${(colX[1] + colX[2]) / 2} ${cY[j]}, ${colX[2] - 60} ${cY[j]}`}
              fill="none"
              stroke="hsl(var(--primary))"
              strokeOpacity={0.18}
              strokeWidth={2}
            />
          )),
        )}
        {/* nodes */}
        {sup.map((s, i) => (
          <g key={`s-${i}`}>
            <rect x={colX[0]} y={sY[i] - 10} width={60} height={20} rx={4} fill="hsl(var(--muted))" stroke="hsl(var(--border))" />
            <text x={colX[0] + 30} y={sY[i] + 4} textAnchor="middle" fontSize={9} fill="hsl(var(--foreground))">
              {String((s as any).supplier_id ?? (s as any).key ?? `S${i + 1}`).slice(0, 8)}
            </text>
          </g>
        ))}
        {pl.map((p, i) => (
          <g key={`p-${i}`}>
            <rect x={colX[1]} y={pY[i] - 12} width={80} height={24} rx={4} fill="hsl(var(--primary) / 0.15)" stroke="hsl(var(--primary))" />
            <text x={colX[1] + 40} y={pY[i] + 4} textAnchor="middle" fontSize={9} fill="hsl(var(--foreground))" fontWeight={600}>
              {String((p as any).plant_name ?? (p as any).key ?? `P${i + 1}`).slice(0, 10)}
            </text>
          </g>
        ))}
        {cu.map((c, i) => (
          <g key={`c-${i}`}>
            <rect x={colX[2] - 60} y={cY[i] - 10} width={60} height={20} rx={4} fill="hsl(var(--muted))" stroke="hsl(var(--border))" />
            <text x={colX[2] - 30} y={cY[i] + 4} textAnchor="middle" fontSize={9} fill="hsl(var(--foreground))">
              {String((c as any).customer_id ?? (c as any).key ?? `C${i + 1}`).slice(0, 8)}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}

/** Real per-replication weekly traces for KPIs with a persisted weekly
 *  series; scalar-only KPIs get an explanatory note. Warm-up line in weeks. */
function KpiPreviewChart({
  kpi,
  reps,
  warmup,
}: {
  kpi: KpiId;
  reps: Replication[];
  warmup?: number;
}) {
  const meta = KPI_OPTIONS.find((x) => x.id === kpi)!;
  const traces = useMemo(() => repsSeries(reps, kpi).slice(0, 8), [reps, kpi]);
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

  if (!SERIES_KEY[kpi]) {
    return (
      <div className="rounded-md border border-dashed bg-card p-3 text-[11px] text-muted-foreground">
        <b className="text-foreground">{meta.label}</b>: no weekly series persisted for this KPI
        — it is validated from per-replication values instead.
      </div>
    );
  }
  if (data.length === 0) {
    return (
      <div className="rounded-md border border-dashed bg-card p-3 text-[11px] text-muted-foreground">
        <b className="text-foreground">{meta.label}</b>: run replications to see the real weekly
        traces here.
      </div>
    );
  }
  const warmupWeeks = warmup !== undefined ? Math.round(warmup / 7) : undefined;
  return (
    <div className="rounded-md border bg-card p-2">
      <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-1">
        {meta.label} <span className="font-normal opacity-70">({meta.unit})</span>
        <span className="ml-2 font-normal normal-case tracking-normal text-emerald-600 dark:text-emerald-400">
          engine data · {traces.length} rep(s)
        </span>
      </div>
      <ResponsiveContainer width="100%" height={140}>
        <LineChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid strokeOpacity={0.15} />
          <XAxis dataKey="week" tick={{ fontSize: 9 }} />
          <YAxis tick={{ fontSize: 9 }} width={36} domain={["auto", "auto"]} />
          <RTooltip contentStyle={{ fontSize: 10 }} />
          {warmupWeeks !== undefined && warmupWeeks > 0 && (
            <ReferenceLine x={warmupWeeks} stroke="hsl(var(--destructive))" strokeDasharray="4 3" label={{ value: "warm-up", fontSize: 9, fill: "hsl(var(--destructive))" }} />
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
  // REAL per-replication KPI values from run_replications.kpis.
  const rows = useMemo(() => {
    if (kpis.length === 0 || reps.length === 0) return [];
    return kpis.map((kpi) => {
      const values = reps
        .map((r) => Number(r.kpis[kpi]))
        .filter((n) => Number.isFinite(n));
      const stats = meanCI(values, confidence);
      const rel = stats.mean !== 0 ? stats.half / Math.abs(stats.mean) : 0;
      return { kpi, ...stats, rel, adequate: rel <= target };
    });
  }, [kpis, reps, confidence, target]);

  if (kpis.length === 0) {
    return (
      <div className="rounded-md border border-dashed p-3 text-[11px] text-muted-foreground">
        Select focal KPIs in <b>Run simulation</b> to assess replication adequacy.
      </div>
    );
  }
  if (reps.length === 0) {
    return (
      <div className="rounded-md border border-dashed p-3 text-[11px] text-muted-foreground">
        No completed replications yet — run replications in <b>Run simulation</b>; adequacy is
        computed from the real per-replication KPIs.
      </div>
    );
  }
  const insufficient = rows.filter((r) => !r.adequate);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Label className="text-[10px] uppercase tracking-widest">Target half-width</Label>
        <Input
          type="number"
          step={0.01}
          min={0.01}
          max={0.5}
          className="h-7 w-20 text-xs"
          value={target}
          onChange={(e) => onTargetChange(parseFloat(e.target.value) || 0.05)}
        />
      </div>
      <div className="rounded-md border overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-muted/40">
            <tr>
              <th className="text-left px-2 py-1.5">KPI</th>
              <th className="text-right px-2 py-1.5">Mean</th>
              <th className="text-right px-2 py-1.5">Std</th>
              <th className="text-right px-2 py-1.5">n</th>
              <th className="text-right px-2 py-1.5">Half-width</th>
              <th className="text-right px-2 py-1.5">Rel.</th>
              <th className="text-right px-2 py-1.5">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((r) => {
              const meta = KPI_OPTIONS.find((x) => x.id === r.kpi)!;
              return (
                <tr key={r.kpi}>
                  <td className="px-2 py-1.5">{meta.label}</td>
                  <td className="text-right px-2 py-1.5 font-mono">{r.mean.toFixed(3)}</td>
                  <td className="text-right px-2 py-1.5 font-mono">{r.std.toFixed(3)}</td>
                  <td className="text-right px-2 py-1.5 font-mono">{r.n}</td>
                  <td className="text-right px-2 py-1.5 font-mono">{r.half.toFixed(3)}</td>
                  <td className="text-right px-2 py-1.5 font-mono">{(r.rel * 100).toFixed(1)}%</td>
                  <td className="text-right px-2 py-1.5">
                    {r.adequate ? (
                      <Badge className="h-5 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30">adequate</Badge>
                    ) : (
                      <Badge variant="destructive" className="h-5">need more</Badge>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {insufficient.length > 0 && (
        <Button size="sm" variant="outline" className="self-start" onClick={() => onAddReps(10)}>
          Add 10 replications
        </Button>
      )}
    </div>
  );
}

// Focused multi-run panel: REAL run data when replications exist (weekly
// fill-rate traces / running-mean convergence for scalar KPIs), else a
// clearly-labeled synthetic preview.
function MultiRunPreviewPanel({
  kpis,
  seeds,
  horizon,
  confidence,
  reps,
  warmupWeeks,
}: {
  kpis: KpiId[];
  seeds: number[];
  horizon: number;
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
      <div className="rounded-md border border-dashed p-6 text-center text-xs text-muted-foreground flex items-center justify-center">
        Pick at least one focal KPI to preview traces.
      </div>
    );
  }

  const meta = KPI_OPTIONS.find((k) => k.id === activeKpi)!;

  // ── REAL data branch ──────────────────────────────────────────────────
  if (reps.length > 0) {
    const values = reps
      .map((r) => Number(r.kpis[activeKpi]))
      .filter((n) => Number.isFinite(n));
    const overallReal = meanCI(values, confidence);
    const weekly = repsSeries(reps, activeKpi);
    return (
      <div className="rounded-md border bg-card flex flex-col">
        <div className="flex items-center gap-1 border-b px-2 py-1.5 overflow-x-auto">
          {kpis.map((id) => {
            const k = KPI_OPTIONS.find((x) => x.id === id)!;
            const active = id === activeKpi;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setActiveKpi(id)}
                className={cn(
                  "h-7 px-2.5 rounded-md text-[11px] border transition-colors whitespace-nowrap",
                  active
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-transparent hover:bg-muted/50 border-transparent",
                )}
              >
                {k.label}
              </button>
            );
          })}
          <span className="ml-auto text-[10px] text-emerald-600 dark:text-emerald-400 whitespace-nowrap pr-1">
            engine data · {reps.length} rep(s)
          </span>
        </div>
        <div className="grid grid-cols-4 gap-2 border-b px-3 py-2 text-[11px]">
          <Stat label="Mean" value={overallReal.mean.toFixed(3)} unit={meta.unit} />
          <Stat label="Std" value={overallReal.std.toFixed(3)} />
          <Stat label="CI half-width" value={overallReal.half.toFixed(3)} />
          <Stat label="n reps" value={String(values.length)} />
        </div>
        <div className="p-2">
          {weekly.length > 0 ? (
            <RealWeeklyTraces frSeries={weekly} confidence={confidence} warmupWeeks={warmupWeeks} />
          ) : (
            <ConvergencePlot reps={reps} primaryKpi={activeKpi} warmupAt={null} />
          )}
        </div>
        <div className="border-t px-3 py-2 text-[10px] text-muted-foreground">
          {weekly.length > 0
            ? "Weekly per-replication series (engine output) with cross-rep mean ± CI."
            : "Running mean ± 95% CI as replications accumulate — no weekly series persisted for this KPI."}
        </div>
      </div>
    );
  }

  // ── Synthetic pre-run preview (clearly labeled) ───────────────────────
  if (seeds.length === 0) {
    return (
      <div className="rounded-md border border-dashed p-6 text-center text-xs text-muted-foreground flex items-center justify-center">
        Provide at least one seed to preview.
      </div>
    );
  }
  const traces = seeds.map((s) => simulateKpiTrace(s, horizon, activeKpi));
  const ts = traces[0].map((p) => p.t);

  // mean ± CI band at each timepoint
  const data = ts.map((t, idx) => {
    const vals = traces.map((tr) => tr[idx]?.v ?? 0);
    const stats = meanCI(vals, confidence);
    const row: Record<string, number> = {
      t,
      mean: stats.mean,
      lower: stats.mean - stats.half,
      upper: stats.mean + stats.half,
    };
    seeds.forEach((s, i) => { row[`s${s}`] = vals[i]; });
    return row;
  });

  // overall summary from per-seed time-average (skip first 20% warmup)
  const tailMeans = traces.map((tr) => {
    const tail = tr.slice(Math.floor(tr.length * 0.2));
    return tail.reduce((a, b) => a + b.v, 0) / Math.max(1, tail.length);
  });
  const overall = meanCI(tailMeans, confidence);

  return (
    <div className="rounded-md border bg-card flex flex-col">
      {/* KPI tab strip */}
      <div className="flex items-center gap-1 border-b px-2 py-1.5 overflow-x-auto">
        {kpis.map((id) => {
          const k = KPI_OPTIONS.find((x) => x.id === id)!;
          const active = id === activeKpi;
          return (
            <button
              key={id}
              type="button"
              onClick={() => setActiveKpi(id)}
              className={cn(
                "h-7 px-2.5 rounded-md text-[11px] border transition-colors whitespace-nowrap",
                active
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-transparent hover:bg-muted/50 border-transparent",
              )}
            >
              {k.label}
            </button>
          );
        })}
        <span className="ml-auto text-[10px] text-amber-600 dark:text-amber-400 whitespace-nowrap pr-1">
          illustrative preview — run to see real data
        </span>
      </div>

      {/* summary strip */}
      <div className="grid grid-cols-4 gap-2 border-b px-3 py-2 text-[11px]">
        <Stat label="Mean" value={overall.mean.toFixed(3)} unit={meta.unit} />
        <Stat label="Std" value={overall.std.toFixed(3)} />
        <Stat label="CI half-width" value={overall.half.toFixed(3)} />
        <Stat label="n seeds" value={String(seeds.length)} />
      </div>

      {/* main chart */}
      <div className="p-2">
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="ciBand" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.25} />
                <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0.05} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeOpacity={0.15} />
            <XAxis dataKey="t" tick={{ fontSize: 10 }} label={{ value: "day", fontSize: 10, position: "insideBottom", offset: -2 }} />
            <YAxis tick={{ fontSize: 10 }} width={40} />
            <RTooltip contentStyle={{ fontSize: 11 }} />
            {/* CI band rendered as upper/lower lines with subtle fill via stack */}
            <Line type="monotone" dataKey="upper" stroke="hsl(var(--primary) / 0.2)" strokeWidth={1} dot={false} isAnimationActive={false} />
            <Line type="monotone" dataKey="lower" stroke="hsl(var(--primary) / 0.2)" strokeWidth={1} dot={false} isAnimationActive={false} />
            {seeds.slice(0, 10).map((s, i) => (
              <Line
                key={s}
                type="monotone"
                dataKey={`s${s}`}
                stroke={`hsl(${(i * 47) % 360} 65% 55%)`}
                strokeOpacity={0.4}
                strokeWidth={0.8}
                dot={false}
                isAnimationActive={false}
              />
            ))}
            <Line
              type="monotone"
              dataKey="mean"
              stroke="hsl(var(--primary))"
              strokeWidth={2.2}
              dot={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* per-seed legend */}
      <div className="flex flex-wrap items-center gap-2 border-t px-3 py-2 text-[10px] text-muted-foreground">
        <span className="font-semibold uppercase tracking-widest">Seeds</span>
        {seeds.slice(0, 10).map((s, i) => (
          <span key={s} className="inline-flex items-center gap-1">
            <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: `hsl(${(i * 47) % 360} 65% 55%)` }} />
            {s}
          </span>
        ))}
        {seeds.length > 10 && <span>+{seeds.length - 10} more</span>}
        <span className="ml-auto inline-flex items-center gap-1">
          <span className="inline-block h-0.5 w-4 bg-primary" /> mean
        </span>
      </div>
    </div>
  );
}

/** Real per-replication weekly fill-rate traces + cross-rep mean ± CI band. */
function RealWeeklyTraces({
  frSeries,
  confidence,
  warmupWeeks,
}: {
  frSeries: number[][];
  confidence: number;
  warmupWeeks: number | null;
}) {
  const shown = frSeries.slice(0, 10);
  const data = useMemo(() => {
    const n = Math.min(...shown.map((s) => s.length));
    if (!Number.isFinite(n) || n <= 0) return [];
    return Array.from({ length: n }, (_, week) => {
      const vals = shown.map((s) => s[week]);
      const stats = meanCI(vals, confidence);
      const row: Record<string, number> = {
        week,
        mean: stats.mean,
        lower: stats.mean - stats.half,
        upper: stats.mean + stats.half,
      };
      shown.forEach((s, i) => {
        row[`r${i}`] = s[week];
      });
      return row;
    });
  }, [shown, confidence]);
  if (data.length === 0) return null;
  return (
    <ResponsiveContainer width="100%" height={260}>
      <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
        <CartesianGrid strokeOpacity={0.15} />
        <XAxis dataKey="week" tick={{ fontSize: 10 }} label={{ value: "week", fontSize: 10, position: "insideBottom", offset: -2 }} />
        <YAxis tick={{ fontSize: 10 }} width={40} domain={["auto", "auto"]} />
        <RTooltip contentStyle={{ fontSize: 11 }} />
        {warmupWeeks != null && warmupWeeks > 0 && (
          <ReferenceLine x={warmupWeeks} stroke="hsl(var(--destructive))" strokeDasharray="4 3" label={{ value: "warm-up", fontSize: 9, fill: "hsl(var(--destructive))" }} />
        )}
        <Line type="monotone" dataKey="upper" stroke="hsl(var(--primary) / 0.2)" strokeWidth={1} dot={false} isAnimationActive={false} />
        <Line type="monotone" dataKey="lower" stroke="hsl(var(--primary) / 0.2)" strokeWidth={1} dot={false} isAnimationActive={false} />
        {shown.map((_, i) => (
          <Line
            key={i}
            type="monotone"
            dataKey={`r${i}`}
            stroke={`hsl(${(i * 47) % 360} 65% 55%)`}
            strokeOpacity={0.4}
            strokeWidth={0.8}
            dot={false}
            isAnimationActive={false}
          />
        ))}
        <Line type="monotone" dataKey="mean" stroke="hsl(var(--primary))" strokeWidth={2.2} dot={false} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

function fmtKpi(id: string, v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  if (id === "fill_rate") return `${(v * 100).toFixed(1)}%`;
  return Math.abs(v) >= 1000 ? Math.round(v).toLocaleString() : v.toFixed(2);
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
  if (phase.kind === "loading" || phase.kind === "computing") {
    const label =
      phase.kind === "computing"
        ? phase.total
          ? `Running the engine — replication ${Math.min((phase.done ?? 0) + 1, phase.total)} / ${phase.total}…`
          : "Running the engine…"
        : phase.detail;
    return (
      <div className="flex items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-200">
        <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-amber-500 border-t-transparent" />
        <span className="font-medium">{label}</span>
        <span className="text-[11px] font-normal text-amber-700/80 dark:text-amber-300/80">
          the page stays responsive — you can keep working, or Cancel below
        </span>
      </div>
    );
  }
  if (phase.kind === "failed") {
    return (
      <div className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2.5 text-sm">
        <AlertOctagon className="h-4 w-4 mt-0.5 shrink-0 text-destructive" />
        <div>
          <div className="font-semibold text-destructive">Simulation failed at {phase.step}</div>
          <div className="text-xs text-destructive/90 mt-0.5 break-words">{phase.message}</div>
        </div>
      </div>
    );
  }
  return (
    <div className="flex items-start gap-2 rounded-md border border-emerald-500/50 bg-emerald-500/10 px-3 py-2.5 text-sm">
      <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
      <div>
        <div className="font-semibold text-emerald-700 dark:text-emerald-300">Simulation ran successfully</div>
        <div className="text-xs text-foreground/80 mt-0.5">{phase.summary}</div>
        {phase.persisted === false && (
          <div className="text-[11px] text-amber-700 dark:text-amber-300 mt-1">
            Shown from this session only — not saved to history (DB write grants not yet applied); it will disappear on reload.
          </div>
        )}
      </div>
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

/** Engine output for the latest validation run: aggregate KPIs ± CI
 *  half-widths (simulation_runs) and real weekly per-replication traces
 *  (run_replications.time_series). Nothing here is synthetic. */
function EngineOutputSummary({ run, reps }: { run: SimulationRun; reps: Replication[] }) {
  const agg = run.aggregate_kpis ?? {};
  const ci = run.ci_half_widths ?? {};
  const warmupDays = run.warmup_detected_at != null ? run.warmup_detected_at * 7 : undefined;
  const streaming = run.status === "running" || run.status === "queued";
  return (
    <div className="rounded-md border bg-card">
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
        <Sparkles className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
        <span className="text-xs font-semibold">Engine output</span>
        {streaming ? (
          <span className="text-[10px] text-amber-600 dark:text-amber-400 animate-pulse">
            ● live — {reps.length} replication(s) streamed, run in progress
          </span>
        ) : (
          <span className="text-[10px] text-emerald-600 dark:text-emerald-400">
            complete · {reps.length} replication(s)
          </span>
        )}
        <div className="flex-1" />
        {run.policy_hash && (
          <span
            className="text-[10px] font-mono text-muted-foreground"
            title="SHA-256 of the policy version this run is bound to"
          >
            policy {run.policy_hash.slice(0, 8)}
          </span>
        )}
        {run.ended_at && (
          <span className="text-[10px] text-muted-foreground">
            finished {new Date(run.ended_at).toLocaleString()}
          </span>
        )}
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 border-b px-3 py-2 text-[11px]">
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
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2 p-2">
        {(["fill_rate", "max_backlog", "avg_on_hand_value", "revenue"] as KpiId[]).map((kpi) => (
          <KpiPreviewChart key={kpi} kpi={kpi} reps={reps} warmup={warmupDays} />
        ))}
      </div>
    </div>
  );
}

function Stat({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-[9px] uppercase tracking-widest text-muted-foreground">{label}</span>
      <span className="font-mono tabular-nums text-foreground">
        {value}
        {unit && <span className="text-muted-foreground/70 ml-1 text-[10px]">{unit}</span>}
      </span>
    </div>
  );
}

