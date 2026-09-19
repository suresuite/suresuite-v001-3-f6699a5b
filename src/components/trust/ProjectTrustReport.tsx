/**
 * WP 4.4 · A3 — the Project Data Trust Report.
 *
 * §5.4: "a trust report that does not state its own limits is marketing." The
 * Known limits block is therefore rendered FIRST among the sections that can
 * carry bad news, is not collapsible, and is assembled from the report's own
 * inputs by `knownLimits()` — so it changes with the project rather than being a
 * fixed disclaimer.
 *
 * The assembly is a pure module so WP 6.3 can emit the same report as PDF/JSON
 * through `report-render` without a second implementation of it. **WP 6.3 did**:
 * the module moved to `supabase/functions/_shared/trustReport.ts` — because the PDF
 * has to be computed where the data is, not from numbers a browser asserted — and
 * `trustReportSections.ts` turns it into the `{columns, rows}` tables both the
 * document and this screen render. The JSON download below is the same object.
 *
 * **THE DOWNLOAD SAYS WHAT THIS COPY IS MISSING.** This screen builds the report
 * with `graded: null` (the /policies surface has the gate's findings but not the
 * manifest behind them), so its coverage section is empty and the JSON's
 * `complete` flag is false. The `data-trust` report template grades the dataset
 * server-side and carries that section. A download that did not admit the
 * difference would be a partial report with a complete-looking filename.
 */
import { AlertTriangle, Download, FileWarning, Info } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { TrustReport } from "@/lib/trust/trustReport";
import { trustReportJson } from "../../../supabase/functions/_shared/trustReportSections";

/**
 * The JSON artifact, downloaded. A4's rule applied to A3: a figure that leaves the
 * system carries what produced it, so the file holds the hash, the measurement
 * time, every section and the report's own limits — restated at the top level so a
 * reader who opens it sees them before the numbers.
 */
