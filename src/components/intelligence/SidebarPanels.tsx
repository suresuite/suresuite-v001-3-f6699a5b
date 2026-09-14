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

/** Where a panel is rendered: the desktop sidebar disclosure, or a mobile
 * bottom sheet that already supplies its own title and scroll. */
export type PanelVariant = "panel" | "sheet";

/* ── My files ────────────────────────────────────────────────────────── */

export function MyFilesPanel({
  files,
  scope,
  onScopeChange,
  onDownload,
  onKeep,
  variant = "panel",
}: {
  files: UserFile[];
  scope: "project" | "all";
  onScopeChange: (s: "project" | "all") => void;
  onDownload: (id: string) => void;
  onKeep: (id: string) => void;
  /** "sheet" is the mobile bottom-sheet body: no disclosure (the sheet title
   * already names it), no inner scroll cap (the sheet scrolls), 44px actions.
   * The copy, the retention rule and the handlers are the panel's. */
  variant?: PanelVariant;
}) {
  const [open, setOpen] = useState(false);
  const expiring = files.filter((f) => !f.retained).length;
  const sheet = variant === "sheet";

  return (
    <div
      className={cn(sheet ? "px-3.5 py-3" : "shrink-0 border-t px-2 py-1.5")}
      style={sheet ? undefined : { borderColor: "#e2f4f6", background: "rgba(20,184,196,.05)" }}
    >
      {sheet ? (
        <Segmented
          className="[&>button]:min-h-11"
          value={scope}
          onChange={onScopeChange}
          options={[
            { value: "project", label: "This project" },
            { value: "all", label: "All" },
          ]}
        />
      ) : (
        <PanelHeader
          open={open}
          onToggle={() => setOpen((v) => !v)}
          label="My files"
          count={files.length}
          color="#0f8a94"
          right={
            <Segmented
              size="sm"
              className="ml-auto shrink-0"
              value={scope}
              onChange={onScopeChange}
              options={[
                { value: "project", label: "Project" },
                { value: "all", label: "All" },
              ]}
            />
          }
        />
      )}

      {(open || sheet) && (
        <div className={cn(sheet ? "mt-3" : "mt-1.5")}>
          {expiring > 0 && (
            <div
              className="mb-1.5 rounded-sm border bg-background px-2 py-1.5 text-[11px] leading-[1.45] text-[#7a5a12]"
              style={{ borderColor: "#f3e2ad", borderLeft: "2px solid " + LAYER.accent }}
            >
              {expiring === 1 ? "1 file expires" : expiring + " files expire"} this week — download or Keep.
            </div>
          )}

          {files.length === 0 && (
            <div className={cn("py-0.5 text-muted-foreground", sheet ? "text-[13px]" : "text-[11.5px]")}>
              Nothing here yet — approved reports land here.
            </div>
          )}

          <div className={cn(!sheet && "max-h-[110px] overflow-y-auto")}>
            {files.map((f) => (
              <div
                key={f.id}
                className="mb-1.5 rounded-sm border bg-background px-2 py-1.5"
                style={{ borderColor: "#e2f4f6", borderLeft: "2px solid " + LAYER.process }}
              >
                <div className="flex items-center gap-1.5">
                  <span
                    title={f.name}
                    className={cn(
                      "min-w-0 flex-1 truncate font-medium text-foreground",
                      sheet ? "text-[14px]" : "text-[12px]",
                    )}
                  >
                    {f.name}
                  </span>
                  <MonoChip>{f.kind}</MonoChip>
                </div>
                <div
                  className={cn(
                    "flex items-center gap-2 whitespace-nowrap text-muted-foreground",
                    sheet ? "text-[11.5px]" : "mt-0.5 text-[11px]",
                  )}
                >
                  <span className="shrink-0" style={{ color: f.retained ? "#0f8a7a" : undefined }}>
                    {f.expiresLabel}
                  </span>
                  <button
                    type="button"
                    onClick={() => onDownload(f.id)}
                    title="Download"
                    aria-label={"Download " + f.name}
                    className={cn(
                      "ml-auto flex items-center",
                      sheet ? "h-11 w-11 justify-center" : "p-0.5",
                    )}
                    style={{ color: LAYER.process }}
                  >
                    <Download className={sheet ? "h-4 w-4" : "h-3 w-3"} />
                  </button>
                  <button
                    type="button"
                    onClick={() => onKeep(f.id)}
                    title={f.retained ? "Kept — click to allow expiry" : "Keep — never auto-delete"}
                    aria-label={f.retained ? "Kept — click to allow expiry" : "Keep — never auto-delete"}
                    className={cn("flex items-center", sheet ? "h-11 w-11 justify-center" : "p-0.5")}
                    style={{ color: f.retained ? "#0f8a7a" : "#b8b8b8" }}
                  >
                    <Pin className={sheet ? "h-4 w-4" : "h-3 w-3"} />
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
  variant = "panel",
}: {
  entries: MemoryEntry[];
  onAdd: (content: string) => void;
  onArchive: (id: string) => void;
  /** See MyFilesPanel — "sheet" is the same content without the disclosure. */
  variant?: PanelVariant;
}) {
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const sheet = variant === "sheet";

  const commit = () => {
    const v = draft.trim();
    if (v) onAdd(v);
    setDraft("");
    setAdding(false);
  };

  return (
    <div
      className={cn(sheet ? "px-3.5 py-3" : "shrink-0 border-t px-2 py-1.5")}
      style={sheet ? undefined : { borderColor: "#ece5fb", background: "rgba(124,58,237,.05)" }}
    >
      {sheet ? (
        <>
          <p className="text-[12.5px] leading-[1.55] text-muted-foreground [text-wrap:pretty]">
            Adding an entry here is the consent — the model never writes memory on its own.
          </p>
          {!adding && (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="mt-2.5 flex min-h-11 w-full items-center justify-center gap-1.5 rounded-sm border border-[--hair-border] bg-background text-[13.5px] text-foreground"
            >
              Add a note
            </button>
          )}
        </>
      ) : (
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
              className="ml-auto shrink-0 text-[14px] text-muted-foreground"
            >
              +
            </button>
          }
        />
      )}

      {(open || sheet) && (
        <div className={cn(sheet ? "mt-2.5" : "mt-1.5")}>
          {adding && (
            <div className={cn("flex gap-1", sheet ? "mb-2.5" : "mb-1.5")}>
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
                className={cn(
                  "flex-1 rounded-sm border border-foreground px-1.5 outline-none",
                  sheet ? "min-h-11 text-[14px]" : "h-6 text-[12px]",
                )}
              />
              <button
                type="button"
                onClick={commit}
                className={cn(
                  "rounded-sm bg-foreground px-2 text-background",
                  sheet ? "min-h-11 px-4 text-[13.5px]" : "text-[11px]",
                )}
              >
                Save
              </button>
            </div>
          )}

          {entries.length === 0 && (
            <div className={cn("text-muted-foreground", sheet ? "text-[13px]" : "text-[11.5px]")}>
              Nothing saved yet — say “remember…” in a chat.
            </div>
          )}

          <div className={cn(!sheet && "max-h-[110px] overflow-y-auto")}>
            {entries.map((m) => (
              <div
                key={m.id}
                className="mb-1.5 flex items-start gap-[7px] rounded-sm border bg-background px-2 py-1.5"
                style={{ borderColor: "#ece5fb", borderLeft: "2px solid " + LAYER.product }}
              >
                <MonoChip color={LAYER.product} className="mt-0.5 shrink-0">
                  {m.kindLabel}
                </MonoChip>
                <span className={cn("flex-1 leading-[1.5] text-foreground", sheet ? "text-[13.5px]" : "text-[12px]")}>
                  {m.content}
                </span>
                <button
                  type="button"
                  onClick={() => onArchive(m.id)}
                  title="Archive"
                  aria-label="Archive this memory"
                  className={cn("text-[#c4c4c4]", sheet ? "grid h-11 w-11 place-items-center text-[15px]" : "text-[12px]")}
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

/* ── memory panel (M1 §14.3, v1b space pass) ─────────────────────────── */

/**
 * What the assistant remembers, and how memory works.
 *
 * This was a full-width violet band pinned under the agent strip — a second
 * chrome row that was almost always collapsed, costing every conversation
 * ~26px to say the word "Memory". The v1b pass demotes the band to a chip in
 * the merged chrome band (ChatWorkspace) and keeps everything the band hosted
 * here, opened on demand: the rolling summary with its delete control, and the
 * "How memory works" disclosure. Nothing about the copy or the controls moved
 * — only what it costs when the user is not reading it.
 *
 * Controlled by the caller: the chip owns `open`, so the chip can render as
 * active while the panel is showing.
 */
export function MemoryPanel({
  summary,
  onDeleteSummary,
}: {
  summary: string | null;
  onDeleteSummary: () => void;
}) {
  const [openPane, setOpenPane] = useState<"summary" | "how" | null>(summary ? "summary" : "how");

  const btn = (active: boolean) =>
    cn(
      "inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-[11px] font-medium leading-[1.4]",
      active ? "text-[#6d28d9]" : "text-muted-foreground",
    );

  const caret = (active: boolean) => (
    <span
      className="inline-block text-[10px] transition-transform"
      style={{
        color: active ? LAYER.product : "#c4c4c4",
        transform: active ? "rotate(90deg)" : "rotate(0deg)",
      }}
    >
      ›
    </span>
  );

  return (
    <div className="shrink-0 border-b" style={{ borderColor: "#ece5fb", background: "rgba(124,58,237,.045)" }}>
      <div className="flex min-w-0 flex-wrap items-center gap-1.5 px-3.5 py-1">
        {summary && (
          <button
            type="button"
            onClick={() => setOpenPane((pane) => (pane === "summary" ? null : "summary"))}
            className={btn(openPane === "summary")}
            style={openPane === "summary" ? { background: "rgba(124,58,237,.1)" } : undefined}
          >
            {caret(openPane === "summary")}
            What the assistant remembers
          </button>
        )}

        <button
          type="button"
          onClick={() => setOpenPane((pane) => (pane === "how" ? null : "how"))}
          className={btn(openPane === "how")}
          style={openPane === "how" ? { background: "rgba(124,58,237,.1)" } : undefined}
        >
          {caret(openPane === "how")}
          How memory works
        </button>
      </div>

      {openPane === "summary" && summary && (
        <div className="max-w-[720px] px-3.5 pb-2.5">
          <p className="mb-1.5 text-[12.5px] leading-[1.6] text-muted-foreground">{summary}</p>
          <button
            type="button"
            onClick={onDeleteSummary}
            className="rounded-sm border border-[--hair-border] bg-background px-2 py-0.5 text-[11px] text-muted-foreground"
          >
            Delete summary
          </button>
        </div>
      )}

      {openPane === "how" && (
        <div className="max-w-[720px] px-3.5 pb-2.5 text-[12.5px] leading-[1.6] text-muted-foreground">
          Two kinds of memory, both under your control:{" "}
          <strong className="text-foreground">this conversation</strong> keeps a rolling summary you can delete any
          time, and <strong className="text-foreground">project memory</strong> stores facts and decisions only when
          you say “remember…” or click Save — always visible below, always cited when used.
        </div>
      )}
    </div>
  );
}
