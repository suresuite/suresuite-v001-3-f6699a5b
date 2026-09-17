import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, Info, Play, Square, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import type { MappingWarning, SimulationRun, Replication } from "@/hooks/useSimulationRun";
import { CredibilityBadge } from "@/components/sim/CredibilityBadge";
import type { Credibility } from "@/hooks/useModelValidation";

interface Props {
  run: SimulationRun | null;
  reps: Replication[];
  versionLabel?: string | null;
  /** Derived credibility of the model this run executes (§9.5 badge). */
  credibility?: Credibility | null;
  onCancel: () => void;
  onAddReps: (n: number) => void;
}

/** Engine chip from a run's code_version — shared by the Latest-run card and
 *  the Run-queue console (6.E) so both label the engine identically. */
export function engineLabel(codeVersion: string | null | undefined): { label: string; cls: string } {
  const cv = codeVersion ?? "";
  if (cv.startsWith("scsim-"))
    return { label: `scsim engine ${cv.slice("scsim-".length)}`, cls: "border-green-500 text-green-700" };
  if (cv.startsWith("worker")) return { label: "worker engine", cls: "border-green-500 text-green-700" };
  return { label: "preliminary (stub)", cls: "border-yellow-400 text-yellow-700" };
}

export function RunProgressPanel({ run, reps, versionLabel, credibility, onCancel, onAddReps }: Props) {
  if (!run) {
    return (
      <Card>
        <CardContent className="pt-6 flex flex-col items-center gap-2 text-center">
          <Play className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            No runs yet. Click <strong>Run</strong> above to launch this scenario.
          </p>
        </CardContent>
      </Card>
    );
  }

  const pct = run.rep_count_target
    ? Math.round((run.rep_count_done / run.rep_count_target) * 100)
    : 0;
  const statusColor = {
    queued: "secondary",
    running: "default",
    done: "default",
    cancelled: "destructive",
    failed: "destructive",
  }[run.status] as "secondary" | "default" | "outline" | "destructive";

  // Loud, unmissable treatment for the two terminal states — a grey badge is
  // too easy to miss when the whole point is "did it run?".
  const statusChrome =
    run.status === "done"
      ? { card: "border-emerald-500 ring-1 ring-emerald-500/40", badge: "bg-emerald-600 text-white border-transparent", Icon: CheckCircle2 }
      : run.status === "failed" || run.status === "cancelled"
      ? { card: "border-destructive ring-1 ring-destructive/40", badge: "", Icon: AlertTriangle }
      : { card: "", badge: "", Icon: null as typeof CheckCircle2 | null };

  const engine = engineLabel(run.code_version);

  return (
    <div className="flex flex-col gap-3">
      <Card className={statusChrome.card}>
        <CardHeader className="pb-2">
          {/* Five badges beside an action group on one non-wrapping row took
              the document to 471px at 320 and 778px at 768. It stacks below
              `md` and the badges wrap; `md:` restores the desktop row. */}
          <div className="flex flex-col items-start gap-2 md:flex-row md:items-center md:justify-between">
            <CardTitle className="text-sm flex min-w-0 flex-wrap items-center gap-2 md:flex-nowrap">
              Latest run
              <Badge variant={statusColor} className={cn("text-[10px] uppercase gap-1", statusChrome.badge)}>
                {statusChrome.Icon && <statusChrome.Icon className="h-3 w-3" />}
                {run.status}
              </Badge>
              {versionLabel && (
                <Badge variant="outline" className="text-[10px]">
                  {versionLabel}
                </Badge>
              )}
              <Badge variant="outline" className={`text-[10px] ${engine.cls}`}>
                {engine.label}
              </Badge>
              {credibility && <CredibilityBadge credibility={credibility} />}
            </CardTitle>
            <div className="flex shrink-0 gap-2">
              {(run.status === "running" || run.status === "queued") && (
                <Button size="sm" variant="outline" className="gap-1" onClick={onCancel}>
                  <Square className="h-3.5 w-3.5" /> Cancel
                </Button>
              )}
              {run.status === "done" && (
                <Button size="sm" variant="outline" className="gap-1" onClick={() => onAddReps(10)}>
                  <Plus className="h-3.5 w-3.5" /> +10 reps
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <div className="flex items-center justify-between text-xs">
            <span>
              {run.rep_count_done} / {run.rep_count_target} replications
            </span>
            <span className="text-muted-foreground">
              {run.warmup_detected_at != null
                ? `Warm-up @ day ${run.warmup_detected_at}`
                : "Warm-up: pending"}
            </span>
          </div>
          <Progress value={pct} />
          {run.status === "queued" && (
            <p className="text-[11px] text-muted-foreground mt-1">Queued — waiting for a worker</p>
          )}
          {run.error_message && (
            <p className="text-xs text-destructive mt-1">{run.error_message}</p>
          )}
        </CardContent>
      </Card>

      <MappingWarningsCard warnings={run.mapping_warnings} status={run.status} />

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Per-replication</CardTitle>
        </CardHeader>
        <CardContent>
          {reps.length === 0 ? (
            <p className="text-xs text-muted-foreground">Waiting for first replication…</p>
          ) : (
            <div className="grid grid-cols-10 gap-1">
              {reps.map((r) => (
                <div
                  key={r.id}
                  title={`rep ${r.rep_index} · seed ${r.seed_used} · ${r.status}`}
                  className={
                    "h-6 border border-border text-[10px] flex items-center justify-center " +
                    (r.status === "done"
                      ? "bg-primary/20 text-foreground"
                      : r.status === "running"
                      ? "bg-amber-500/20"
                      : r.status === "failed"
                      ? "bg-destructive/30"
                      : "bg-muted")
                  }
                >
                  {r.rep_index}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * THE FINDING BADGE VOCABULARY, and there is one of it. §10 tells WP 3.4's
 * ingestion review screen to "reuse `MappingWarningsCard`'s badge vocabulary
 * rather than inventing a second", and a vocabulary you cannot import is a
 * vocabulary you copy. `ingest_staged_rows.findings` and
 * `ingest_runs.mapping_warnings` carry the same `{level, ...}` shape as
 * scsim's MappingWarning precisely so that one table of levels serves all of
 * them. `warning` is the spelling the SQL findings use for `warn`.
 */
export const WARN_META = {
  error: { icon: AlertTriangle, cls: "text-destructive" },
  warn: { icon: AlertTriangle, cls: "text-amber-600 dark:text-amber-400" },
  warning: { icon: AlertTriangle, cls: "text-amber-600 dark:text-amber-400" },
  info: { icon: Info, cls: "text-muted-foreground" },
} as const;

/**
 * The engine's fallback report (simulation_runs.mapping_warnings) — every
 * value the mapper had to derive or default instead of reading from the
 * project data. A fully specified project produces zero of these
 * (docs/design blueprint §8.2 / Phase A exit criterion).
 */
export function MappingWarningsCard({
  warnings,
  status,
}: {
  warnings: MappingWarning[] | null;
  status: SimulationRun["status"];
}) {
  const [open, setOpen] = useState(false);
  if (status !== "done" && (!warnings || warnings.length === 0)) return null;
  const list = warnings ?? [];
  const warnCount = list.filter((w) => w.level !== "info").length;
  const infoCount = list.length - warnCount;

  return (
    <Card>
      <CardHeader className="pb-2">
        <button
          type="button"
          className="flex min-h-11 flex-wrap items-center gap-2 w-full text-left md:min-h-0 md:flex-nowrap"
          onClick={() => setOpen((o) => !o)}
        >
          {list.length > 0 ? (
            open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />
          ) : (
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
          )}
          <CardTitle className="text-sm">Engine mapping report</CardTitle>
          {list.length === 0 ? (
            <Badge variant="outline" className="text-[10px] border-emerald-500/40 text-emerald-600 dark:text-emerald-400">
              fully specified — no fallbacks
            </Badge>
          ) : (
            <>
              {warnCount > 0 && (
                <Badge variant="outline" className="text-[10px] border-amber-500/40 text-amber-700 dark:text-amber-300">
                  {warnCount} defaulted
                </Badge>
              )}
              {infoCount > 0 && (
                <Badge variant="outline" className="text-[10px]">
                  {infoCount} derived
                </Badge>
              )}
            </>
          )}
        </button>
      </CardHeader>
      {open && list.length > 0 && (
        <CardContent className="pt-0">
          <p className="text-[11px] text-muted-foreground mb-2">
            Values the engine derived from logistics data (info) or defaulted because no source
            existed (warn). Fix warns in the Item Master / uploads to make results trustworthy.
          </p>
          <div className="max-h-52 overflow-auto rounded-md border">
            <ul className="text-xs divide-y">
              {list.map((w, i) => {
                const meta = WARN_META[w.level] ?? WARN_META.info;
                const Icon = meta.icon;
                return (
                  <li key={i} className="flex items-start gap-2 px-2.5 py-1.5">
                    <Icon className={cn("h-3.5 w-3.5 mt-0.5 shrink-0", meta.cls)} />
                    <div className="min-w-0">
                      <span className="font-mono text-[10px] text-muted-foreground">
                        {w.entity} · {w.field}
                      </span>
                      <div>{w.reason}</div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        </CardContent>
      )}
    </Card>
  );
}
