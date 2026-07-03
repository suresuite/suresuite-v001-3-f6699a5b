import { Plus, Search, MoreHorizontal, MessagesSquare, Pencil, Folder, FolderX, Trash2, Check } from "lucide-react";
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
import { QUICK_THREAD_ID, type Thread } from "@/hooks/useChatThreads";
import { useMemo, useState } from "react";

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
}

function groupThreads(threads: Thread[]) {
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

export function ChatSidebar({
  projects,
  threads,
  activeThreadId,
  onSelectThread,
  onNewThread,
  onDeleteThread,
  onRenameThread,
  onAttachProject,
}: ChatSidebarProps) {
  const [query, setQuery] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const filtered = useMemo(() => {
    if (!query.trim()) return threads;
    const q = query.toLowerCase();
    return threads.filter((t) => t.title.toLowerCase().includes(q));
  }, [threads, query]);
  const groups = useMemo(() => groupThreads(filtered), [filtered]);

  const startRename = (t: Thread) => {
    setRenamingId(t.id);
    setRenameValue(t.title);
  };
  const commitRename = () => {
    if (renamingId && renameValue.trim()) onRenameThread(renamingId, renameValue.trim());
    setRenamingId(null);
    setRenameValue("");
  };

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
            placeholder="Search chats"
            className="h-8 border-transparent bg-transparent pl-8 text-[12.5px] focus-visible:border-border focus-visible:bg-background"
          />
        </div>
      </div>

      <ScrollArea className="flex-1 min-h-0">
        <div className="px-1.5 pb-3">
          {groups.length === 0 ? (
            <p className="px-2 py-6 text-center text-[12px] text-muted-foreground">
              No chats yet.
            </p>
          ) : (
            groups.map((g) => (
              <div key={g.label} className="mb-3">
                <div className="px-2 pb-1 pt-1 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                  {g.label}
                </div>
                <ul className="space-y-px">
                  {g.items.map((t) => {
                    const active = t.id === activeThreadId;
                    const isQuick = t.id === QUICK_THREAD_ID;
                    return (
                      <li
                        key={t.id}
                        className={cn(
                          "group relative flex items-center rounded-md pr-0.5 transition-colors",
                          active
                            ? "bg-background shadow-xs"
                            : "hover:bg-background/60",
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
                  })}
                </ul>
              </div>
            ))
          )}
        </div>
      </ScrollArea>
    </aside>
  );
}