function downloadJson(report: TrustReport) {
  const body = JSON.stringify(trustReportJson(report), null, 2);
  const url = URL.createObjectURL(new Blob([body], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  // The SHORT hash in the filename, so two downloads of two dataset versions do
  // not overwrite each other in a downloads folder.
  a.download = `data-trust-${report.projectName.replace(/[^\w.-]+/g, "-")}-${report.graphHashShort || "nohash"}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

const stateCls: Record<string, string> = {
  fresh: "text-emerald-700",
  stale: "text-amber-700",
  unknown: "text-slate-600",
};

export function ProjectTrustReport({ report }: { report: TrustReport }) {
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex flex-wrap items-center gap-2 text-base">
            Data trust report — {report.projectName}
            {report.graphHashShort && (
              <Badge variant="outline" className="font-mono text-xs">
                {report.graphHashShort}
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-sm">
          <p className={report.blocking.length ? "font-medium text-destructive" : "font-medium"}>
            {report.headline}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => downloadJson(report)}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-sm border border-[--zinc-border] px-2 py-1 text-xs hover:bg-[#fafafa] md:min-h-0"
            >
              <Download className="h-3.5 w-3.5" />
              Download JSON
            </button>
            <span className="text-[11px] text-muted-foreground">
              {report.coverage.length === 0
                ? "This copy has no coverage section — ask for the “Data trust report” document to include it."
                : "Includes every section and this report's own limits."}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            Measured {new Date(report.measuredAt).toLocaleString()}. Freshness is
            computed at read time — producing this report wrote nothing.
          </p>
        </CardContent>
      </Card>

      {/* NOT OPTIONAL, and first among the sections that can carry bad news. */}
      <Card className="border-amber-300">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <FileWarning className="h-4 w-4" /> Known limits
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {report.knownLimits.map((l) => (
            <div key={`${l.ref}-${l.limit}`} className="space-y-0.5">
              <div className="flex items-baseline gap-2">
                <Badge variant="outline" className="text-[10px]">{l.ref}</Badge>
                <span className="font-medium">{l.limit}</span>
              </div>
              <p className="text-xs text-muted-foreground">{l.consequence}</p>
            </div>
          ))}
        </CardContent>
      </Card>

      {report.blocking.length > 0 && (
        <Card className="border-destructive">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="h-4 w-4" /> Blocking findings
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {report.blocking.map((f, i) => (
              <div key={`${f.field}-${i}`}>
                <div className="font-medium">{f.field} <span className="text-xs opacity-70">· {f.policy}</span></div>
                <p className="text-xs text-muted-foreground">{f.message} — {f.reason}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Per-table freshness</CardTitle></CardHeader>
        <CardContent>
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground">
              <tr className="text-left">
                <th className="py-1">Table</th><th>Rows</th>
                <th>Current</th><th>Out of date</th><th>Unknown</th><th>Typed</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(report.freshness).map(([table, t]) => (
                <tr key={table} className="border-t">
                  <td className="py-1 font-mono text-xs">{table}</td>
                  <td>{t.rows}</td>
                  <td className={stateCls.fresh}>{t.fresh}</td>
                  <td className={t.stale ? stateCls.stale : ""}>{t.stale}</td>
                  <td className={t.unknown ? stateCls.unknown : ""}>{t.unknown}</td>
                  <td>{t.typed ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-muted-foreground">
            <strong>Unknown</strong> is not <strong>out of date</strong>: a row
            written before provenance existed carries no input hash, so nothing
            can say whether it is current. <strong>Typed</strong> counts policy
            overrides a person entered — those are decisions and do not expire
            when the dataset moves.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Latest analysis runs</CardTitle></CardHeader>
        <CardContent className="space-y-1 text-sm">
          {report.latestRuns.length === 0 && (
            <p className="text-xs text-muted-foreground">No analysis has completed for this project.</p>
          )}
          {report.latestRuns.map((r) => (
            <div key={r.run_id} className="flex flex-wrap items-baseline gap-2">
              <span className="font-mono text-xs">{r.analysis_kind}</span>
              <Badge variant="outline" className={`text-[10px] ${stateCls[r.freshness] ?? ""}`}>{r.freshness}</Badge>
              <span className="text-xs opacity-70">{r.code_version}</span>
              {r.finished_at && <span className="text-xs opacity-70">{new Date(r.finished_at).toLocaleString()}</span>}
              {Array.isArray(r.warnings) && r.warnings.length > 0 && (
                <span className="text-xs text-amber-700">
                  <Info className="mr-1 inline h-3 w-3" />
                  {r.warnings.length} declared limit(s) on this run
                </span>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      {report.substitutions.length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Substituted values</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p className="text-xs text-muted-foreground">
              Values the product shows that no upload contained. Each is produced
              by a named rule, stated here and at the point of display (T2).
            </p>
            {report.substitutions.map((c) => (
              <div key={c.field}>
                <div className="font-medium">{c.field} <span className="text-xs opacity-70">· {c.policyRef}</span></div>
                <p className="text-xs text-muted-foreground">
                  {c.substituted} of {c.fromData + c.substituted + c.missing} entities.
                  {c.fallback ? ` ${c.fallback}` : " No fallback prose is declared for this field."}
                </p>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Ingest history</CardTitle></CardHeader>
        <CardContent className="space-y-1 text-sm">
          {report.ingestHistory.length === 0 && (
            <p className="text-xs text-muted-foreground">
              No server-side ingestion is recorded for this project. Rows may
              predate it, in which case the file, row and uploader behind them
              cannot be traced.
            </p>
          )}
          {report.ingestHistory.map((e) => (
            <div key={e.run_id} className="flex flex-wrap gap-2 text-xs">
              <span className="font-mono">{e.fact_class ?? "—"}</span>
              <span>{e.rows ?? "—"} rows</span>
              {e.landed_at && <span className="opacity-70">{new Date(e.landed_at).toLocaleString()}</span>}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
