/**
 * WP 4.4 · A3 — the container: fetch, assemble, render.
 *
 * It lives beside the pre-run gate because that is where the question A3
 * answers actually gets asked — *is this model built on good data?* — and the
 * findings the gate already computed are half the report's input.
 *
 * WHAT IT DOES NOT DO is hide a failure. If freshness cannot be read, the panel
 * says so and renders nothing else: a Trust Report that silently omits the
 * section it could not compute is a report claiming a clean bill it never
 * checked, which is the T1 breach the whole standard exists to prevent.
 */
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useProjectFreshness } from "./useProjectFreshness";
import { ProjectTrustReport } from "./ProjectTrustReport";
import { buildTrustReport, type IngestEvent } from "@/lib/trust/trustReport";
import type { GradedFinding } from "@/lib/trust/gradingTypes";

interface Props {
  projectId: string;
  projectName: string;
  /** The gate's findings, in the UI vocabulary. Null while project data loads. */
  findings: Array<{ severity: string; field?: string; policy?: string; message: string; reason?: string; rows?: string[] }> | null;
}

export function TrustReportPanel({ projectId, projectName, findings }: Props) {
  const { freshness, error, loading } = useProjectFreshness(projectId);
  const [ingest, setIngest] = useState<IngestEvent[] | null>(null);

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    supabase
      .from("ingest_runs")
      .select("id,source_kind,applied_at,applied_by_user_id,rows_fetched")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(10)
      .then(({ data, error: e }) => {
        if (cancelled) return;
        // An empty list and a failed read are DIFFERENT facts, and the report
        // says which: `null` means we could not look, `[]` means there is
        // nothing recorded. `knownLimits` turns the second into a declared limit.
        if (e) { setIngest(null); return; }
        setIngest((data ?? []).map((r) => ({
          run_id: String(r.id),
          fact_class: (r.source_kind as string) ?? null,
          landed_at: (r.applied_at as string) ?? null,
          uploaded_by: (r.applied_by_user_id as string) ?? null,
          rows: (r.rows_fetched as number) ?? null,
        })));
      });
    return () => { cancelled = true; };
  }, [projectId]);

  if (loading) return <p className="text-xs text-muted-foreground">Assembling the data trust report…</p>;

  if (error || !freshness) {
    return (
      <Alert>
        <AlertDescription className="text-xs">
          The data trust report could not be assembled: freshness could not be read
          for this project{error ? ` (${error})` : ""}. Nothing below is a verdict —
          the absence of findings here is not evidence that there are none.
        </AlertDescription>
      </Alert>
    );
  }

  const report = buildTrustReport({
    projectName,
    freshness,
    // The gate surface carries findings but not the graded manifest behind them,
    // so coverage is DECLARED unavailable rather than rendered as an empty
    // table — an empty coverage table reads as "nothing is missing".
    graded: null,
    findings: (findings ?? []).map((f) => ({
      severity: (f.severity === "block" || f.severity === "warn" ? f.severity : "info"),
      field: f.field ?? "",
      policy: f.policy ?? "",
      rows: f.rows ?? [],
      message: f.message,
      reason: f.reason ?? "",
    })) as GradedFinding[],
    ingestHistory: ingest ?? [],
  });

  return <ProjectTrustReport report={report} />;
}
