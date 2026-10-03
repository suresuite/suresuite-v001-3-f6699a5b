// The /policies page, column by column — rendered on the Data map view.
// What each cell shows, where an edit goes, what the engine actually uses, and
// whether an edit changes a run. Data and provenance: lib/policies/policyColumnCheck.ts.
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ListChecks } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  CUSTOMER_RULE_CHECK,
  FG_BUFFER_CHECK,
  GRID_STAGES,
  KEY_COLUMNS,
  MEASURED,
  NO_COLUMN_CHECK,
  PAGE_LEVEL_CHECK,
  RUN_VALIDATE_CHECK,
  STAGE_ROWS,
  STAGE_TITLE,
  stageColumnChecks,
  type ColumnCheck,
  type Verdict,
} from "@/lib/policies/policyColumnCheck";

const VERDICT_META: Record<Verdict, { label: string; className: string }> = {
  works: {
    label: "✓ changes the run",
    className: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30",
  },
  conditional: {
    label: "⚠ only when…",
    className: "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30",
  },
  differs: {
    label: "✗ shown ≠ run",
    className: "bg-destructive/10 text-destructive border-destructive/30",
  },
  ignored: {
    label: "✗ ignored by the run",
    className: "bg-destructive/10 text-destructive border-destructive/30",
  },
  disabled: { label: "— disabled", className: "bg-muted text-muted-foreground border-border" },
  info: { label: "· information", className: "bg-muted text-muted-foreground border-border" },
};

interface Row {
  key: string;
  label: string;
  sub?: string;
  field?: string;
  check: ColumnCheck;
}

function VerdictBadge({ verdict }: { verdict: Verdict }) {
  const meta = VERDICT_META[verdict];
  return (
    <Badge variant="outline" className={cn("h-5 text-[10px] whitespace-nowrap", meta.className)}>
      {meta.label}
    </Badge>
  );
}

function CheckTable({ title, intro, rows }: { title: string; intro?: string; rows: Row[] }) {
  return (
    <div className="rounded-md border overflow-hidden">
      <div className="bg-muted/40 px-3 py-2 text-xs font-semibold">{title}</div>
      {intro && <p className="border-b px-3 py-2 text-xs text-muted-foreground">{intro}</p>}
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="whitespace-nowrap text-xs">Column</TableHead>
              <TableHead className="text-xs min-w-[14rem]">Cell shows (from)</TableHead>
              <TableHead className="text-xs min-w-[10rem]">An edit is saved to</TableHead>
              <TableHead className="text-xs min-w-[14rem]">The engine uses (default when blank)</TableHead>
              <TableHead className="whitespace-nowrap text-xs">Edit changes the run?</TableHead>
              <TableHead className="text-xs min-w-[16rem]">Condition · production · should be</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.key}>
                <TableCell className="align-top text-xs">
                  <div className="font-medium whitespace-nowrap">{r.label}</div>
                  {r.sub && <div className="text-[10px] text-muted-foreground whitespace-nowrap">{r.sub}</div>}
                  {r.field && <div className="font-mono text-[10px] text-muted-foreground">{r.field}</div>}
                </TableCell>
                <TableCell className="align-top text-xs text-muted-foreground">{r.check.shows}</TableCell>
                <TableCell className="align-top text-xs text-muted-foreground">{r.check.savedTo}</TableCell>
                <TableCell className="align-top text-xs text-muted-foreground">{r.check.engine}</TableCell>
                <TableCell className="align-top">
                  <VerdictBadge verdict={r.check.verdict} />
                </TableCell>
                <TableCell className="align-top text-xs text-muted-foreground">
                  {r.check.note && <p>{r.check.note}</p>}
                  {r.check.shouldBe && (
                    <p className="mt-1">
                      <span className="font-medium text-foreground">Should be:</span> {r.check.shouldBe}
                    </p>
                  )}
                  {r.check.refs && r.check.refs.length > 0 && (
                    <p className="mt-1 font-mono text-[10px]">PLAN.md §4 {r.check.refs.join(" · ")}</p>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

const named = (prefix: string, list: Array<{ label: string; check: ColumnCheck }>): Row[] =>
  list.map((r) => ({ key: `${prefix}:${r.label}`, label: r.label, check: r.check }));

export function PolicyColumnCheck() {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start gap-2 rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
        <ListChecks className="h-3.5 w-3.5 mt-0.5 shrink-0" />
        <div className="flex flex-col gap-1">
          <p>
            The column list is read from the grid's own specification, so a new column cannot appear on the
            Policies page without an entry here. Counts are measured in production on {MEASURED.date} (verification
            run {MEASURED.run}, {MEASURED.scope}) and describe all projects, not only the one selected.
          </p>
          <div className="flex flex-wrap items-start gap-1.5 pt-0.5">
            {(Object.keys(VERDICT_META) as Verdict[]).map((v) => (
              <span key={v} className="w-fit">
                <VerdictBadge verdict={v} />
              </span>
            ))}
          </div>
        </div>
      </div>

      <CheckTable title="Page-level controls" rows={named("page", PAGE_LEVEL_CHECK)} />

      {GRID_STAGES.map((stage) => (
        <div key={stage} className="flex flex-col gap-4">
          <CheckTable
            title={STAGE_TITLE[stage]}
            intro={STAGE_ROWS[stage]}
            rows={[
              ...KEY_COLUMNS[stage].map((k) => ({
                key: `${stage}:key:${k.label}`,
                label: k.label,
                sub: "key column",
                check: k.check,
              })),
              ...stageColumnChecks(stage)
                .filter((c) => c.check)
                .map((c) => ({
                  key: `${stage}:${c.field}`,
                  label: c.inVector ? `Replenishment → ${c.label}` : c.label,
                  sub: c.sub,
                  field: `${c.family}.${c.field}`,
                  check: c.check,
                })),
            ]}
          />
          {stage === "customer" && (
            <CheckTable
              title="Customer rules line (above the Customer grid) — project scope, saves the whole family"
              rows={Object.entries(CUSTOMER_RULE_CHECK).map(([field, check]) => ({
                key: `fulfillment:${field}`,
                label: field,
                field: `fulfillment.${field}`,
                check,
              }))}
            />
          )}
          {stage === "plant" && (
            <CheckTable
              title="FG safety buffer line (above the Plant grid) — project scope, P-P.4"
              rows={Object.entries(FG_BUFFER_CHECK).map(([field, check]) => ({
                key: `inventory:${field}`,
                label: field,
                field: `inventory.${field}`,
                check,
              }))}
            />
          )}
        </div>
      ))}

      <CheckTable title="Run & validate" rows={named("run", RUN_VALIDATE_CHECK)} />
      <CheckTable
        title="Engine inputs with no column on this page"
        intro="The engine reads these; /policies has no column or control for them today."
        rows={named("none", NO_COLUMN_CHECK)}
      />
    </div>
  );
}
