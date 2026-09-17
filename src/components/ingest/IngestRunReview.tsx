/**
 * ONE REVIEW SCREEN, BOTH SOURCES (Phase 3 / WP 3.4, PLAN.md §10).
 *
 * §10: "review screen with counts, findings and the real diff, modelled on the
 * MRP mapping report (reuse `MappingWarningsCard`'s badge vocabulary); promote
 * requires role ≥ editor and audits." Its gap check is the constraint that
 * shapes this file: **any branch on `source_kind` beyond LABELS means WP 3.1 was
 * incomplete.** There is exactly one place `source_kind` is read here — the
 * label at the top — and it goes through `sourceLabel()`, which is a lookup
 * table. `ingestDiffReview.test.ts` fails if a conditional on it appears.
 *
 * WHAT IT SHOWS, AND WHY EACH PART IS NOT OPTIONAL:
 *
 *   · THE FIVE COUNTS, which partition the file. A screen whose categories do
 *     not add up to the rows staged is a screen that has lost rows, so when they
 *     do not add up it says so (`countsDisagree`) instead of showing five
 *     numbers (§5 T3 — publish our own blind spots).
 *   · THE DIFF, per row, from `ingest_staged_rows.diff_state`. A NULL renders as
 *     "not compared", never as "new": until this package the column was
 *     `NOT NULL DEFAULT 'new'` and nothing wrote it, so a screen built a week
 *     earlier would have shown "340 new" for 340 unchanged rows (§4 D62).
 *   · THREE ROW STATES, not two — promoted, held back with an error, and
 *     promoted-but-superseded-by-a-later-line-of-the-same-file. The third is the
 *     one case where the user's own file disagreed with itself, so the finding
 *     naming the line that won is shown on the losing row.
 *   · THE PROMOTE BUTTON IS NOT THE GATE. `ingest_apply_run` refuses a role
 *     below editor and `supabase/rehearsal/100` proves it against a database.
 *     The button is disabled for a reason the user can read, which is a courtesy
 *     on top of a refusal, never instead of one.
 */
import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertTriangle, ChevronDown, ChevronRight, FileText, Loader2, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
// The one finding vocabulary (§10: reuse it, do not invent a second).
import { WARN_META } from "@/components/sim/RunProgressPanel";
import {
  countsDisagree,
  diffHelp,
  diffLabel,
  removalNote,
  reviewCounts,
  rowReason,
  rowState,
  shortSha,
  sourceLabel,
  type Finding,
  type IngestFile,
  type IngestRun,
  type RowState,
  type StagedRow,
} from "@/lib/ingest/runReview";

const STATE_STYLE: Record<RowState, string> = {
  promoted: "border-emerald-500/40 text-emerald-700 dark:text-emerald-300",
  held: "border-destructive/50 text-destructive",
  superseded: "border-amber-500/40 text-amber-700 dark:text-amber-300",
};

const STATE_LABEL: Record<RowState, string> = {
  promoted: "will promote",
  held: "held back",
  superseded: "superseded",
};

const DIFF_STYLE: Record<string, string> = {
  new: "border-sky-500/40 text-sky-700 dark:text-sky-300",
  changed: "border-amber-500/40 text-amber-700 dark:text-amber-300",
  unchanged: "border-muted-foreground/30 text-muted-foreground",
  removed_upstream: "border-destructive/40 text-destructive",
};

function Count({ n, label, help, tone }: { n: number; label: string; help: string; tone?: string }) {
  return (
    <div className="flex flex-col gap-0.5" title={help}>
      <span className={cn("text-lg font-semibold leading-none", tone)}>{n}</span>
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span>
    </div>
  );
}

