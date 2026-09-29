// Version line + history toggle for one Data map tool (mappingVersions.ts).
// Shows which version of the mapping the reader is looking at, when it was last
// changed or re-checked, the engine version it was checked against, and this
// build — and says so loudly when the engine has moved on since.
import { useState } from "react";
import { History, TriangleAlert } from "lucide-react";
import {
  ENGINE_VERSION,
  MAPPING_TITLE,
  MAPPING_VERSIONS,
  staleAgainstEngine,
  type MappingTool,
} from "@/lib/policies/mappingVersions";

const buildSha = (): string => (typeof __BUILD_SHA__ !== "undefined" ? String(__BUILD_SHA__) : "dev");

export function MappingVersionBar({ tool, defaultOpen = false }: { tool: MappingTool; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const list = MAPPING_VERSIONS[tool];
  const latest = list[0];
  const stale = staleAgainstEngine(tool);
  return (
    <div className="flex flex-col gap-1.5 text-xs">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground">
        <span>
          <b className="text-foreground">Mapping v{latest.version}</b> · updated {latest.updated}
        </span>
        <span>checked against engine {latest.engine ?? "not recorded"} · this build runs engine {ENGINE_VERSION}</span>
        <span className="font-mono text-[10px]">build {buildSha()}</span>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="inline-flex min-h-11 items-center gap-1 rounded-sm px-1 text-foreground underline-offset-2 hover:underline md:min-h-0"
        >
          <History className="h-3.5 w-3.5" />
          {open ? "Hide version history" : "Version history"}
        </button>
      </div>
      {stale && (
        <p className="flex items-start gap-1.5 rounded-sm border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-amber-800 dark:text-amber-200">
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {stale}
        </p>
      )}
      {open && (
        <ol className="flex flex-col gap-2 rounded-sm border bg-muted/20 px-3 py-2" aria-label={`${MAPPING_TITLE[tool]} — version history`}>
          {list.map((v) => (
            <li key={v.version} className="flex flex-col gap-0.5">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <b>v{v.version}</b>
                <span className="text-muted-foreground">{v.updated}</span>
                <span className="text-muted-foreground">· engine {v.engine ?? "not recorded"}</span>
                {v.commit && <span className="font-mono text-[10px] text-muted-foreground">{v.commit}</span>}
                <span>— {v.summary}</span>
              </div>
              <ul className="ml-4 list-disc text-muted-foreground">
                {v.changes.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
