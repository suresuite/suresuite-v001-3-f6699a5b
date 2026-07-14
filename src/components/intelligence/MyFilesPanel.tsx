import { useState } from "react";
import { FolderOpen, Loader2, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { PART_TREATMENTS } from "@/lib/chat/partStyles";
import { FileCard } from "@/components/chat/FileCard";
import {
  EXPIRY_WARNING_DAYS,
  expiresWithinDays,
  useUserFiles,
} from "@/hooks/useUserFiles";

/**
 * "My files" workspace panel — v1.2 Phase 3 (ai-agents.md §16.2 surfaces):
 * the user's rendered reports/exports in the Project Intelligence sidebar,
 * with a per-project filter and the T-3-day expiry warning banner
 * ("N files expire this week — download or Keep"). Listing runs the lazy
 * retention sweep server-side, so nothing expired ever shows.
 */

export function MyFilesPanel({ projectId }: { projectId: string | null }) {
  const [scope, setScope] = useState<"project" | "all">(projectId ? "project" : "all");
  const effectiveProject = scope === "project" && projectId ? projectId : null;
  const { files, loading, keep, download, remove } = useUserFiles(effectiveProject);

  const expiring = files.filter((f) => expiresWithinDays(f, EXPIRY_WARNING_DAYS)).length;

  return (
    <div className="border-t border-border px-2 pb-2 pt-1.5">
      <div className="flex items-center gap-1.5 px-1 py-1">
        <FolderOpen className={cn("h-3.5 w-3.5", PART_TREATMENTS.file.icon)} />
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          My files
        </span>
        {loading && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
        {projectId && (
          <div className="ml-auto flex items-center gap-0.5 text-[10.5px]">
            <button
              type="button"
              onClick={() => setScope("project")}
              className={cn(
                "rounded px-1.5 py-0.5",
                scope === "project" ? PART_TREATMENTS.file.chip : "text-muted-foreground hover:text-foreground",
              )}
            >
              This project
            </button>
            <button
              type="button"
              onClick={() => setScope("all")}
              className={cn(
                "rounded px-1.5 py-0.5",
                scope === "all" ? PART_TREATMENTS.file.chip : "text-muted-foreground hover:text-foreground",
              )}
            >
              All
            </button>
          </div>
        )}
      </div>

      {expiring > 0 && (
        <div className={cn("mx-1 mb-1.5 rounded px-2 py-1 text-[11.5px]", "bg-amber-500/10 text-amber-700 dark:text-amber-400")}>
          {expiring} {expiring === 1 ? "file expires" : "files expire"} this week — download or Keep.
        </div>
      )}

      {files.length === 0 && !loading ? (
        <div className="px-1 pb-1 text-[11.5px] text-muted-foreground">
          Nothing here yet — approve a report proposal in a chat and the
          rendered files land in your workspace (kept 14 days unless you Keep them).
        </div>
      ) : (
        <ul className="max-h-56 space-y-1 overflow-y-auto px-1">
          {files.map((f) => (
            <li key={f.id} className="group relative">
              <FileCard file={f} onDownload={download} onKeep={keep} compact />
              <button
                type="button"
                className="invisible absolute right-1.5 top-1.5 text-muted-foreground hover:text-destructive group-hover:visible"
                title="Delete this file now (removes the stored document too)"
                onClick={() => void remove(f.id)}
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
