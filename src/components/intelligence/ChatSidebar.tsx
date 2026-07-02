import { Plus, Search, Trash2, MessagesSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { QUICK_THREAD_ID, type Thread } from "@/hooks/useChatThreads";
import { useMemo, useState } from "react";

interface Project {
  id: string;
  name: string;
  plant_name?: string | null;
}

interface ChatSidebarProps {
  projects: Project[];
  selectedProjectId: string | null;
  onSelectProject: (id: string) => void;
  threads: Thread[];
  activeThreadId: string | null;
  onSelectThread: (id: string) => void;
  onNewThread: () => void;
  onDeleteThread: (id: string) => void;
}

function groupThreads(threads: Thread[]) {
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  const groups: { label: string; items: Thread[] }[] = [
    { label: "Pinned", items: [] },
    { label: "Today", items: [] },
    { label: "Previous 7 days", items: [] },
    { label: "Older", items: [] },
  ];
  for (const t of threads) {
    if (t.id === QUICK_THREAD_ID) groups[0].items.push(t);
    else if (now - t.updatedAt < day) groups[1].items.push(t);
    else if (now - t.updatedAt < 7 * day) groups[2].items.push(t);
    else groups[3].items.push(t);
  }
  return groups.filter((g) => g.items.length > 0);
}

export function ChatSidebar({
  projects,
  selectedProjectId,
  onSelectProject,
  threads,
  activeThreadId,
  onSelectThread,
  onNewThread,
  onDeleteThread,
}: ChatSidebarProps) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    if (!query.trim()) return threads;
    const q = query.toLowerCase();
    return threads.filter((t) => t.title.toLowerCase().includes(q));
  }, [threads, query]);
  const groups = useMemo(() => groupThreads(filtered), [filtered]);

  return (
    <aside className="flex h-full w-full flex-col border-r border-border bg-muted/30">
      <div className="space-y-3 border-b border-border p-3">
        <Button
          onClick={onNewThread}
          disabled={!selectedProjectId}
          className="w-full justify-start gap-2"
          variant="default"
        >
          <Plus className="h-4 w-4" />
          New chat
        </Button>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search chats"
            className="h-8 pl-8 text-xs"
          />
        </div>
        <div className="space-y-1">
          <label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Project
          </label>
          <Select value={selectedProjectId ?? ""} onValueChange={onSelectProject}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder="Select project" />
            </SelectTrigger>
            <SelectContent>
              {projects.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="px-2 py-3">
          {!selectedProjectId ? (
            <p className="px-2 py-6 text-center text-xs text-muted-foreground">
              Pick a project to see its chats.
            </p>
          ) : groups.length === 0 ? (
            <p className="px-2 py-6 text-center text-xs text-muted-foreground">
              No chats yet. Start a new conversation.
            </p>
          ) : (
            groups.map((g) => (
              <div key={g.label} className="mb-4">
                <div className="px-2 pb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  {g.label}
                </div>
                <ul className="space-y-0.5">
                  {g.items.map((t) => {
                    const active = t.id === activeThreadId;
                    const isQuick = t.id === QUICK_THREAD_ID;
                    return (
                      <li
                        key={t.id}
                        className={cn(
                          "group flex items-center gap-1 rounded-md px-1.5 transition",
                          active ? "bg-accent" : "hover:bg-accent/60",
                        )}
                      >
                        <button
                          type="button"
                          onClick={() => onSelectThread(t.id)}
                          className={cn(
                            "flex min-w-0 flex-1 items-center gap-2 py-1.5 text-left text-sm",
                            active ? "text-foreground" : "text-foreground/80",
                          )}
                        >
                          {isQuick && (
                            <MessagesSquare className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          )}
                          <span className="truncate">{t.title}</span>
                        </button>
                        {!isQuick && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onDeleteThread(t.id);
                            }}
                            className="hidden h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 transition hover:bg-background hover:text-destructive group-hover:flex group-hover:opacity-100"
                            aria-label="Delete chat"
                            title="Delete chat"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
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
