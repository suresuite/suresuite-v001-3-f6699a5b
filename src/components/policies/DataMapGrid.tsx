// Read-only "Data map" grid: every uploaded column of the six datasets the
// sim worker reads, its engine destination, the resolution chain, and the
// project's live status — so no uploaded field is ever silently unused.
// Contract: src/lib/policies/dataMap.ts ↔ docs/data-simulation-mapping.md §4.
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CheckCircle2, CircleOff, Database, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { DATA_MAP_CONTRACT, DATASET_LABEL, type DataMapDataset } from "@/lib/policies/dataMap";
import { useDataMap, type DataMapStatus } from "@/hooks/useDataMap";
import { requirementsByField } from "@/lib/policies/validationService";
import { LaneTruncationNotice } from "@/components/policies/LaneTruncationNotice";

// §8.1 — which engine mechanics / catalog policies demand each column, from
// the registry's data_requirements (static: independent of the current
// policy selection; the verification stage grades the selected subset).
const FIELD_DEMANDS = requirementsByField();

const LEVEL_CLASS: Record<string, string> = {
  required: "bg-destructive/10 text-destructive border-destructive/30",
  recommended: "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30",
  defaulted: "bg-muted text-muted-foreground border-border",
};

const STATUS_META: Record<DataMapStatus, { label: string; className: string }> = {
  ok: { label: "used", className: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30" },
  fallback: { label: "fallback active", className: "bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-500/30" },
  default: { label: "default applied", className: "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30" },
  unused: { label: "unused", className: "bg-muted text-muted-foreground border-border" },
  missing: { label: "no data", className: "bg-destructive/10 text-destructive border-destructive/30" },
};

const DATASET_ORDER: DataMapDataset[] = [
  "inbound_logistics",
  "outbound_logistics",
  "bom_single_level",
  "materials",
  "products",
  "suppliers",
];

export function DataMapGrid({ projectId }: { projectId: string }) {
  const { statuses, truncated, loading } = useDataMap(projectId);

  return (
    <div className="flex flex-col gap-4">
      {/* D20 — every status below is a count over the lane rows that were read.
          If the read was cut short, the counts are about a slice and the reader
          is told so here rather than in a console nobody opens (§5 T2). */}
      <LaneTruncationNotice truncated={truncated} />
      <div className="flex items-start gap-2 rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
        <Database className="h-3.5 w-3.5 mt-0.5 shrink-0" />
        <p>
          How every uploaded column reaches the simulation engine. <b>used</b> = read directly;{" "}
          <b>fallback active</b> = the master field is empty, so the engine resolves it from your
          inbound/outbound data; <b>default applied</b> = no data source, an engine default fills
          in; <b>unused</b> = the engine ignores this column. Fix gaps in the Item Master editor
          (Project Manager) or by re-uploading the dataset.
        </p>
      </div>

      {DATASET_ORDER.map((dataset) => {
        const rows = DATA_MAP_CONTRACT.filter((r) => r.dataset === dataset);
        return (
          <div key={dataset} className="rounded-md border overflow-hidden">
            <div className="bg-muted/40 px-3 py-2 text-xs font-semibold">
              {DATASET_LABEL[dataset]}
            </div>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="whitespace-nowrap text-xs">Uploaded field</TableHead>
                    <TableHead className="whitespace-nowrap text-xs">Engine field</TableHead>
                    <TableHead className="text-xs min-w-[16rem]">Resolution chain</TableHead>
                    <TableHead className="whitespace-nowrap text-xs">Status</TableHead>
                    <TableHead className="text-xs min-w-[14rem]">This project</TableHead>
                    <TableHead className="whitespace-nowrap text-xs">Demanded by</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => {
                    const live = statuses[row.statusKey];
                    const meta = STATUS_META[live.status];
                    const Icon =
                      live.status === "ok"
                        ? CheckCircle2
                        : live.status === "unused"
                        ? CircleOff
                        : TriangleAlert;
                    return (
                      <TableRow key={`${row.dataset}.${row.field}`}>
                        <TableCell className="font-mono text-xs whitespace-nowrap">{row.field}</TableCell>
                        <TableCell className="font-mono text-xs whitespace-nowrap">
                          {row.engineField ?? "—"}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">{row.chain}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className={cn("h-5 gap-1 text-[10px] whitespace-nowrap", meta.className)}>
                            <Icon className="h-3 w-3" />
                            {meta.label}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {loading ? "…" : live.detail}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            {(FIELD_DEMANDS.get(`${row.dataset}.${row.field}`) ?? []).map((d) => (
                              <Badge
                                key={`${d.policyRef}-${d.level}`}
                                variant="outline"
                                className={cn("h-5 text-[10px] whitespace-nowrap", LEVEL_CLASS[d.level])}
                                title={`${d.policyName} — ${d.level}${d.condition ? ` (when ${d.condition})` : ""}`}
                              >
                                {d.policyRef} · {d.level}
                              </Badge>
                            ))}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </div>
        );
      })}
    </div>
  );
}