function FindingLine({ f }: { f: Finding }) {
  const meta = WARN_META[f.level] ?? WARN_META.info;
  const Icon = meta.icon;
  return (
    <li className="flex items-start gap-2 px-2.5 py-1.5">
      <Icon className={cn("h-3.5 w-3.5 mt-0.5 shrink-0", meta.cls)} />
      <div className="min-w-0">
        <span className="font-mono text-[10px] text-muted-foreground">
          {f.row != null ? `row ${f.row}` : "file"}
          {f.field ? ` · ${f.field}` : ""}
          {f.code ? ` · ${f.code}` : ""}
        </span>
        <div className="text-xs">{f.message}</div>
      </div>
    </li>
  );
}

export interface IngestRunReviewProps {
  run: IngestRun;
  file: IngestFile | null;
  rows: StagedRow[];
  /** Whether THIS user's project role is editor or higher. The database decides; this explains. */
  canPromote: boolean;
  roleLabel: string | null;
  busy?: "diff" | "promote" | null;
  onRecompute: () => void;
  onPromote: () => void;
  /** Click-through target for one staged row — the physical line of the file. */
  onOpenRow?: (row: StagedRow) => void;
}

export function IngestRunReview({
  run, file, rows, canPromote, roleLabel, busy, onRecompute, onPromote, onOpenRow,
}: IngestRunReviewProps) {
  const [open, setOpen] = useState(true);
  const [showAll, setShowAll] = useState(false);
  const counts = useMemo(() => reviewCounts(run), [run]);
  const mismatch = useMemo(() => countsDisagree(run, rows.length), [run, rows.length]);
  const applied = run.status === "applied";

  // The rows a person needs to look at come first: held back, then superseded,
  // then changed, then the rest. A review screen ordered by line number makes
  // the reader do the sorting.
  const ordered = useMemo(() => {
    const rank = (r: StagedRow) => {
      const s = rowState(r);
      if (s === "held") return 0;
      if (s === "superseded") return 1;
      return r.diff_state === "changed" ? 2 : r.diff_state == null ? 3 : 4;
    };
    return [...rows].sort((a, b) => rank(a) - rank(b) || a.source_row_number - b.source_row_number);
  }, [rows]);

  const shown = showAll ? ordered : ordered.slice(0, 50);
  const fileFindings = run.mapping_warnings ?? [];

  return (
    <Card className="border-primary/30">
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center gap-2">
          <FileText className="h-4 w-4 shrink-0" />
          <CardTitle className="text-sm">
            {file?.original_filename ?? sourceLabel(run.source_kind)}
          </CardTitle>
          {/* THE ONLY PLACE source_kind IS READ, and it is a label (§10). */}
          <Badge variant="outline" className="text-[10px]">{sourceLabel(run.source_kind)}</Badge>
          <Badge variant="outline" className="text-[10px]">
            {applied ? "promoted" : "staged — nothing has been written yet"}
          </Badge>
          {file?.content_sha256 && (
            <span className="font-mono text-[10px] text-muted-foreground" title={file.content_sha256}>
              sha256 {shortSha(file.content_sha256)}
            </span>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-3 pt-0">
        <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
          <Count n={counts.new} label="new" tone="text-sky-600 dark:text-sky-400"
                 help={diffHelp("new")} />
          <Count n={counts.changed} label="changed" tone="text-amber-600 dark:text-amber-400"
                 help={diffHelp("changed")} />
          <Count n={counts.unchanged} label="unchanged"
                 help={diffHelp("unchanged")} />
          <Count n={counts.superseded} label="superseded" tone="text-amber-600 dark:text-amber-400"
                 help="A later line of this same file repeats the row on its natural key. The later line is promoted; this one is not." />
          <Count n={counts.held} label="held back" tone="text-destructive"
                 help="Carries an error finding. Never promoted; the reason is attached to the row." />
          <div className="ml-auto text-right">
            <div className="text-lg font-semibold leading-none">{counts.willPromote}</div>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
              {applied ? "rows written" : "rows this will write"}
            </div>
          </div>
        </div>

        {/* A zero that is a statement rather than a measurement (§5 T1). */}
        <p className="text-[11px] text-muted-foreground">{removalNote(run.source_kind)}</p>

        {mismatch && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription className="text-xs">{mismatch}</AlertDescription>
          </Alert>
        )}

        {fileFindings.length > 0 && (
          <div className="rounded-md border">
            <ul className="divide-y">
              {fileFindings.map((f, i) => <FindingLine key={i} f={f} />)}
            </ul>
          </div>
        )}

        <div>
          <button
            type="button"
            className="flex min-h-11 items-center gap-2 text-left md:min-h-0"
            onClick={() => setOpen((o) => !o)}
          >
            {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            <span className="text-xs font-medium">
              {rows.length} row{rows.length === 1 ? "" : "s"} staged · line by line
            </span>
          </button>

          {open && (
            <div className="mt-1 max-h-96 overflow-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-16 py-1 px-2 text-[11px]">Line</TableHead>
                    <TableHead className="w-28 py-1 px-2 text-[11px]">Diff</TableHead>
                    <TableHead className="w-28 py-1 px-2 text-[11px]">Outcome</TableHead>
                    <TableHead className="py-1 px-2 text-[11px]">Row</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {shown.map((r) => {
                    const state = rowState(r);
                    const reason = rowReason(r);
                    return (
                      <TableRow
                        key={r.id}
                        className={onOpenRow ? "cursor-pointer" : undefined}
                        onClick={onOpenRow ? () => onOpenRow(r) : undefined}
                      >
                        <TableCell className="py-1 px-2 font-mono text-[11px]">
                          {r.source_row_number}
                        </TableCell>
                        <TableCell className="py-1 px-2">
                          <Badge
                            variant="outline"
                            title={diffHelp(r.diff_state)}
                            className={cn(
                              "text-[10px] font-normal",
                              r.diff_state ? DIFF_STYLE[r.diff_state] : "border-dashed text-muted-foreground",
                            )}
                          >
                            {diffLabel(r.diff_state)}
                          </Badge>
                        </TableCell>
                        <TableCell className="py-1 px-2">
                          <Badge variant="outline" className={cn("text-[10px] font-normal", STATE_STYLE[state])}>
                            {applied && state === "promoted" ? "promoted" : STATE_LABEL[state]}
                          </Badge>
                        </TableCell>
                        <TableCell className="py-1 px-2 text-[11px]">
                          <div className="font-mono text-[10px] text-muted-foreground truncate">
                            {Object.entries(r.raw ?? {})
                              .slice(0, 6)
                              .map(([k, v]) => `${k}=${String(v ?? "")}`)
                              .join("  ")}
                          </div>
                          {reason && <div className="mt-0.5">{reason.message}</div>}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              {ordered.length > shown.length && (
                <button
                  type="button"
                  className="w-full py-2 text-[11px] text-muted-foreground hover:text-foreground"
                  onClick={() => setShowAll(true)}
                >
                  show the remaining {ordered.length - shown.length} row(s)
                </button>
              )}
            </div>
          )}
        </div>

        {!applied && (
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Button size="sm" variant="outline" onClick={onRecompute} disabled={Boolean(busy)}>
              {busy === "diff"
                ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                : <RefreshCw className="mr-1.5 h-3.5 w-3.5" />}
              Re-compare with current data
            </Button>
            <Button size="sm" onClick={onPromote} disabled={!canPromote || Boolean(busy)}>
              {busy === "promote" && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              Promote {counts.willPromote} row{counts.willPromote === 1 ? "" : "s"}
            </Button>
            {!canPromote && (
              <span className="text-[11px] text-muted-foreground">
                Promoting needs the project role <strong>editor</strong> or higher
                {roleLabel ? `; yours is ${roleLabel}` : " on this project"}. The database refuses it either way.
              </span>
            )}
          </div>
        )}

        {/* §5 T3 — the screen states the limit of its own comparison. */}
        <p className="text-[10px] leading-snug text-muted-foreground">
          The comparison is against this project's data as it is now, and it is run again at the
          moment you promote — if something changed in between, the promotion stops rather than
          reporting the older answer.
        </p>
      </CardContent>
    </Card>
  );
}

export default IngestRunReview;
