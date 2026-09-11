// Model-version history + save dialog.
//
// Row A of PolicySetupBar carries the version identity and the two buttons;
// everything that used to sit in the old PolicyVersionBar strip — the version
// list, load / export / delete, the notes editor and the verifiable-exports
// section — lives here, in the sheet that "History n" opens.
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-is-mobile";
import { DIALOG_AS_SHEET } from "@/components/shared";
import { KX_TIGHT, MonoChip, SURFACE } from "@/components/intelligence/piUi";
import type { PolicyVersion } from "@/hooks/usePolicies";

export function formatVersionWhen(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function versionDisplayName(v: PolicyVersion) {
  return v.label || `Version ${v.id.slice(0, 8)}`;
}

/** Save a snapshot of the current bundle — opened from row A's black button. */
export function SaveVersionDialog({
  open,
  onOpenChange,
  current,
  onSave,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  current: PolicyVersion | null;
  onSave: (label?: string, notes?: string) => Promise<string | null>;
}) {
  const [label, setLabel] = useState("");
  const [notes, setNotes] = useState("");
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (v) {
          setLabel("");
          setNotes("");
        }
        onOpenChange(v);
      }}
    >
      <DialogContent className={cn(DIALOG_AS_SHEET, "md:max-w-sm")}>
        <DialogHeader>
          <DialogTitle className="text-[13px]">Save model version</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-1">
          <span className={KX_TIGHT}>Label</span>
          <Input
            autoFocus
            className="h-8 min-h-11 text-[12.5px] md:min-h-0"
            placeholder="Pre-Q4 freeze"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1">
          <span className={KX_TIGHT}>Notes</span>
          <Textarea
            className="text-[12.5px]"
            placeholder="assumptions, scope, what changed"
            value={notes}
            rows={3}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
        {current && (
          <span className="font-mono text-[11px] text-muted-foreground">
            Parent {versionDisplayName(current)}
          </span>
        )}
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={async () => {
              onOpenChange(false);
              await onSave(label.trim() || undefined, notes.trim() || undefined);
            }}
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function PolicyHistorySheet({
  open,
  onOpenChange,
  versions,
  selectedVersionId,
  onSelect,
  onRestore,
  onExport,
  onDelete,
  onUpdateNotes,
  exportsSection,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  versions: PolicyVersion[];
  selectedVersionId: string | null;
  onSelect: (id: string | null) => void;
  onRestore: (id: string) => Promise<void>;
  onExport?: (version: PolicyVersion) => Promise<void>;
  onDelete?: (versionId: string) => Promise<boolean>;
  onUpdateNotes?: (versionId: string, notes: string) => Promise<void>;
  exportsSection?: React.ReactNode;
}) {
  const isMobile = useIsMobile();
  const [editingNotesId, setEditingNotesId] = useState<string | null>(null);
  const [notesDraft, setNotesDraft] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const parentLabel = (id: string | null) =>
    versions.find((v) => v.id === id)?.label || (id ? id.slice(0, 8) : "—");

  // v2 §4C. The sheet is mounted by both platforms and already branches on
  // `isMobile` for its side and its radius, so the skin rides that branch
  // rather than a second prop: below `md` a version is a panel row — the
  // outer rule around the list, the inner rule between entries, the 13.5px
  // label and the mono sub-lines — instead of a stack of bordered cards,
  // which is the second container style §12 rules out. Above `md` every
  // class below is the literal it has always been.
  const card = isMobile
    ? "border-b border-[#e8e8ea] bg-white last:border-b-0"
    : cn(SURFACE);
  const label = isMobile
    ? "truncate text-[length:var(--fs-row)] font-medium text-[#171717]"
    : "truncate text-[12.5px] font-medium";
  const meta = isMobile
    ? "font-mono text-[length:var(--fs-micro)] tracking-[0.04em] text-[#525252]"
    : "font-mono text-[11px] text-muted-foreground";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={isMobile ? "bottom" : "right"}
        className={cn(
          "overflow-y-auto",
          isMobile
            ? "max-h-[85svh] rounded-t-xl landscape:max-h-full landscape:rounded-none"
            : "w-[440px] sm:max-w-[440px]",
        )}
      >
        <SheetHeader>
          <SheetTitle className="text-[13px]">Model version history</SheetTitle>
        </SheetHeader>

        <div className="mt-4 flex flex-col gap-2">
          {exportsSection}

          <button
            type="button"
            onClick={() => {
              onSelect(null);
              onOpenChange(false);
            }}
            className={cn(
              SURFACE,
              "flex items-center gap-2 px-2.5 py-1.5 text-left",
              selectedVersionId === null ? "border-foreground" : "hover:border-foreground",
            )}
          >
            <span className="text-[12.5px] font-medium">Current (live working copy)</span>
            <MonoChip>Live</MonoChip>
          </button>

          {versions.length === 0 && (
            <p className="py-6 text-center font-mono text-[11px] text-muted-foreground">
              no saved versions
            </p>
          )}

          <div
            className={cn(
              isMobile && "overflow-hidden rounded-[4px] border border-[#d4d4d4]",
              !isMobile && "contents",
            )}
          >
          {versions.map((v) => {
            const isSelected = v.id === selectedVersionId;
            const refCount = (v.run_count ?? 0) + (v.card_count ?? 0);
            const referenced = refCount > 0;
            const editing = editingNotesId === v.id;
            return (
              <div
                key={v.id}
                className={cn(
                  card,
                  "flex flex-col gap-1 p-2.5",
                  isSelected && (isMobile ? "bg-[#fafafa]" : "border-foreground"),
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className={label}>{versionDisplayName(v)}</span>
                  <div className="flex shrink-0 items-center gap-1">
                    {referenced && (
                      <MonoChip>
                        <span
                          title={`Referenced by ${v.run_count ?? 0} run(s) and ${v.card_count ?? 0} model card(s)`}
                        >
                          in use
                        </span>
                      </MonoChip>
                    )}
                    {isSelected && <MonoChip color="#111111">selected</MonoChip>}
                  </div>
                </div>
                <span className={meta}>
                  {formatVersionWhen(v.created_at)} · {v.author_name || v.author_email || "unknown"}
                </span>
                <span className={meta}>parent {parentLabel(v.parent_version_id)}</span>

                {editing ? (
                  <div className="mt-1 flex flex-col gap-1.5">
                    <Textarea
                      autoFocus
                      rows={3}
                      value={notesDraft}
                      onChange={(e) => setNotesDraft(e.target.value)}
                      className="text-[12px]"
                    />
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        className="h-6 px-2 text-[11px]"
                        disabled={busyId === v.id}
                        onClick={async () => {
                          setBusyId(v.id);
                          await onUpdateNotes?.(v.id, notesDraft);
                          setBusyId(null);
                          setEditingNotesId(null);
                        }}
                      >
                        Save notes
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2 text-[11px]"
                        onClick={() => setEditingNotesId(null)}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : v.notes ? (
                  <div className="mt-1 flex items-start gap-1.5">
                    <p className="flex-1 whitespace-pre-wrap text-[12px]">{v.notes}</p>
                    {onUpdateNotes && (
                      <button
                        type="button"
                        title="Edit notes"
                        className="shrink-0 font-mono text-[10px] text-muted-foreground hover:text-foreground"
                        onClick={() => {
                          setEditingNotesId(v.id);
                          setNotesDraft(v.notes ?? "");
                        }}
                      >
                        edit
                      </button>
                    )}
                  </div>
                ) : (
                  onUpdateNotes && (
                    <button
                      type="button"
                      className="mt-0.5 self-start font-mono text-[10px] text-muted-foreground hover:text-foreground"
                      onClick={() => {
                        setEditingNotesId(v.id);
                        setNotesDraft("");
                      }}
                    >
                      + notes
                    </button>
                  )
                )}

                <div
                  className={cn(
                    "mt-1.5 flex flex-wrap items-center gap-2",
                    "[&_button]:min-h-11 md:[&_button]:min-h-0",
                  )}
                >
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-[26px] px-2.5 text-[11.5px]"
                    onClick={() => {
                      onSelect(v.id);
                      onOpenChange(false);
                    }}
                  >
                    Select
                  </Button>
                  <Button
                    size="sm"
                    className="h-[26px] px-2.5 text-[11.5px]"
                    onClick={async () => {
                      await onRestore(v.id);
                      onOpenChange(false);
                    }}
                  >
                    Load
                  </Button>
                  {onExport && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-[26px] px-2.5 text-[11.5px]"
                      disabled={busyId === v.id}
                      onClick={async () => {
                        setBusyId(v.id);
                        await onExport(v);
                        setBusyId(null);
                      }}
                    >
                      Export
                    </Button>
                  )}
                  {onDelete && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="ml-auto h-[26px] px-2.5 text-[11.5px] disabled:opacity-40"
                      disabled={referenced || busyId === v.id}
                      title={
                        referenced
                          ? `Can't delete — referenced by ${v.run_count ?? 0} run(s) and ${v.card_count ?? 0} model card(s)`
                          : "Delete this version"
                      }
                      onClick={async () => {
                        if (
                          typeof window !== "undefined" &&
                          !window.confirm(`Delete version "${versionDisplayName(v)}"?`)
                        )
                          return;
                        setBusyId(v.id);
                        await onDelete(v.id);
                        setBusyId(null);
                      }}
                    >
                      Delete
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
