/**
 * Sidebar bottom panels — My files (teal #14b8c4) and Project memory
 * (purple #7c3aed).
 *
 * Both are collapsed disclosures: closed they cost ~36px and show only
 * chevron + label + count, so the thread list keeps the vertical space. Open,
 * rows are white cards on the layer tint with their own max-height scroller —
 * an unbounded list here is what pushed the thread list to a clipped 109px in
 * the first build.
 */
import React, { useState } from "react";
import { Download, Pin } from "lucide-react";
import { LAYER, MonoChip, PanelHeader, Segmented } from "./piUi";
import { cn } from "@/lib/utils";

export interface UserFile {
  id: string;
  /** Scopes the Project/All toggle in ChatSidebar. */
  projectId: string | null;
  name: string;
  kind: string;
  expiresLabel: string;
  retained: boolean;
}

export interface MemoryEntry {
  id: string;
  kindLabel: string;
  content: string;
}

/* ── My files ────────────────────────────────────────────────────────── */

export function MyFilesPanel({
  files,
  scope,
  onScopeChange,
  onDownload,
  onKeep,
}: {
  files: UserFile[];
  scope: "project" | "all";
  onScopeChange: (s: "project" | "all") => void;
  onDownload: (id: string) => void;
  onKeep: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const expiring = files.filter((f) => !f.retained).length;

  return (
    <div
      className="shrink-0 border-t px-2 py-1.5"
      style={{ borderColor: "#e2f4f6", background: "rgba(20,184,196,.05)" }}
    >
      <PanelHeader
        open={open}
        onToggle={() => setOpen((v) => !v)}
        label="My files"
        count={files.length}
        color="#0f8a94"
        right={
          <Segmented
            size="sm"
            className="ml-auto"
            value={scope}
            onChange={onScopeChange}
            options={[
              { value: "project", label: "Project" },
              { value: "all", label: "All" },
            ]}
          />
        }
      />

      {open && (
        <div className="mt-1.5">
          {expiring > 0 && (
            <div
              className="mb-1.5 rounded-sm border bg-background px-2 py-1.5 text-[11px] leading-[1.45] text-[#7a5a12]"
              style={{ borderColor: "#f3e2ad", borderLeft: "2px solid " + LAYER.accent }}
            >
              {expiring === 1 ? "1 file expires" : expiring + " files expire"} this week — download or Keep.
            </div>
          )}

          {files.length === 0 && (
            <div className="py-0.5 text-[11.5px] text-muted-foreground">
              Nothing here yet — approved reports land here.
            </div>
          )}

          <div className="max-h-[110px] overflow-y-auto">
            {files.map((f) => (
              <div
                key={f.id}
                className="mb-1.5 rounded-sm border bg-background px-2 py-1.5"
                style={{ borderColor: "#e2f4f6", borderLeft: "2px solid " + LAYER.process }}
              >
                <div className="flex items-center gap-1.5">
                  <span
                    title={f.name}
                    className="min-w-0 flex-1 truncate text-[12px] font-medium text-foreground"
                  >
                    {f.name}
                  </span>
                  <MonoChip>{f.kind}</MonoChip>
                </div>
                <div className="mt-0.5 flex items-center gap-2 whitespace-nowrap text-[11px] text-muted-foreground">
                  <span className="shrink-0" style={{ color: f.retained ? "#0f8a7a" : undefined }}>
                    {f.expiresLabel}
                  </span>
                  <button
                    type="button"
                    onClick={() => onDownload(f.id)}
                    title="Download"
                    className="ml-auto flex items-center p-0.5"
                    style={{ color: LAYER.process }}
                  >
                    <Download className="h-3 w-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onKeep(f.id)}
                    title={f.retained ? "Kept — click to allow expiry" : "Keep — never auto-delete"}
                    className="flex items-center p-0.5"
                    style={{ color: f.retained ? "#0f8a7a" : "#b8b8b8" }}
                  >
                    <Pin className="h-3 w-3" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Project memory ──────────────────────────────────────────────────── */

export function ProjectMemoryPanel({
  entries,
  onAdd,
  onArchive,
}: {
  entries: MemoryEntry[];
  onAdd: (content: string) => void;
  onArchive: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");

  const commit = () => {
    const v = draft.trim();
    if (v) onAdd(v);
    setDraft("");
    setAdding(false);
  };

  return (
    <div
      className="shrink-0 border-t px-2 py-1.5"
      style={{ borderColor: "#ece5fb", background: "rgba(124,58,237,.05)" }}
    >
      <PanelHeader
        open={open}
        onToggle={() => setOpen((v) => !v)}
        label="Project memory"
        count={entries.length}
        color={LAYER.product}
        right={
          <button
            type="button"
            title="Add memory"
            onClick={() => setAdding((v) => !v)}
            className="ml-auto text-[14px] text-muted-foreground"
          >
            +
          </button>
        }
      />

      {open && (
        <div className="mt-1.5">
          {adding && (
            <div className="mb-1.5 flex gap-1">
              <input
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commit();
                  if (e.key === "Escape") {
                    setAdding(false);
                    setDraft("");
                  }
                }}
                placeholder="e.g. S3 is our strategic supplier"
                className="h-6 flex-1 rounded-sm border border-foreground px-1.5 text-[12px] outline-none"
              />
              <button
                type="button"
                onClick={commit}
                className="rounded-sm bg-foreground px-2 text-[11px] text-background"
              >
                Save
              </button>
            </div>
          )}

          {entries.length === 0 && (
            <div className="text-[11.5px] text-muted-foreground">
              Nothing saved yet — say “remember…” in a chat.
            </div>
          )}

          <div className="max-h-[110px] overflow-y-auto">
            {entries.map((m) => (
              <div
                key={m.id}
                className="mb-1.5 flex items-start gap-[7px] rounded-sm border bg-background px-2 py-1.5"
                style={{ borderColor: "#ece5fb", borderLeft: "2px solid " + LAYER.product }}
              >
                <MonoChip color={LAYER.product} className="mt-0.5 shrink-0">
                  {m.kindLabel}
                </MonoChip>
                <span className="flex-1 text-[12px] leading-[1.5] text-foreground">{m.content}</span>
                <button
                  type="button"
                  onClick={() => onArchive(m.id)}
                  title="Archive"
                  className="text-[12px] text-[#c4c4c4]"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── thread info / memory strip (M1 §14.3) ───────────────────────────── */

export function ThreadInfoStrip({
  summary,
  onDeleteSummary,
}: {
  summary: string | null;
  onDeleteSummary: () => void;
}) {
  const [openPane, setOpenPane] = useState<"summary" | "how" | null>(null);
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;

  const btn = (active: boolean) =>
    cn(
      "inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-[11px] font-medium leading-[1.4]",
      active ? "text-[#6d28d9]" : "text-muted-foreground",
    );

  return (
    <div className="border-b" style={{ borderColor: "#ece5fb", background: "rgba(124,58,237,.045)" }}>
      <div className="flex min-w-0 flex-wrap items-center gap-1.5 px-4 py-1">
        <span className="font-mono text-[9px] uppercase tracking-[0.16em]" style={{ color: LAYER.product }}>
          Memory
        </span>
        <span className="h-2.5 w-px" style={{ background: "#ddd0f7" }} />

        {summary && (
          <button
            type="button"
            onClick={() => setOpenPane((p) => (p === "summary" ? null : "summary"))}
            className={btn(openPane === "summary")}
            style={openPane === "summary" ? { background: "rgba(124,58,237,.1)" } : undefined}
          >
            <span
              className="inline-block text-[10px] transition-transform"
              style={{
                color: openPane === "summary" ? LAYER.product : "#c4c4c4",
                transform: openPane === "summary" ? "rotate(90deg)" : "rotate(0deg)",
              }}
            >
              ›
            </span>
            What the assistant remembers
          </button>
        )}

        <button
          type="button"
          onClick={() => setOpenPane((p) => (p === "how" ? null : "how"))}
          className={btn(openPane === "how")}
          style={openPane === "how" ? { background: "rgba(124,58,237,.1)" } : undefined}
        >
          <span
            className="inline-block text-[10px] transition-transform"
            style={{
              color: openPane === "how" ? LAYER.product : "#c4c4c4",
              transform: openPane === "how" ? "rotate(90deg)" : "rotate(0deg)",
            }}
          >
            ›
          </span>
          How memory works
        </button>

        <button
          type="button"
          onClick={() => setDismissed(true)}
          title="Hide this bar"
          className="ml-auto px-1 py-0.5 text-[11px] leading-none"
          style={{ color: "#bda8e8" }}
        >
          ✕
        </button>
      </div>

      {openPane === "summary" && summary && (
        <div className="max-w-[720px] px-4 pb-2.5">
          <p className="mb-1.5 text-[12.5px] leading-[1.6] text-muted-foreground">{summary}</p>
          <button
            type="button"
            onClick={onDeleteSummary}
            className="rounded-sm border border-[#ebebeb] bg-background px-2 py-0.5 text-[11px] text-muted-foreground"
          >
            Delete summary
          </button>
        </div>
      )}

      {openPane === "how" && (
        <div className="max-w-[720px] px-4 pb-3 text-[12.5px] leading-[1.6] text-muted-foreground">
          Two kinds of memory, both under your control:{" "}
          <strong className="text-foreground">this conversation</strong> keeps a rolling summary you can delete any
          time, and <strong className="text-foreground">project memory</strong> stores facts and decisions only when
          you say “remember…” or click Save — always visible below, always cited when used.
        </div>
      )}
    </div>
  );
}
