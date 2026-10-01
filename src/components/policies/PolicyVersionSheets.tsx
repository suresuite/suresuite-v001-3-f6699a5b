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
import { Checkbox } from "@/components/ui/checkbox";
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
  const name = v.label || `Version ${v.id.slice(0, 8)}`;
  // "v4 · name" — the per-project content number (WP 10.2), when the row carries it.
  return typeof v.version_no === "number" ? `v${v.version_no} · ${name}` : name;
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
  onRestore,
  onExport,
  onDelete,
  onDeleteMany,
  onUpdateNotes,
  exportsSection,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  versions: PolicyVersion[];
  /** The version whose content IS the live policies (WP 10.2) — shown, not chosen:
   *  a version a page could "select" without loading it is how /policies and the Lab
   *  came to disagree about which model was in force (§4 D242). */
  selectedVersionId: string | null;
  onRestore: (id: string) => Promise<void>;
  onExport?: (version: PolicyVersion) => Promise<void>;
  onDelete?: (versionId: string) => Promise<boolean>;
  /** Batch delete; returns the ids actually deleted. Enables multi-select. */
  onDeleteMany?: (versionIds: string[]) => Promise<string[]>;
  onUpdateNotes?: (versionId: string, notes: string) => Promise<void>;
  exportsSection?: React.ReactNode;
}) {
  const isMobile = useIsMobile();
  const [editingNotesId, setEditingNotesId] = useState<string | null>(null);
  const [notesDraft, setNotesDraft] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  // Multi-select delete. A version bound to a run or model card is never
  // checkable — the server would refuse it anyway (delete_policy_version).
  const [selecting, setSelecting] = useState(false);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const isReferenced = (v: PolicyVersion) => (v.run_count ?? 0) + (v.card_count ?? 0) > 0;
  const deletable = versions.filter((v) => !isReferenced(v));
  const checkedIds = deletable.filter((v) => checked.has(v.id)).map((v) => v.id);
  const allChecked = deletable.length > 0 && checkedIds.length === deletable.length;
  const exitSelecting = () => {
    setSelecting(false);
    setChecked(new Set());
  };
  const toggleChecked = (id: string, on: boolean) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  const deleteChecked = async () => {
    if (!onDeleteMany || checkedIds.length === 0) return;
    const n = checkedIds.length;
    if (
      typeof window !== "undefined" &&
      !window.confirm(`Delete ${n} version${n === 1 ? "" : "s"}? This cannot be undone.`)
    )
      return;
    setBulkBusy(true);
    const deleted = await onDeleteMany(checkedIds);
    setBulkBusy(false);
    setChecked((prev) => {
      const next = new Set(prev);
      deleted.forEach((id) => next.delete(id));
      return next;
    });
    if (deleted.length === n) setSelecting(false);
  };
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
    <Sheet
      open={open}
      onOpenChange={(v) => {
        if (!v) exitSelecting();
        onOpenChange(v);
      }}
    >
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

          <div
            className={cn(
              SURFACE,
              "flex items-center gap-2 px-2.5 py-1.5 text-left",
              selectedVersionId === null && "border-foreground",
            )}
          >
            <span className="text-[12.5px] font-medium">Current (live working copy)</span>
            <MonoChip>Live</MonoChip>
            <span className="ml-auto font-mono text-[11px] text-muted-foreground">
              {selectedVersionId === null
                ? "unsaved edits"
                : `saved as ${versionDisplayName(versions.find((v) => v.id === selectedVersionId) ?? versions[0])}`}
            </span>
          </div>

          {onDeleteMany && deletable.length > 0 && (
            <div
              className={cn(
                "flex flex-wrap items-center gap-2",
                "[&_button]:min-h-11 md:[&_button]:min-h-0",
              )}
            >
              {selecting ? (
                <>
                  <label className="flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
                    <Checkbox
                      checked={allChecked}
                      onCheckedChange={(on) =>
                        setChecked(on ? new Set(deletable.map((v) => v.id)) : new Set())
                      }
                      aria-label="Select all deletable versions"
                    />
                    all ({deletable.length})
                  </label>
                  <Button
                    variant="destructive"
                    size="sm"
                    className="ml-auto h-[26px] px-2.5 text-[11.5px]"
                    disabled={checkedIds.length === 0 || bulkBusy}
                    onClick={deleteChecked}
                  >
                    {bulkBusy ? "Deleting…" : `Delete ${checkedIds.length}`}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-[26px] px-2.5 text-[11.5px]"
                    disabled={bulkBusy}
                    onClick={exitSelecting}
                  >
                    Cancel
                  </Button>
                </>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  className="ml-auto h-[26px] px-2.5 text-[11.5px]"
                  onClick={() => setSelecting(true)}
                >
                  Select multiple
                </Button>
              )}
            </div>
          )}

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
                  {selecting ? (
                    <label className="flex min-w-0 items-center gap-2">
                      <Checkbox
                        checked={checked.has(v.id)}
                        disabled={referenced || bulkBusy}
                        onCheckedChange={(on) => toggleChecked(v.id, on === true)}
                        aria-label={`Select ${versionDisplayName(v)} for deletion`}
                        title={
                          referenced
                            ? `Can't delete — referenced by ${v.run_count ?? 0} run(s) and ${v.card_count ?? 0} model card(s)`
                            : undefined
                        }
                      />
                      <span className={label}>{versionDisplayName(v)}</span>
                    </label>
                  ) : (
                    <span className={label}>{versionDisplayName(v)}</span>
                  )}
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
                    {isSelected && <MonoChip color="#111111">in force</MonoChip>}
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
