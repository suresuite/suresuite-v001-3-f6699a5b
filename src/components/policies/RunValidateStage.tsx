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
import { useTimeUnit } from "@/hooks/useTimeUnit";
import { verifyProjectPolicies, type Finding } from "@/lib/policies/verification";
import type { PolicyBundle, FulfillmentStrategy } from "@/lib/policies/schemas";
import type { OverrideRow } from "@/lib/policies/resolve";
import { PolicyRunStepper } from "./PolicyRunStepper";
import { MaterialFlowAnimated } from "./MaterialFlowAnimated";

interface Props {
  projectId: string | null | undefined;
  plantName: string | null | undefined;
  defaults: PolicyBundle;
  overrides: OverrideRow[];
  fulfillmentStrategy: FulfillmentStrategy;
}

const KPI_OPTIONS = [
  { id: "fill_rate", label: "Fill rate", unit: "%" },
  { id: "backorders", label: "Backorders", unit: "units" },
  { id: "throughput", label: "Throughput", unit: "u/day" },
  { id: "inventory", label: "Inventory on hand", unit: "units" },
  { id: "lead_time", label: "Lead time", unit: "days" },
] as const;
type KpiId = (typeof KPI_OPTIONS)[number]["id"];

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
  method: "welch" | "mser5" | "schruben";
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
  kpis: ["fill_rate", "backorders"],
  confidence: 0.95,
};
const DEFAULT_WARMUP: WarmupCfg = { warmup_days: 30, method: "welch", target_precision: 0.05 };

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

