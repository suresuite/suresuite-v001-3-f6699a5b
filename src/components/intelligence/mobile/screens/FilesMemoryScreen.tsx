/**
 * SC Intelligences — files & project memory (screen 18, mobile handoff pass).
 *
 * The desktop sidebar's two bottom disclosures (`SidebarPanels.tsx`), pushed
 * full-screen instead of collapsed under the thread list — the "sheet"
 * variant those panels already support was built for exactly this: no
 * disclosure chrome, 44px row targets, the sheet/screen owns the scroll.
 */
import * as React from "react";
import { MobilePageHeader } from "@/components/mobile";
import { MyFilesPanel, ProjectMemoryPanel, type UserFile, type MemoryEntry } from "../../SidebarPanels";

export function FilesMemoryScreen({
  onBack,
  memoryEnabled,
  memoryProjectId,
  filesEnabled,
  files,
  memoryEntries,
  onDownloadFile,
  onKeepFile,
  onAddMemory,
  onArchiveMemory,
}: {
  onBack: () => void;
  memoryEnabled: boolean;
  memoryProjectId: string | null;
  filesEnabled: boolean;
  files: UserFile[];
  memoryEntries: MemoryEntry[];
  onDownloadFile: (id: string) => void;
  onKeepFile: (id: string) => void;
  onAddMemory: (content: string) => void;
  onArchiveMemory: (id: string) => void;
}) {
  const [scope, setScope] = React.useState<"project" | "all">("project");
  const scopedFiles = scope === "project" && memoryProjectId ? files.filter((f) => f.projectId === memoryProjectId) : files;

  return (
    <>
      <MobilePageHeader variant="detail" title="Files & memory" onBack={onBack} />
      <div className="flex flex-col divide-y divide-[#e8e8ea] pb-4">
        {!memoryProjectId && (
          <p className="px-[var(--m-gutter)] py-4 text-[13.5px] text-[#525252]">
            Pick a project to see its files and memory.
          </p>
        )}
        {memoryProjectId && filesEnabled && (
          <MyFilesPanel
            variant="sheet"
            files={scopedFiles}
            scope={scope}
            onScopeChange={setScope}
            onDownload={onDownloadFile}
            onKeep={onKeepFile}
          />
        )}
        {memoryProjectId && memoryEnabled && (
          <ProjectMemoryPanel variant="sheet" entries={memoryEntries} onAdd={onAddMemory} onArchive={onArchiveMemory} />
        )}
      </div>
    </>
  );
}
