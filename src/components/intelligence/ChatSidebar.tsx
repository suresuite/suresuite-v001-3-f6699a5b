/**
 * ChatSidebar — thread list with search, grouping, per-row actions, bulk
 * select, folders, and the two layer-tinted bottom panels.
 *
 * Layout contract (this is what broke twice in review): the aside is a fixed
 * -height flex column. The thread list is the ONLY flexible child
 * (flex-1 min-h-[200px] overflow-y-auto); the header and both bottom panels
 * are shrink-0. Give the panels unbounded height and they starve the list.
 *
 * Collapsed, the whole thing becomes a 48px rail — the page owns the grid
 * track change (48px 1fr), this component only renders the rail.
 */
import React, { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import type { ChatFolder, Thread } from "@/hooks/useChatThreads";
import { QUICK_THREAD_ID } from "@/hooks/useChatThreads";
import { KX_TIGHT, LAYER } from "./piUi";
import { MyFilesPanel, ProjectMemoryPanel, type MemoryEntry, type UserFile } from "./SidebarPanels";
import { cn } from "@/lib/utils";

interface ChatSidebarProps {
  collapsed: boolean;
  onCollapse: () => void;
  onExpand: () => void;
  /** False inside the mobile Chats sheet: the sheet has its own close control
   * and there is no rail to collapse into, so the chevron would be a dead end. */
  collapsible?: boolean;
  projects: Array<{ id: string; name: string }>;
  threads: Thread[];
  activeThreadId: string | null;
  onSelectThread: (id: string) => void;
  onNewThread: () => void;
  onDeleteThread: (id: string) => void;
  onRenameThread: (id: string, title: string) => void;
  onAttachProject: (id: string, projectId: string | null) => void;
  syncEnabled: boolean;
  folders: ChatFolder[];
  onCreateFolder: (name: string) => void;
  onDeleteFolder: (id: string) => void;
  onMoveToFolder: (threadId: string, folderId: string | null) => void;
  onTogglePin: (threadId: string, pinned: boolean) => void;
  onToggleArchive: (threadId: string, archived: boolean) => void;
  onSearchMessages: (q: string, projectId?: string | null) => Promise<any[]>;
  memoryEnabled: boolean;
  memoryProjectId: string | null;
  filesEnabled: boolean;
  onBulkSetFlags: (ids: string[], flags: { pinned?: boolean | null; archived?: boolean | null }) => void;
  onBulkMoveToFolder: (ids: string[], folderId: string | null) => void;
  onBulkDelete: (ids: string[]) => void;
  /** Wire to useUserFiles / useProjectMemory in the app; empty is a valid state. */
  files?: UserFile[];
  memoryEntries?: MemoryEntry[];
  onDownloadFile?: (id: string) => void;
  onKeepFile?: (id: string) => void;
  onAddMemory?: (content: string) => void;
  onArchiveMemory?: (id: string) => void;
}

export function ChatSidebar(props: ChatSidebarProps) {
  const {
    collapsed,
    onCollapse,
    onExpand,
    collapsible = true,
    projects,
    threads,
    activeThreadId,
    onSelectThread,
    onNewThread,
    onDeleteThread,
    onRenameThread,
    onAttachProject,
    folders,
    onCreateFolder,
    onMoveToFolder,
    onTogglePin,
    onToggleArchive,
    memoryEnabled,
    memoryProjectId,
    filesEnabled,
    onBulkSetFlags,
    onBulkDelete,
    files = [],
    memoryEntries = [],
    onDownloadFile = () => {},
    onKeepFile = () => {},
    onAddMemory = () => {},
    onArchiveMemory = () => {},
  } = props;

  const [query, setQuery] = useState("");
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [closed, setClosed] = useState<Record<string, boolean>>({ archive: true });
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [folderDraft, setFolderDraft] = useState("");
  const [filesScope, setFilesScope] = useState<"project" | "all">("project");

  const toggleSection = (key: string) => setClosed((c) => ({ ...c, [key]: !c[key] }));

  const q = query.trim().toLowerCase();
  const matches = (t: Thread) => !q || t.title.toLowerCase().includes(q);

  // The Quick chat pseudo-thread backs the floating bubble only — it is never
  // listed here.
  const notQuick = (t: Thread) => t.id !== QUICK_THREAD_ID;

  const { pinned, projectGroups, folderList, recent, archived } = useMemo(() => {
    const live = threads.filter((t) => !t.archived && notQuick(t) && matches(t));
    const pinnedList = live.filter((t) => t.pinned);
    const byProject: Record<string, Thread[]> = {};
    live.forEach((t) => {
      if (t.projectId) (byProject[t.projectId] ??= []).push(t);
    });
    const groups = projects
      .map((p) => ({ id: p.id, label: p.name, rows: byProject[p.id] ?? [] }))
      .filter((g) => g.rows.length > 0);
    const grouped = new Set<string>([
      ...pinnedList.map((t) => t.id),
      ...Object.values(byProject).flat().map((t) => t.id),
    ]);
    const fList = folders.map((f) => {
      const rows = live.filter((t) => t.folderId === f.id);
      rows.forEach((r) => grouped.add(r.id));
      return { id: f.id, name: f.name, rows };
    });
    return {
      pinned: pinnedList,
      projectGroups: groups,
      folderList: fList,
      recent: live.filter((t) => !grouped.has(t.id)),
      archived: threads.filter((t) => t.archived && notQuick(t) && matches(t)),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threads, projects, folders, q]);

  const scopedFiles =
    filesScope === "project" && memoryProjectId
      ? files.filter((f) => f.projectId === memoryProjectId)
      : files;
  const commitRename = () => {
    if (renamingId && renameValue.trim()) onRenameThread(renamingId, renameValue.trim());
    setRenamingId(null);
    setRenameValue("");
  };

  /* ── collapsed rail ─────────────────────────────────────────────────── */
  if (collapsed) {
    return (
      <aside className="flex flex-col items-center gap-2 overflow-hidden border-r border-[--hair-border] bg-[#fcfcfc] py-2.5">
        <button
          type="button"
          onClick={onExpand}
          title="Show chats"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-sm border border-[--zinc-border] bg-background text-muted-foreground"
        >
          <ChevronRight className="h-3 w-3" />
        </button>
        <button
          type="button"
          onClick={onNewThread}
          title="New chat"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-sm bg-foreground text-background"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={onExpand}
          className={cn(KX_TIGHT, "mt-1 py-1.5")}
          style={{ writingMode: "vertical-rl", letterSpacing: "0.2em" }}
        >
          Chats <span className="text-[#b8b8b8]">{threads.filter((t) => !t.archived && notQuick(t)).length}</span>
        </button>
      </aside>
    );
  }

  /* ── row ────────────────────────────────────────────────────────────── */
  const Row = ({ thread }: { thread: Thread }) => {
    const active = thread.id === activeThreadId;
    return (
      <div
        className={cn("relative mb-px flex items-center gap-1 rounded-sm px-0.5 py-px", active && "bg-background shadow-[0_0_0_1px_var(--zinc-border)]")}
      >
        {selectMode && (
          <input
            type="checkbox"
            checked={selected.includes(thread.id)}
            onChange={() =>
              setSelected((s) => (s.includes(thread.id) ? s.filter((x) => x !== thread.id) : [...s, thread.id]))
            }
            // §2.4: the padding grows the hit area to 44px and the negative
            // margin returns the space, so the row does not move.
            className="-m-[16px] box-content h-3 w-3 shrink-0 p-[16px] md:m-0 md:ml-1 md:box-border md:p-0"
          />
        )}

        {renamingId === thread.id ? (
          <input
            autoFocus
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitRename();
              if (e.key === "Escape") {
                setRenamingId(null);
                setRenameValue("");
              }
            }}
            className="h-[22px] flex-1 rounded-sm border border-foreground px-1.5 text-[12.5px] outline-none"
          />
        ) : (
          <>
            <button
              type="button"
              onClick={() => onSelectThread(thread.id)}
              className={cn(
                "flex min-h-11 min-w-0 flex-1 items-center gap-1.5 px-1.5 py-[5px] text-left text-[12.5px] md:min-h-0",
                active ? "font-semibold text-foreground" : "text-[#5a5a5a]",
              )}
            >
              {thread.pinned && (
                <span className="h-[5px] w-[5px] shrink-0 rounded-full" style={{ background: LAYER.firm }} />
              )}
              <span className="min-w-0 flex-1 truncate">{thread.title}</span>
            </button>
            <button
              type="button"
              onClick={() => setOpenMenu((m) => (m === thread.id ? null : thread.id))}
              aria-label={"Options for " + thread.title}
              className="inline-flex min-h-11 min-w-11 items-center justify-center px-1.5 py-0.5 text-[13px] text-[#b8b8b8] md:inline-block md:min-h-0 md:min-w-0"
            >
              ⋯
            </button>
          </>
        )}

        {openMenu === thread.id && (
          <>
            <div className="fixed inset-0 z-[60]" onClick={() => setOpenMenu(null)} />
            <div className="absolute right-0.5 top-[26px] z-[61] min-w-[176px] rounded-sm border border-[--hair-border] bg-background p-1.5 shadow-[0_4px_14px_rgba(0,0,0,.10)]">
              <button
                type="button"
                onClick={() => {
                  setRenamingId(thread.id);
                  setRenameValue(thread.title);
                  setOpenMenu(null);
                }}
                className="flex min-h-11 w-full items-center rounded-sm px-2 py-1.5 text-left text-[12.5px] hover:bg-[#fcfcfc] md:block md:min-h-0"
              >
                Rename
              </button>
              <button
                type="button"
                onClick={() => {
                  onTogglePin(thread.id, !thread.pinned);
                  setOpenMenu(null);
                }}
                className="flex min-h-11 w-full items-center rounded-sm px-2 py-1.5 text-left text-[12.5px] hover:bg-[#fcfcfc] md:block md:min-h-0"
              >
                {thread.pinned ? "Unpin" : "Pin"}
              </button>

              <div className="px-2 pb-1 pt-1.5">
                <div className="mb-1 font-mono text-[9px] uppercase tracking-[0.12em] text-[#b0b0b0]">Project</div>
                <select
                  value={thread.projectId ?? ""}
                  onChange={(e) => onAttachProject(thread.id, e.target.value || null)}
                  className="h-[26px] min-h-11 w-full rounded-sm border border-[--hair-border] bg-background px-1.5 text-[11.5px] outline-none md:min-h-0"
                >
                  <option value="">No project</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>

              {folders.length > 0 && (
                <div className="px-2 pb-1">
                  <div className="mb-1 font-mono text-[9px] uppercase tracking-[0.12em] text-[#b0b0b0]">Folder</div>
                  <select
                    value={thread.folderId ?? ""}
                    onChange={(e) => onMoveToFolder(thread.id, e.target.value || null)}
                    className="h-[26px] min-h-11 w-full rounded-sm border border-[--hair-border] bg-background px-1.5 text-[11.5px] outline-none md:min-h-0"
                  >
                    <option value="">No folder</option>
                    {folders.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="my-0.5 h-px bg-[--hair-divider]" />
              <button
                type="button"
                onClick={() => {
                  onToggleArchive(thread.id, !thread.archived);
                  setOpenMenu(null);
                }}
                className="flex min-h-11 w-full items-center rounded-sm px-2 py-1.5 text-left text-[12.5px] hover:bg-[#fcfcfc] md:block md:min-h-0"
              >
                {thread.archived ? "Unarchive" : "Archive"}
              </button>
              <button
                type="button"
                onClick={() => {
                  onDeleteThread(thread.id);
                  setOpenMenu(null);
                }}
                className="flex min-h-11 w-full items-center rounded-sm px-2 py-1.5 text-left text-[12.5px] hover:bg-[#fcfcfc] md:block md:min-h-0"
                style={{ color: LAYER.brand }}
              >
                Delete
              </button>
            </div>
          </>
        )}
      </div>
    );
  };

  const SectionHead = ({
    label,
    count,
    sectionKey,
    right,
  }: {
    label: string;
    count: number;
    sectionKey: string;
    right?: React.ReactNode;
  }) => (
    <div className="flex items-center justify-between">
      <button
        type="button"
        onClick={() => toggleSection(sectionKey)}
        className={cn(KX_TIGHT, "flex min-h-11 w-full items-center gap-1 px-1.5 py-1 md:min-h-0")}
      >
        <span
          className="inline-block transition-transform"
          style={{ transform: closed[sectionKey] ? "rotate(0deg)" : "rotate(90deg)" }}
        >
          ›
        </span>
        {label}
        <span className="ml-1 rounded-sm bg-[#f0f0f0] px-[5px] font-sans text-[10px] normal-case tracking-normal">
          {count}
        </span>
      </button>
      {right}
    </div>
  );

  /* ── expanded sidebar ───────────────────────────────────────────────── */
  return (
    <aside className="flex max-h-full min-h-0 flex-col overflow-hidden border-r border-[--hair-border] bg-[#fcfcfc]">
      {/* header — shrink-0 */}
      <div className="flex shrink-0 flex-col gap-2 border-b border-[--hair-divider] py-2.5 pl-2.5 pr-3">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={onNewThread}
            className="flex h-8 min-h-11 flex-1 items-center justify-center gap-1.5 md:min-h-0 rounded-sm bg-foreground text-[12.5px] font-medium text-background"
          >
            <Plus className="h-3.5 w-3.5" /> New chat
          </button>
          {collapsible && (
            <button
              type="button"
              onClick={onCollapse}
              title="Hide chat list"
              aria-label="Hide chat list"
              className="flex h-8 w-8 min-h-11 min-w-11 shrink-0 items-center justify-center md:min-h-0 md:min-w-0 rounded-sm border border-[--zinc-border] bg-background text-muted-foreground"
            >
              <ChevronLeft className="h-3 w-3" />
            </button>
          )}
        </div>

        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search chats"
          className="h-[30px] min-h-11 rounded-sm border border-[--hair-border] bg-background px-2.5 text-[12.5px] outline-none md:min-h-0"
        />

        <div className="flex items-center justify-between gap-1">
          <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">
            {selectMode ? selected.length + " selected" : ""}
          </span>
          <button
            type="button"
            onClick={() => {
              setSelectMode((v) => !v);
              setSelected([]);
              setConfirmDelete(false);
            }}
            className="min-h-11 shrink-0 px-2 py-0.5 text-[11.5px] text-muted-foreground md:min-h-0 md:px-1"
          >
            {selectMode ? "Cancel" : "Select"}
          </button>
        </div>
      </div>

      {/* thread list — the only flexible child */}
      <div className="min-h-[200px] flex-1 overflow-y-auto overflow-x-hidden p-1.5">
        {pinned.length > 0 && (
          <div className="mb-2.5">
            <SectionHead label="Pinned" count={pinned.length} sectionKey="pinned" />
            {!closed.pinned && pinned.map((t) => <Row key={t.id} thread={t} />)}
          </div>
        )}

        {projectGroups.map((g) => (
          <div key={g.id} className="mb-2.5">
            <SectionHead label={g.label} count={g.rows.length} sectionKey={"proj:" + g.id} />
            {!closed["proj:" + g.id] && g.rows.map((t) => <Row key={t.id} thread={t} />)}
          </div>
        ))}

        <div className="mb-2.5">
          <SectionHead
            label="My folders"
            count={folderList.reduce((n, f) => n + f.rows.length, 0)}
            sectionKey="folders"
            right={
              <button
                type="button"
                onClick={() => setCreatingFolder(true)}
                title="New folder"
                aria-label="New folder"
                className="inline-flex min-h-11 min-w-11 items-center justify-center px-1.5 py-0.5 text-[13px] text-muted-foreground md:inline-block md:min-h-0 md:min-w-0"
              >
                +
              </button>
            }
          />
          {!closed.folders && (
            <>
              {creatingFolder && (
                <input
                  autoFocus
                  value={folderDraft}
                  onChange={(e) => setFolderDraft(e.target.value)}
                  onBlur={() => {
                    if (folderDraft.trim()) onCreateFolder(folderDraft.trim());
                    setCreatingFolder(false);
                    setFolderDraft("");
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                    if (e.key === "Escape") {
                      setCreatingFolder(false);
                      setFolderDraft("");
                    }
                  }}
                  placeholder="Folder name"
                  className="mx-1.5 my-1 h-6 rounded-sm border border-foreground px-1.5 text-[12px] outline-none"
                />
              )}
              {folderList.map((f) => (
                <div key={f.id} className="ml-1.5 mb-0.5 mt-1">
                  <div className="flex items-center gap-1.5 py-0.5 text-[11.5px] font-medium text-muted-foreground">
                    ▸ {f.name}
                  </div>
                  {f.rows.map((t) => (
                    <Row key={t.id} thread={t} />
                  ))}
                </div>
              ))}
            </>
          )}
        </div>

        <div className="mb-2.5">
          <SectionHead label="Recent" count={recent.length} sectionKey="recent" />
          {!closed.recent && recent.map((t) => <Row key={t.id} thread={t} />)}
        </div>

        <div className="mb-1">
          <SectionHead label="Archive" count={archived.length} sectionKey="archive" />
          {!closed.archive && archived.map((t) => <Row key={t.id} thread={t} />)}
        </div>
      </div>

      {/* bulk bar — shrink-0 */}
      {selectMode && selected.length > 0 && (
        <div className="flex shrink-0 flex-wrap gap-1.5 border-t border-[--hair-border] bg-background p-2">
          <button
            type="button"
            onClick={() => {
              onBulkSetFlags(selected, { pinned: true });
              setSelectMode(false);
              setSelected([]);
            }}
            className="rounded-sm border border-[--hair-border] bg-background px-2.5 py-1 text-[11.5px] text-foreground"
          >
            Pin
          </button>
          <button
            type="button"
            onClick={() => {
              onBulkSetFlags(selected, { archived: true });
              setSelectMode(false);
              setSelected([]);
            }}
            className="rounded-sm border border-[--hair-border] bg-background px-2.5 py-1 text-[11.5px] text-foreground"
          >
            Archive
          </button>
          {confirmDelete ? (
            <>
              <button
                type="button"
                onClick={() => {
                  onBulkDelete(selected);
                  setSelectMode(false);
                  setSelected([]);
                  setConfirmDelete(false);
                }}
                className="rounded-sm px-2.5 py-1 text-[11.5px] text-background"
                style={{ background: LAYER.brand }}
              >
                Confirm delete ({selected.length})
              </button>
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                className="rounded-sm border border-[--hair-border] bg-background px-2.5 py-1 text-[11.5px] text-foreground"
              >
                Cancel
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className="ml-auto rounded-sm border border-[#f0c7cb] bg-background px-2.5 py-1 text-[11.5px]"
              style={{ color: LAYER.brand }}
            >
              Delete
            </button>
          )}
        </div>
      )}

      {/* bottom panels — shrink-0, collapsed by default */}
      {filesEnabled && memoryProjectId && (
        <MyFilesPanel
          files={scopedFiles}
          scope={filesScope}
          onScopeChange={setFilesScope}
          onDownload={onDownloadFile}
          onKeep={onKeepFile}
        />
      )}
      {memoryEnabled && memoryProjectId && (
        <ProjectMemoryPanel entries={memoryEntries} onAdd={onAddMemory} onArchive={onArchiveMemory} />
      )}
    </aside>
  );
}
