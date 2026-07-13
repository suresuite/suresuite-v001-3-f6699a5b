import {
  Plus,
  Search,
  MoreHorizontal,
  MessagesSquare,
  Pencil,
  Pin,
  PinOff,
  Folder,
  FolderPlus,
  FolderX,
  Archive,
  ArchiveRestore,
  Trash2,
  Check,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { ProjectMemoryPanel } from "@/components/intelligence/ProjectMemoryPanel";
import {
  QUICK_THREAD_ID,
  type ChatFolder,
  type ChatSearchHit,
  type Thread,
} from "@/hooks/useChatThreads";
import { useEffect, useMemo, useRef, useState } from "react";

interface Project { id: string; name: string; plant_name?: string | null }

interface ChatSidebarProps {
  projects: Project[];
  threads: Thread[];
  activeThreadId: string | null;
  onSelectThread: (id: string) => void;
  onNewThread: () => void;
  onDeleteThread: (id: string) => void;
  onRenameThread: (id: string, title: string) => void;
  onAttachProject: (id: string, projectId: string | null) => void;
  /** Workstream M0 (ai-agents.md §14.2): server-store organizing surface.
   * All optional — omitted (or syncEnabled=false) renders the pre-M0 sidebar
   * exactly. */
  syncEnabled?: boolean;
  folders?: ChatFolder[];
  onCreateFolder?: (name: string) => void;
  onDeleteFolder?: (id: string) => void;
  onMoveToFolder?: (threadId: string, folderId: string | null) => void;
  onTogglePin?: (threadId: string, pinned: boolean) => void;
  onToggleArchive?: (threadId: string, archived: boolean) => void;
  onSearchMessages?: (query: string) => Promise<ChatSearchHit[]>;
  /** Workstream M2 (ai-agents.md §14.4): the "Project memory" panel — shown
   * only when the project_memory capability is on and a project is attached
   * to the active thread. Omitted ⇒ pre-M2 sidebar exactly. */
  memoryEnabled?: boolean;
  memoryProjectId?: string | null;
}

function groupThreadsLegacy(threads: Thread[]) {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfYesterday = startOfToday - 24 * 60 * 60 * 1000;
  const sevenDaysAgo = startOfToday - 7 * 24 * 60 * 60 * 1000;
  const groups: { label: string; items: Thread[] }[] = [
    { label: "Pinned", items: [] },
    { label: "Today", items: [] },
    { label: "Yesterday", items: [] },
    { label: "Previous 7 days", items: [] },
    { label: "Older", items: [] },
  ];
  for (const t of threads) {
    if (t.id === QUICK_THREAD_ID) groups[0].items.push(t);
    else if (t.updatedAt >= startOfToday) groups[1].items.push(t);
    else if (t.updatedAt >= startOfYesterday) groups[2].items.push(t);
    else if (t.updatedAt >= sevenDaysAgo) groups[3].items.push(t);
    else groups[4].items.push(t);
  }
  return groups.filter((g) => g.items.length > 0);
}

/** §14.2 organizing rules — the exact section order the sidebar renders when
 * the server store is on: Quick chat · Pinned · by-project (automatic) ·
 * user folders · Archive. A thread shows under its folder AND its project
 * group (views over the same row). */
function groupThreadsOrganized(threads: Thread[], folders: ChatFolder[], projects: Project[]) {
  const byRecency = (a: Thread, b: Thread) => b.updatedAt - a.updatedAt;
  const quick = threads.find((t) => t.id === QUICK_THREAD_ID) ?? null;
  const rest = threads.filter((t) => t.id !== QUICK_THREAD_ID);
  const live = rest.filter((t) => !t.archived);

  const pinned = live.filter((t) => t.pinned).sort(byRecency);

  const projectName = new Map(projects.map((p) => [p.id, p.name]));
  const byProject = new Map<string, Thread[]>();
  for (const t of live) {
    if (!t.projectId) continue;
    if (!byProject.has(t.projectId)) byProject.set(t.projectId, []);
    byProject.get(t.projectId)!.push(t);
  }
  const projectGroups = [...byProject.entries()]
    .map(([projectId, items]) => ({
      projectId,
      label: projectName.get(projectId) ?? "Unknown project",
      items: items.sort(byRecency),
    }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const folderGroups = [...folders]
    .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name))
    .map((f) => ({
      folder: f,
      items: live.filter((t) => t.folderId === f.id).sort(byRecency),
    }));

  const grouped = new Set<string>([
    ...pinned.map((t) => t.id),
    ...projectGroups.flatMap((g) => g.items.map((t) => t.id)),
    ...folderGroups.flatMap((g) => g.items.map((t) => t.id)),
  ]);
  const recent = live.filter((t) => !grouped.has(t.id)).sort(byRecency);

  const archived = rest.filter((t) => t.archived).sort(byRecency);

  return { quick, pinned, projectGroups, folderGroups, recent, archived };
}

export function ChatSidebar({
  projects,
  threads,
  activeThreadId,
  onSelectThread,
  onNewThread,
  onDeleteThread,
  onRenameThread,
  onAttachProject,
  syncEnabled = false,
  folders = [],
  onCreateFolder,
  onDeleteFolder,
  onMoveToFolder,
  onTogglePin,
  onToggleArchive,
  onSearchMessages,
  memoryEnabled = false,
  memoryProjectId = null,
}: ChatSidebarProps) {
  const [query, setQuery] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [folderName, setFolderName] = useState("");
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [searchHits, setSearchHits] = useState<ChatSearchHit[] | null>(null);
  const [searching, setSearching] = useState(false);
  const searchSeq = useRef(0);

  // Global FTS search (sync on): debounce the query against the server store.
  useEffect(() => {
    if (!syncEnabled || !onSearchMessages) return;
    const q = query.trim();
    if (!q) {
      setSearchHits(null);
      setSearching(false);
      return;
    }
    const seq = ++searchSeq.current;
    setSearching(true);
    const timer = setTimeout(async () => {
      const hits = await onSearchMessages(q);
      if (searchSeq.current === seq) {
        setSearchHits(hits);
        setSearching(false);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [query, syncEnabled, onSearchMessages]);

  const filtered = useMemo(() => {
    if (!query.trim()) return threads;
    const q = query.toLowerCase();
    return threads.filter((t) => t.title.toLowerCase().includes(q));
  }, [threads, query]);
  const legacyGroups = useMemo(() => groupThreadsLegacy(filtered), [filtered]);
  const organized = useMemo(
    () => groupThreadsOrganized(threads, folders, projects),
    [threads, folders, projects],
  );

  const startRename = (t: Thread) => {
    setRenamingId(t.id);
    setRenameValue(t.title);
  };
  const commitRename = () => {
    if (renamingId && renameValue.trim()) onRenameThread(renamingId, renameValue.trim());
    setRenamingId(null);
    setRenameValue("");
  };
  const commitFolder = () => {
    const name = folderName.trim();
    if (name && onCreateFolder) onCreateFolder(name);
    setCreatingFolder(false);
    setFolderName("");
  };

  const renderThreadRow = (t: Thread) => {
    const active = t.id === activeThreadId;
    const isQuick = t.id === QUICK_THREAD_ID;
    return (
      <li
        key={t.id}
        className={cn(
          "group relative flex items-center rounded-md pr-0.5 transition-colors",
          active ? "bg-background shadow-xs" : "hover:bg-background/60",
        )}
      >
        {renamingId === t.id ? (
          <Input
            autoFocus
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitRename();
              if (e.key === "Escape") { setRenamingId(null); setRenameValue(""); }
            }}
            className="h-7 flex-1 text-[13px]"
          />
        ) : (
          <button
            type="button"
            onClick={() => onSelectThread(t.id)}
            className={cn(
              "flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] leading-tight",
              active ? "text-foreground font-medium" : "text-foreground/75",
            )}
          >
            {isQuick && (
              <MessagesSquare className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            )}
            {syncEnabled && t.pinned && !isQuick && (
              <Pin className="h-3 w-3 shrink-0 text-muted-foreground" />
            )}
            <span className="truncate">{t.title}</span>
          </button>
        )}
        {renamingId !== t.id && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                onClick={(e) => e.stopPropagation()}
                className="hidden h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 transition hover:bg-muted hover:text-foreground group-hover:flex group-hover:opacity-100 data-[state=open]:flex data-[state=open]:opacity-100"
                aria-label="More"
              >
                <MoreHorizontal className="h-3.5 w-3.5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="z-[130] w-52">
              {!isQuick && (
                <DropdownMenuItem onClick={() => startRename(t)}>
                  <Pencil className="mr-2 h-3.5 w-3.5" /> Rename
                </DropdownMenuItem>
              )}
              {syncEnabled && !isQuick && onTogglePin && (
                <DropdownMenuItem onClick={() => onTogglePin(t.id, !t.pinned)}>
                  {t.pinned
                    ? (<><PinOff className="mr-2 h-3.5 w-3.5" /> Unpin</>)
                    : (<><Pin className="mr-2 h-3.5 w-3.5" /> Pin</>)}
                </DropdownMenuItem>
              )}
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <Folder className="mr-2 h-3.5 w-3.5" />
                  {t.projectId ? "Change project" : "Attach to project"}
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="z-[131] max-h-64 overflow-y-auto">
                  {projects.length === 0 ? (
                    <DropdownMenuItem disabled>No projects</DropdownMenuItem>
                  ) : (
                    projects.map((p) => (
                      <DropdownMenuItem
                        key={p.id}
                        onClick={() => onAttachProject(t.id, p.id)}
                      >
                        {p.id === t.projectId && <Check className="mr-2 h-3.5 w-3.5" />}
                        <span className={p.id !== t.projectId ? "ml-5" : ""}>{p.name}</span>
                      </DropdownMenuItem>
                    ))
                  )}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              {t.projectId && (
                <DropdownMenuItem onClick={() => onAttachProject(t.id, null)}>
                  <FolderX className="mr-2 h-3.5 w-3.5" /> Remove from project
                </DropdownMenuItem>
              )}
              {syncEnabled && !isQuick && onMoveToFolder && (
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    <FolderPlus className="mr-2 h-3.5 w-3.5" />
                    Move to folder
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent className="z-[131] max-h-64 overflow-y-auto">
                    {folders.length === 0 ? (
                      <DropdownMenuItem disabled>No folders yet</DropdownMenuItem>
                    ) : (
                      folders.map((f) => (
                        <DropdownMenuItem key={f.id} onClick={() => onMoveToFolder(t.id, f.id)}>
                          {f.id === t.folderId && <Check className="mr-2 h-3.5 w-3.5" />}
                          <span className={f.id !== t.folderId ? "ml-5" : ""}>{f.name}</span>
                        </DropdownMenuItem>
                      ))
                    )}
                    {t.folderId && (
                      <DropdownMenuItem onClick={() => onMoveToFolder(t.id, null)}>
                        <FolderX className="mr-2 h-3.5 w-3.5" /> Remove from folder
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              )}
              {syncEnabled && !isQuick && onToggleArchive && (
                <DropdownMenuItem onClick={() => onToggleArchive(t.id, !t.archived)}>
                  {t.archived
                    ? (<><ArchiveRestore className="mr-2 h-3.5 w-3.5" /> Unarchive</>)
                    : (<><Archive className="mr-2 h-3.5 w-3.5" /> Archive</>)}
                </DropdownMenuItem>
              )}
              {!isQuick && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() => onDeleteThread(t.id)}
                    className="text-destructive focus:text-destructive"
                  >
                    <Trash2 className="mr-2 h-3.5 w-3.5" /> Delete
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </li>
    );
  };

  const sectionHeader = (label: string, action?: React.ReactNode) => (
    <div className="flex items-center justify-between px-2 pb-1 pt-1">
      <span className="text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground/70">
        {label}
      </span>
      {action}
    </div>
  );

  const stripTags = (s: string) => s.replace(/<[^>]+>/g, "");

  const renderSearchResults = () => (
    <div className="px-1.5 pb-3">
      {sectionHeader(searching ? "Searching…" : `Results (${searchHits?.length ?? 0})`)}
      {searching && (
        <div className="flex items-center gap-2 px-2 py-2 text-[12px] text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Searching your chats
        </div>
      )}
      {!searching && (searchHits?.length ?? 0) === 0 && (
        <p className="px-2 py-4 text-center text-[12px] text-muted-foreground">No matches.</p>
      )}
      <ul className="space-y-px">
        {(searchHits ?? []).map((h) => (
          <li key={h.messageId}>
            <button
              type="button"
              onClick={() => { onSelectThread(h.threadId); setQuery(""); }}
              className="w-full rounded-md px-2 py-1.5 text-left hover:bg-background/60"
            >
              <div className="truncate text-[12.5px] font-medium">{h.threadTitle || "Untitled chat"}</div>
              <div className="truncate text-[11.5px] text-muted-foreground">{stripTags(h.snippet)}</div>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );

  const renderOrganized = () => {
    const { quick, pinned, projectGroups, folderGroups, recent, archived } = organized;
    return (
      <div className="px-1.5 pb-3">
        {quick && <ul className="mb-2 space-y-px">{renderThreadRow(quick)}</ul>}

        {pinned.length > 0 && (
          <div className="mb-3">
            {sectionHeader("Pinned")}
            <ul className="space-y-px">{pinned.map(renderThreadRow)}</ul>
          </div>
        )}

        {projectGroups.map((g) => (
          <div key={g.projectId} className="mb-3">
            {sectionHeader(g.label)}
            <ul className="space-y-px">{g.items.map(renderThreadRow)}</ul>
          </div>
        ))}

        <div className="mb-3">
          {sectionHeader(
            "My folders",
            onCreateFolder && (
              <button
                type="button"
                aria-label="New folder"
                onClick={() => setCreatingFolder(true)}
                className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <FolderPlus className="h-3.5 w-3.5" />
              </button>
            ),
          )}
          {creatingFolder && (
            <Input
              autoFocus
              value={folderName}
              placeholder="Folder name"
              onChange={(e) => setFolderName(e.target.value)}
              onBlur={commitFolder}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitFolder();
                if (e.key === "Escape") { setCreatingFolder(false); setFolderName(""); }
              }}
              className="mb-1 h-7 text-[12.5px]"
            />
          )}
          {folderGroups.length === 0 && !creatingFolder && (
            <p className="px-2 py-1 text-[11.5px] text-muted-foreground/70">
              Group chats across projects.
            </p>
          )}
          {folderGroups.map(({ folder, items }) => (
            <div key={folder.id} className="mb-1.5">
              <div className="group/f flex items-center justify-between px-2 py-0.5">
                <span className="flex items-center gap-1.5 text-[11.5px] font-medium text-muted-foreground">
                  <Folder className="h-3 w-3" /> {folder.name}
                </span>
                {onDeleteFolder && (
                  <button
                    type="button"
                    aria-label={`Delete folder ${folder.name}`}
                    onClick={() => onDeleteFolder(folder.id)}
                    className="hidden rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground group-hover/f:block"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                )}
              </div>
              {items.length === 0 ? (
                <p className="px-2 py-0.5 text-[11px] text-muted-foreground/60">Empty</p>
              ) : (
                <ul className="space-y-px">{items.map(renderThreadRow)}</ul>
              )}
            </div>
          ))}
        </div>

        {recent.length > 0 && (
          <div className="mb-3">
            {sectionHeader("Recent")}
            <ul className="space-y-px">{recent.map(renderThreadRow)}</ul>
          </div>
        )}

        {archived.length > 0 && (
          <div className="mb-3">
            <button
              type="button"
              onClick={() => setArchiveOpen((v) => !v)}
              className="flex w-full items-center gap-1.5 px-2 pb-1 pt-1 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground/70 hover:text-muted-foreground"
            >
              <Archive className="h-3 w-3" /> Archive ({archived.length}) {archiveOpen ? "▾" : "▸"}
            </button>
            {archiveOpen && <ul className="space-y-px">{archived.map(renderThreadRow)}</ul>}
          </div>
        )}
      </div>
    );
  };

  const renderLegacy = () => (
    <div className="px-1.5 pb-3">
      {legacyGroups.length === 0 ? (
        <p className="px-2 py-6 text-center text-[12px] text-muted-foreground">
          No chats yet.
        </p>
      ) : (
        legacyGroups.map((g) => (
          <div key={g.label} className="mb-3">
            <div className="px-2 pb-1 pt-1 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground/70">
              {g.label}
            </div>
            <ul className="space-y-px">{g.items.map(renderThreadRow)}</ul>
          </div>
        ))
      )}
    </div>
  );

  const showSearchResults = syncEnabled && Boolean(onSearchMessages) && query.trim().length > 0;

  return (
    <aside className="flex h-full min-h-0 w-full flex-col border-r border-border bg-surface-sunken">
      <div className="space-y-2 p-2.5">
        <Button
          onClick={onNewThread}
          size="sm"
          className="h-8 w-full justify-start gap-2 text-[12.5px] font-medium"
        >
          <Plus className="h-3.5 w-3.5" />
          New chat
        </Button>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={syncEnabled ? "Search all messages" : "Search chats"}
            className="h-8 border-transparent bg-transparent pl-8 text-[12.5px] focus-visible:border-border focus-visible:bg-background"
          />
        </div>
      </div>

      <ScrollArea className="flex-1 min-h-0">
        {showSearchResults
          ? renderSearchResults()
          : syncEnabled
            ? renderOrganized()
            : renderLegacy()}
      </ScrollArea>

      {memoryEnabled && memoryProjectId && (
        <ProjectMemoryPanel projectId={memoryProjectId} />
      )}
    </aside>
  );
}