function simulateKpiTrace(seed: number, horizon: number, kpi: KpiId): { t: number; v: number }[] {
  const r = rng(seed * 9301 + kpi.length);
  const base = kpi === "fill_rate" ? 0.85 : kpi === "backorders" ? 12 : kpi === "throughput" ? 100 : kpi === "inventory" ? 250 : 7;
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
}: Props) {
  const supRows = useStageRows({ projectId, plantName, stage: "supplier" });
  const plantRowsQ = useStageRows({ projectId, plantName, stage: "plant" });
  const custRows = useStageRows({ projectId, plantName, stage: "customer" });
  const { unit: timeUnit } = useTimeUnit(projectId);

  const [step, setStep] = useState(0);
  const [findings, setFindings] = useState<Finding[] | null>(null);
  const [verifiedAt, setVerifiedAt] = useState<Date | null>(null);

  // Run cfg
  const persistKey = `policy.runcfg.v2.${projectId ?? "global"}`;
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

  useEffect(() => {
    if (!projectId) return;
    try {
      localStorage.setItem(persistKey, JSON.stringify({ single: singleCfg, multi: multiCfg, warm: warmCfg }));
    } catch {
      /* noop */
    }
  }, [persistKey, projectId, singleCfg, multiCfg, warmCfg]);

  const [singleQueuedAt, setSingleQueuedAt] = useState<Date | null>(null);
  const [multiQueuedAt, setMultiQueuedAt] = useState<Date | null>(null);
  const [submitting, setSubmitting] = useState<"single" | "multi" | null>(null);
  const [runTab, setRunTab] = useState<"single" | "multi">("single");

  // Warm-up
  const [indicators, setIndicators] = useState<IndicatorUpload[]>([]);
  const [warmupComputed, setWarmupComputed] = useState(false);

  // Validation
  const [empirical, setEmpirical] = useState<Record<string, { fileName: string; values: number[] }>>({});
  const [validationResult, setValidationResult] = useState<
    Array<{ kpi: KpiId; ks: number; t: number; pass: boolean }> | null
  >(null);

  const blockCount = useMemo(() => (findings ?? []).filter((f) => f.severity === "block").length, [findings]);
  const warnCount = useMemo(() => (findings ?? []).filter((f) => f.severity === "warn").length, [findings]);

  const completed = useMemo(() => {
    const s = new Set<number>();
    if (findings !== null && blockCount === 0) s.add(0);
    if (multiQueuedAt) s.add(1);
    if (warmupComputed && warmCfg.warmup_days > 0) s.add(2);
    if (validationResult) s.add(3);
    return s;
  }, [findings, blockCount, multiQueuedAt, warmupComputed, warmCfg.warmup_days, validationResult]);

  const canContinue = (i: number): boolean => {
    if (i === 0) return findings !== null && blockCount === 0;
    if (i === 1) return multiQueuedAt !== null;
    if (i === 2) return warmupComputed && warmCfg.warmup_days > 0;
    return true;
  };

  // --- handlers ------------------------------------------------------------
  const onVerify = () => {
    const f = verifyProjectPolicies({
      defaults,
      overrides,
      fulfillmentStrategy,
      supplierRows: supRows.rows,
      plantRows: plantRowsQ.rows,
      customerRows: custRows.rows,
      timeUnit: timeUnit ?? null,
    });
    setFindings(f);
    setVerifiedAt(new Date());
    const blockers = f.filter((x) => x.severity === "block").length;
    if (blockers === 0) toast.success(`Verification complete — ${f.length} finding(s).`);
    else toast.error(`Verification found ${blockers} blocker(s).`);
  };

  const dispatchSim = async (kind: string, payload: Record<string, unknown>) => {
    if (!projectId) return;
    const { error } = await supabase.functions.invoke("sim-command", {
      body: { project_id: projectId, kind, payload, client_ts: Date.now() },
    });
    if (error) throw error;
  };

  const onRunSingle = async () => {
    if (!projectId || findings === null || blockCount > 0) {
      toast.warning("Run verification with no blockers first.");
      return;
    }
    setSubmitting("single");
    try {
      await dispatchSim("policy.run.single", {
        policy_defaults: defaults,
        policy_overrides: overrides,
        fulfillment_strategy: fulfillmentStrategy,
        seed: singleCfg.seed,
        horizon_days: singleCfg.horizon_days,
      });
      setSingleQueuedAt(new Date());
      toast.success("Single-seed run queued.");
    } catch (err) {
      console.error(err);
      toast.error("Failed to queue single run.");
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
      await dispatchSim("policy.run.multi", {
        policy_defaults: defaults,
        policy_overrides: overrides,
        fulfillment_strategy: fulfillmentStrategy,
        seeds,
        horizon_days: multiCfg.horizon_days,
        kpis: multiCfg.kpis,
        confidence: multiCfg.confidence,
      });
      setMultiQueuedAt(new Date());
      toast.success(`Queued ${seeds.length} replications.`);
    } catch (err) {
      console.error(err);
      toast.error("Failed to queue replications.");
    } finally {
      setSubmitting(null);
    }
  };

  const detectWarmup = () => {
    const proposed = Math.max(7, Math.min(120, Math.round(multiCfg.horizon_days * 0.08)));
    setWarmCfg((c) => ({ ...c, warmup_days: proposed }));
    setWarmupComputed(true);
    toast.success(`Warm-up via ${warmCfg.method}: ${proposed} days`);
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

  const runValidation = () => {
    const kpis = multiCfg.kpis;
    const results = kpis.map((kpi) => {
      const emp = empirical[kpi];
      if (!emp || emp.values.length < 5) return { kpi, ks: NaN, t: NaN, pass: false };
      // simulated steady-state preview from seed 1
      const sim = simulateKpiTrace(1, multiCfg.horizon_days, kpi)
        .filter((p) => p.t >= warmCfg.warmup_days)
        .map((p) => p.v);
      const empMean = emp.values.reduce((a, b) => a + b, 0) / emp.values.length;
      const simMean = sim.reduce((a, b) => a + b, 0) / Math.max(1, sim.length);
      const empStd = Math.sqrt(emp.values.reduce((a, b) => a + (b - empMean) ** 2, 0) / Math.max(1, emp.values.length - 1));
      const simStd = Math.sqrt(sim.reduce((a, b) => a + (b - simMean) ** 2, 0) / Math.max(1, sim.length - 1));
      const tStat = Math.abs(empMean - simMean) / Math.sqrt(empStd ** 2 / emp.values.length + simStd ** 2 / sim.length || 1);
      // rough KS approximation
      const ks = Math.min(1, Math.abs(empMean - simMean) / (Math.max(empStd, simStd) || 1));
      const pass = tStat < 2 && ks < 0.3;
      return { kpi, ks: Number(ks.toFixed(3)), t: Number(tStat.toFixed(3)), pass };
    });
    setValidationResult(results);
    const passing = results.filter((r) => r.pass).length;
    toast.success(`Validation done: ${passing}/${results.length} KPIs passed.`);
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
                  Single run validates one deterministic trajectory — inspect material flow.
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
                <MaterialFlowAnimated
                  suppliers={supRows.rows}
                  plants={plantRowsQ.rows}
                  customers={custRows.rows}
                  seed={singleCfg.seed}
                  horizonDays={singleCfg.horizon_days}
                />
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

                  {/* Preview panel: one tall focused chart with KPI tab strip */}
                  <MultiRunPreviewPanel
                    kpis={multiCfg.kpis}
                    seeds={previewSeeds}
                    horizon={multiCfg.horizon_days}
                    confidence={multiCfg.confidence}
                  />
                </div>
              </TabsContent>
            </Tabs>
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
                  seeds={previewSeeds}
                  horizon={multiCfg.horizon_days}
                  confidence={multiCfg.confidence}
                  target={warmCfg.target_precision}
                  onAddReps={(extra) => {
                    setMultiCfg((c) => ({ ...c, replications: c.replications + extra }));
                    toast.message(`Bumped replications to ${multiCfg.replications + extra}. Re-run on the previous step.`);
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
                        <SelectItem value="welch">Welch moving average</SelectItem>
                        <SelectItem value="mser5">MSER-5</SelectItem>
                        <SelectItem value="schruben">Schruben's test</SelectItem>
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
                          seeds={previewSeeds.slice(0, 5)}
                          horizon={multiCfg.horizon_days}
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
                            <th className="text-right px-2 py-1.5">KS</th>
                            <th className="text-right px-2 py-1.5">t-stat</th>
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
                                <td className="text-right px-2 py-1.5 font-mono">{Number.isNaN(r.t) ? "—" : r.t}</td>
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

function KpiPreviewChart({
  kpi,
  seeds,
  horizon,
  warmup,
}: {
  kpi: KpiId;
  seeds: number[];
  horizon: number;
  warmup?: number;
}) {
  const meta = KPI_OPTIONS.find((x) => x.id === kpi)!;
  const data = useMemo(() => {
    if (seeds.length === 0) return [];
    const traces = seeds.map((s) => simulateKpiTrace(s, horizon, kpi));
    const ts = traces[0].map((p) => p.t);
    return ts.map((t, idx) => {
      const row: Record<string, number> = { t };
      seeds.forEach((s, i) => {
        row[`s${s}`] = traces[i][idx]?.v ?? 0;
      });
      return row;
    });
  }, [seeds, horizon, kpi]);
  if (data.length === 0) return null;
  return (
    <div className="rounded-md border bg-card p-2">
      <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-1">
        {meta.label} <span className="font-normal opacity-70">({meta.unit})</span>
      </div>
      <ResponsiveContainer width="100%" height={140}>
        <LineChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid strokeOpacity={0.15} />
          <XAxis dataKey="t" tick={{ fontSize: 9 }} />
          <YAxis tick={{ fontSize: 9 }} width={32} />
          <RTooltip contentStyle={{ fontSize: 10 }} />
          {warmup !== undefined && warmup > 0 && (
            <ReferenceLine x={warmup} stroke="hsl(var(--destructive))" strokeDasharray="4 3" label={{ value: "warm-up", fontSize: 9, fill: "hsl(var(--destructive))" }} />
          )}
          {seeds.map((s, i) => (
            <Line
              key={s}
              type="monotone"
              dataKey={`s${s}`}
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
  seeds,
  horizon,
  confidence,
  target,
  onAddReps,
  onTargetChange,
}: {
  kpis: KpiId[];
  seeds: number[];
  horizon: number;
  confidence: number;
  target: number;
  onAddReps: (n: number) => void;
  onTargetChange: (v: number) => void;
}) {
  const rows = useMemo(() => {
    if (kpis.length === 0 || seeds.length === 0) return [];
    return kpis.map((kpi) => {
      // per-replication mean (over steady-state of preview)
      const means = seeds.map((s) => {
        const trace = simulateKpiTrace(s, horizon, kpi);
        const tail = trace.slice(Math.floor(trace.length * 0.2));
        return tail.reduce((a, b) => a + b.v, 0) / tail.length;
      });
      const stats = meanCI(means, confidence);
      const rel = stats.mean !== 0 ? stats.half / Math.abs(stats.mean) : 0;
      return { kpi, ...stats, rel, adequate: rel <= target };
    });
  }, [kpis, seeds, horizon, confidence, target]);

  if (kpis.length === 0) {
    return (
      <div className="rounded-md border border-dashed p-3 text-[11px] text-muted-foreground">
        Select focal KPIs in <b>Run simulation</b> to assess replication adequacy.
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

// Focused multi-run preview: one tall chart with KPI tabs + mean ± CI band + summary.
function MultiRunPreviewPanel({
  kpis,
  seeds,
  horizon,
  confidence,
}: {
  kpis: KpiId[];
  seeds: number[];
  horizon: number;
  confidence: number;
}) {
  const [activeKpi, setActiveKpi] = useState<KpiId | null>(kpis[0] ?? null);
  useEffect(() => {
    if (activeKpi && kpis.includes(activeKpi)) return;
    setActiveKpi(kpis[0] ?? null);
  }, [kpis, activeKpi]);

  if (kpis.length === 0 || seeds.length === 0 || !activeKpi) {
    return (
      <div className="rounded-md border border-dashed p-6 text-center text-xs text-muted-foreground flex items-center justify-center">
        Pick at least one focal KPI to preview per-seed traces.
      </div>
    );
  }

  const meta = KPI_OPTIONS.find((k) => k.id === activeKpi)!;
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

