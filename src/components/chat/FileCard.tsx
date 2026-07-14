import { useState } from "react";
import { Bookmark, BookmarkCheck, Download, FileSpreadsheet, FileText, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { PART_TREATMENTS } from "@/lib/chat/partStyles";
import {
  expiryCountdown,
  fileWorkspaceUiEnabled,
  humanBytes,
  useUserFiles,
  type UserFile,
} from "@/hooks/useUserFiles";

/**
 * Report/file card — the §17.2 readability grammar's `file` content class
 * (emerald left rail; ai-agents.md §16.2/§17.2): filename, format icon,
 * size, expiry countdown, Download (60-minute signed URL) and Keep.
 * All treatments from partStyles.ts — color encodes the class, never the
 * agent. Used in-thread (the applied decision_report card flips to these)
 * and by the "My files" workspace panel.
 */

const KIND_ICON: Record<UserFile["kind"], typeof FileText> = {
  report_xlsx: FileSpreadsheet,
  report_pdf: FileText,
  export_csv: FileSpreadsheet,
  upload: FileText,
};

const KIND_LABEL: Record<UserFile["kind"], string> = {
  report_xlsx: "XLSX",
  report_pdf: "PDF",
  export_csv: "CSV",
  upload: "file",
};

export interface FileCardProps {
  file: UserFile;
  onDownload: (fileId: string) => Promise<string | null>;
  onKeep: (fileId: string, retained: boolean) => Promise<string | null>;
  compact?: boolean;
}

export function FileCard({ file, onDownload, onKeep, compact = false }: FileCardProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const Icon = KIND_ICON[file.kind] ?? FileText;
  const t = PART_TREATMENTS.file;

  const run = async (fn: () => Promise<string | null>) => {
    setBusy(true);
    setError(null);
    const err = await fn();
    if (err) setError(err);
    setBusy(false);
  };

  return (
    <div
      role="region"
      aria-label={`File: ${file.name}`}
      className={cn(compact ? "px-2 py-1.5" : "my-2 px-3 py-2", t.card)}
    >
      <div className="flex items-center gap-2">
        <Icon className={cn("h-4 w-4 shrink-0", t.icon)} />
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium" title={file.name}>
          {file.name}
        </span>
        <span className={cn("rounded-full px-1.5 py-px text-[10.5px] font-medium", t.chip)}>
          {KIND_LABEL[file.kind] ?? file.kind}
        </span>
      </div>
      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] text-muted-foreground">
        <span>{humanBytes(file.size_bytes)}</span>
        <span aria-live="polite">
          {file.retained ? (
            <span className={t.accent}>kept — never auto-deleted</span>
          ) : (
            expiryCountdown(file.expires_at)
          )}
        </span>
        <span className="ml-auto inline-flex items-center gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => run(() => onDownload(file.id))}
            className={cn("inline-flex items-center gap-1 text-[11.5px] hover:underline", t.accent)}
            title="Download via a 60-minute signed link"
          >
            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
            Download
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => run(() => onKeep(file.id, !file.retained))}
            className="inline-flex items-center gap-1 text-[11.5px] text-muted-foreground hover:text-foreground hover:underline"
            title={file.retained
              ? "Stop keeping — the retention countdown resumes"
              : "Keep this file (exempt from the 14-day expiry, within your 500 MB cap)"}
          >
            {file.retained ? <BookmarkCheck className="h-3 w-3" /> : <Bookmark className="h-3 w-3" />}
            {file.retained ? "Kept" : "Keep"}
          </button>
        </span>
      </div>
      {error && (
        <div className={cn("mt-1 px-2 py-1 text-[11.5px]", PART_TREATMENTS.error.card, PART_TREATMENTS.error.accent)}>
          {error}
        </div>
      )}
    </div>
  );
}

/**
 * The applied decision_report card's file view (§16.1: "card flips to a file
 * card"): resolves the applied_result's file_ids against the owner's
 * workspace listing (which also runs the lazy retention sweep), so the
 * cards show live expiry/Keep state.
 */
export function AppliedReportFiles({ fileIds }: { fileIds: string[] }) {
  const { files, loading, keep, download } = useUserFiles(null);
  if (!fileWorkspaceUiEnabled()) return null;
  const mine = files.filter((f) => fileIds.includes(f.id));
  if (loading && mine.length === 0) {
    return (
      <div className="mt-1 flex items-center gap-2 text-[12px] text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" /> Loading files…
      </div>
    );
  }
  if (mine.length === 0) {
    return (
      <div className="mt-1 text-[12px] text-muted-foreground">
        These files are no longer in your workspace (expired or deleted).
      </div>
    );
  }
  return (
    <div>
      {mine.map((f) => <FileCard key={f.id} file={f} onDownload={download} onKeep={keep} />)}
    </div>
  );
}
