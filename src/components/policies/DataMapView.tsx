// /policies → Data map. Two questions, one tab each, so the page never has to
// answer both at once:
//   1. "Does an edit on the Policies page change a run?" — the page's own
//      columns (the same for every project).
//   2. "Which uploaded columns does the engine read, and what fills a gap?" —
//      the datasets, with THIS project's live status.
// They share one vocabulary: every chain in tab 2 is the engine's rule, and tab
// 1 cites it rather than restating it differently.
import { useState } from "react";
import { Segmented } from "@/components/intelligence/piUi";
import { PolicyColumnCheck } from "@/components/policies/PolicyColumnCheck";
import { DataMapGrid } from "@/components/policies/DataMapGrid";

type DataMapTab = "columns" | "uploads";

export function DataMapView({ projectId }: { projectId: string }) {
  const [tab, setTab] = useState<DataMapTab>("columns");
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2 rounded-md border px-3 py-2">
        <Segmented<DataMapTab>
          size="sm"
          value={tab}
          onChange={setTab}
          ariaLabel="Data map view"
          options={[
            { value: "columns", label: "Policies page · column by column" },
            { value: "uploads", label: "Uploaded data → engine" },
          ]}
        />
        <p className="text-xs text-muted-foreground">
          {tab === "columns"
            ? "Every column of the Policies page: what the cell shows, where an edit is saved, what the simulation engine uses, and whether an edit changes a run. The same for every project."
            : "Every column of every dataset the simulation reads: where it goes in the engine, what fills it when it is blank, and this project's status."}
        </p>
      </div>
      {tab === "columns" ? <PolicyColumnCheck /> : <DataMapGrid projectId={projectId} />}
    </div>
  );
}
