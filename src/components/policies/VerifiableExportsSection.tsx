// Verifiable exports section of the model version-history sheet (W2 / G17):
// alongside the per-version policy export, the dataset (canonical hashed
// rows, stamped with graph_hash) and the per-run results workbook — the
// three artifacts that let a reviewer (or an AI) check the model outside
// the app.

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Database, FileSpreadsheet } from "lucide-react";
import { useVerifiableExports } from "@/hooks/useVerifiableExports";

interface Props {
  projectId: string;
  projectName?: string | null;
}

export function VerifiableExportsSection({ projectId, projectName }: Props) {
  const { runs, exportDataset, exportRunResults, busy } = useVerifiableExports(
    projectId,
    projectName,
  );
  const [runId, setRunId] = useState<string>("");

  return (
    <div className="rounded-md border bg-muted/20 p-3 flex flex-col gap-2.5">
      <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
        Verifiable exports
      </div>
      <p className="text-[11px] text-muted-foreground">
        Each saved version's <b>Export</b> below downloads the policy snapshot (with per-cell
        provenance and its policy_hash). The two exports here complete the provenance triangle:
        the <b>dataset</b> (the exact rows its graph_hash was computed over) and a{" "}
        <b>run's results</b> (metadata, per-seed KPIs, weekly series) — together they make a
        model and its results checkable outside the app.
      </p>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-[11px] gap-1"
          disabled={busy !== null}
          onClick={() => void exportDataset()}
        >
          <Database className="h-3 w-3" />
          {busy === "dataset" ? "Exporting…" : "Export dataset (graph_hash-stamped)"}
        </Button>
      </div>
      <div className="flex items-center gap-2">
        <Select value={runId} onValueChange={setRunId}>
          <SelectTrigger className="h-7 flex-1 text-[11px]">
            <SelectValue placeholder={runs.length === 0 ? "No completed runs yet" : "Pick a completed run…"} />
          </SelectTrigger>
          <SelectContent>
            {runs.map((r) => (
              <SelectItem key={r.id} value={r.id} className="text-xs">
                {r.scenario_name ?? r.scenario_id.slice(0, 8)} ·{" "}
                {r.ended_at ? new Date(r.ended_at).toLocaleString() : "?"} · {r.rep_count_done ?? "?"} rep(s)
                {r.code_version ? ` · ${r.code_version}` : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-[11px] gap-1"
          disabled={!runId || busy !== null}
          onClick={() => void exportRunResults(runId)}
        >
          <FileSpreadsheet className="h-3 w-3" />
          {busy === "results" ? "Exporting…" : "Export results"}
        </Button>
      </div>
    </div>
  );
}
