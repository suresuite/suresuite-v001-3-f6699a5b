import { useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  History,
  Save,
  GitBranch,
  RotateCcw,
  Download,
  Trash2,
  Pencil,
  Lock,
} from "lucide-react";
import type { PolicyVersion } from "@/hooks/usePolicies";

interface Props {
  versions: PolicyVersion[];
  selectedVersionId: string | null;
  isDirty?: boolean;
  onSelect: (id: string | null) => void;
  onSave: (label?: string, notes?: string) => Promise<string | null>;
  onRestore: (id: string) => Promise<void>;
  /** 6.D — export a saved version's bundle to Excel. */
  onExport?: (version: PolicyVersion) => Promise<void>;
  /** 6.D — delete a version (guarded server-side against bound runs/cards). */
  onDelete?: (versionId: string) => Promise<boolean>;
  /** 6.D — edit a version's free-text notes. */
  onUpdateNotes?: (versionId: string, notes: string) => Promise<void>;
  /** W2/G17 — the dataset + run-results export controls rendered at the top
   *  of the history sheet (the policy export stays per-version below). */
  exportsSection?: React.ReactNode;
}

function formatWhen(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function PolicyVersionBar({
  versions,
  selectedVersionId,
  isDirty,
  onSelect,
  onSave,
  onRestore,
  onExport,
  onDelete,
  onUpdateNotes,
  exportsSection,
}: Props) {
  const [saveOpen, setSaveOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [notes, setNotes] = useState("");
  // Inline notes editing in the history sheet (6.D).
  const [editingNotesId, setEditingNotesId] = useState<string | null>(null);
  const [notesDraft, setNotesDraft] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const current = versions.find((v) => v.id === selectedVersionId) ?? null;
  const parentLabel = (id: string | null) =>
    versions.find((v) => v.id === id)?.label || (id ? id.slice(0, 8) : "—");

  const isLive = !current;
  const displayName = current
    ? current.label || `Version ${current.id.slice(0, 8)}`
    : "Current (live working copy)";
  const meta = current
    ? `${formatWhen(current.created_at)} · ${current.author_name || current.author_email || "unknown"}`
    : "Unsaved working copy — changes are not versioned until you save";

  return (
    <div className="flex items-center gap-3 flex-wrap rounded-md border border-black bg-card px-3 py-2.5">
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <GitBranch className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <span className="text-xs text-muted-foreground">Model version:</span>
        <span
          className={`text-sm font-semibold truncate ${
            isLive ? "text-foreground" : "text-primary"
          }`}
        >
          {displayName}
        </span>
        {isLive ? (
          <Badge variant="outline" className="h-4 px-1.5 text-[10px] shrink-0">
            Live
          </Badge>
        ) : (
          <Badge variant="secondary" className="h-4 px-1.5 text-[10px] shrink-0">
            Snapshot
          </Badge>
        )}
        {current && (
          <span className="text-[11px] text-muted-foreground truncate hidden md:inline">
            · {meta}
          </span>
        )}
        {isDirty && (
          <span className="flex items-center gap-1 shrink-0" title="Simulation runs require a saved, unchanged version">
            <span className="h-2 w-2 rounded-full bg-amber-500" />
            <span className="text-[11px] text-amber-600">
              {current ? `unsaved changes vs ${current.label || current.id.slice(0, 8)}` : "unsaved changes"}
            </span>
          </span>
        )}
      </div>

      <Select
        value={selectedVersionId ?? "__live__"}
        onValueChange={(v) => onSelect(v === "__live__" ? null : v)}
      >
        <SelectTrigger className="h-8 text-xs w-[240px]">
          <SelectValue placeholder="Current (live)" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__live__" className="text-xs">
            Current (live working copy)
          </SelectItem>
          {versions.map((v) => (
            <SelectItem key={v.id} value={v.id} className="text-xs">
              <div className="flex flex-col">
                <span>{v.label || `Version ${v.id.slice(0, 8)}`}</span>
                <span className="text-[10px] text-muted-foreground">
                  {formatWhen(v.created_at)} · {v.author_name || v.author_email || "unknown"}
                </span>
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {current && (
        <Button
          variant="outline"
          size="sm"
          className="h-8 text-xs gap-1"
          onClick={() => onRestore(current.id)}
        >
          <RotateCcw className="h-3 w-3" /> Load
        </Button>
      )}

      <Button
        size="sm"
        className="h-8 text-xs gap-1"
        onClick={() => {
          setLabel("");
          setNotes("");
          setSaveOpen(true);
        }}
      >
        <Save className="h-3 w-3" /> Save model version
      </Button>

      <Button
        variant="outline"
        size="sm"
        className="h-8 text-xs gap-1"
        onClick={() => setHistoryOpen(true)}
      >
        <History className="h-3 w-3" /> History
        {versions.length > 0 && (
          <Badge variant="secondary" className="ml-1 h-4 px-1 text-[10px]">
            {versions.length}
          </Badge>
        )}
      </Button>




      <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Save simulation model version</DialogTitle>
            <DialogDescription className="text-xs">
              Captures the current policy bundle, the model you started from, and your identity.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-medium text-muted-foreground">Label</label>
            <Input
              autoFocus
              placeholder="Label (optional) — e.g. Pre-Q4 freeze"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-medium text-muted-foreground">
              Notes <span className="font-normal">(optional) — a description of this model</span>
            </label>
            <Textarea
              placeholder="What is this model? assumptions, scope, what changed and why…"
              value={notes}
              rows={3}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
          {current && (
            <p className="text-[11px] text-muted-foreground">
              Parent: <span className="font-medium">{current.label || current.id.slice(0, 8)}</span>
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setSaveOpen(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={async () => {
                setSaveOpen(false);
                await onSave(label.trim() || undefined, notes.trim() || undefined);
              }}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Sheet open={historyOpen} onOpenChange={setHistoryOpen}>
        <SheetContent className="w-[440px] sm:max-w-[440px]">
          <SheetHeader>
            <SheetTitle>Model version history</SheetTitle>
            <SheetDescription className="text-xs">
              Every saved snapshot, who saved it, and what model it came from.
            </SheetDescription>
          </SheetHeader>
          <div className="mt-4 flex flex-col gap-2 overflow-y-auto max-h-[80vh]">
            {exportsSection}
            {versions.length === 0 && (
              <p className="text-xs text-muted-foreground py-6 text-center">
                No saved versions yet. Click "Save model version" to capture the current setup.
              </p>
            )}
            {versions.map((v) => {
              const isSelected = v.id === selectedVersionId;
              const refCount = (v.run_count ?? 0) + (v.card_count ?? 0);
              const referenced = refCount > 0;
              const editing = editingNotesId === v.id;
              return (
                <div
                  key={v.id}
                  className={`rounded-md border p-3 text-xs flex flex-col gap-1 ${
                    isSelected ? "border-primary bg-primary/5" : ""
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">
                      {v.label || `Version ${v.id.slice(0, 8)}`}
                    </span>
                    <div className="flex items-center gap-1">
                      {referenced && (
                        <Badge
                          variant="outline"
                          className="text-[10px] gap-1"
                          title={`Referenced by ${v.run_count ?? 0} run(s) and ${v.card_count ?? 0} model card(s)`}
                        >
                          <Lock className="h-2.5 w-2.5" /> in use
                        </Badge>
                      )}
                      {isSelected && (
                        <Badge variant="secondary" className="text-[10px]">
                          Selected
                        </Badge>
                      )}
                    </div>
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    {formatWhen(v.created_at)} · by{" "}
                    {v.author_name || v.author_email || "unknown user"}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    Parent: {parentLabel(v.parent_version_id)}
                  </div>

                  {/* Notes (6.D) — free-text model description, inline-editable. */}
                  {editing ? (
                    <div className="flex flex-col gap-1.5 mt-1">
                      <Textarea
                        autoFocus
                        rows={3}
                        value={notesDraft}
                        onChange={(e) => setNotesDraft(e.target.value)}
                        placeholder="Describe this model…"
                        className="text-xs"
                      />
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          className="h-6 text-[11px]"
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
                          className="h-6 text-[11px]"
                          onClick={() => setEditingNotesId(null)}
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : v.notes ? (
                    <div className="mt-1 flex items-start gap-1.5">
                      <p className="text-[11px] text-foreground/80 whitespace-pre-wrap flex-1">
                        {v.notes}
                      </p>
                      {onUpdateNotes && (
                        <button
                          type="button"
                          title="Edit notes"
                          className="text-muted-foreground hover:text-foreground shrink-0"
                          onClick={() => {
                            setEditingNotesId(v.id);
                            setNotesDraft(v.notes ?? "");
                          }}
                        >
                          <Pencil className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                  ) : (
                    onUpdateNotes && (
                      <button
                        type="button"
                        className="mt-0.5 self-start text-[11px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
                        onClick={() => {
                          setEditingNotesId(v.id);
                          setNotesDraft("");
                        }}
                      >
                        <Pencil className="h-3 w-3" /> Add notes
                      </button>
                    )
                  )}

                  <div className="flex flex-wrap gap-2 mt-1.5">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-[11px]"
                      onClick={() => {
                        onSelect(v.id);
                        setHistoryOpen(false);
                      }}
                    >
                      Select
                    </Button>
                    <Button
                      size="sm"
                      className="h-7 text-[11px] gap-1"
                      onClick={async () => {
                        await onRestore(v.id);
                        setHistoryOpen(false);
                      }}
                    >
                      <RotateCcw className="h-3 w-3" /> Load
                    </Button>
                    {onExport && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-[11px] gap-1"
                        disabled={busyId === v.id}
                        onClick={async () => {
                          setBusyId(v.id);
                          await onExport(v);
                          setBusyId(null);
                        }}
                      >
                        <Download className="h-3 w-3" /> Export
                      </Button>
                    )}
                    {onDelete && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-[11px] gap-1 text-destructive hover:text-destructive ml-auto disabled:opacity-40"
                        disabled={referenced || busyId === v.id}
                        title={
                          referenced
                            ? `Can't delete — referenced by ${v.run_count ?? 0} run(s) and ${v.card_count ?? 0} model card(s)`
                            : "Delete this version"
                        }
                        onClick={async () => {
                          if (
                            typeof window !== "undefined" &&
                            !window.confirm(
                              `Delete version "${v.label || v.id.slice(0, 8)}"? This cannot be undone.`,
                            )
                          )
                            return;
                          setBusyId(v.id);
                          await onDelete(v.id);
                          setBusyId(null);
                        }}
                      >
                        <Trash2 className="h-3 w-3" /> Delete
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
