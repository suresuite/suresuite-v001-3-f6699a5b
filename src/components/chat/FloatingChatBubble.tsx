import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { Loader2, MessageSquare, Send, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { useGlobalProject } from "@/hooks/useGlobalProject";
import { useProjectChat } from "@/hooks/useProjectChat";
import { useProjects } from "@/hooks/useProjects";
import { ProjectSelector } from "@/components/shared/ProjectSelector";
import { MessageBubble } from "./MessageBubble";
import { AssistantMascot } from "./AssistantMascot";
import { ModelPicker, getModelLabel, getStoredModel, setStoredModel } from "./ModelPicker";

const SUGGESTIONS = [
  "Which suppliers carry the highest risk?",
  "Show top 5 materials by spend.",
  "What's our exposure to single-sourced materials?",
  "If our top tier-1 supplier goes down, what should we do?",
];

const LAUNCHER_POS_KEY = "projectChat.launcherPos";
const LAUNCHER_SIZE = { w: 60, h: 60 };
const PANEL_POS_KEY = "projectChat.panelPos";
const PANEL_DIMS_KEY = "projectChat.panelSize";
const PANEL_SIZE = { w: 480, h: 760 };
const PANEL_MIN = { w: 340, h: 380 };

interface Pos { x: number; y: number }
interface Dims { w: number; h: number }

function loadPosFrom(key: string): Pos | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const p = JSON.parse(raw);
    if (typeof p?.x === "number" && typeof p?.y === "number") return p;
  } catch { /* ignore */ }
  return null;
}

function loadPos(): Pos | null {
  const p = loadPosFrom(LAUNCHER_POS_KEY);
  if (!p || typeof window === "undefined") return p;
  // Clamp stale positions back into the current viewport so the launcher is never offscreen.
  const x = Math.min(Math.max(0, p.x), window.innerWidth - LAUNCHER_SIZE.w);
  const y = Math.min(Math.max(0, p.y), window.innerHeight - LAUNCHER_SIZE.h);
  return { x, y };
}

function defaultPos(): Pos {
  if (typeof window === "undefined") return { x: 20, y: 20 };
  return {
    x: Math.max(12, window.innerWidth - LAUNCHER_SIZE.w - 20),
    y: Math.max(12, window.innerHeight - LAUNCHER_SIZE.h - 20),
  };
}

// Clamp panel size to the viewport (and a sensible minimum) so it always fits.
function clampDims(w: number, h: number): Dims {
  if (typeof window === "undefined") return { w, h };
  return {
    w: Math.min(Math.max(PANEL_MIN.w, w), window.innerWidth - 16),
    h: Math.min(Math.max(PANEL_MIN.h, h), window.innerHeight - 24),
  };
}

function loadDims(): Dims | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(PANEL_DIMS_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw);
    if (typeof d?.w === "number" && typeof d?.h === "number") return clampDims(d.w, d.h);
  } catch { /* ignore */ }
  return null;
}

function defaultDims(): Dims {
  return clampDims(PANEL_SIZE.w, PANEL_SIZE.h);
}

function defaultPanelPos(): Pos {
  if (typeof window === "undefined") return { x: 20, y: 20 };
  const s = defaultDims();
  return clampPanelPos({ x: window.innerWidth - s.w - 12, y: window.innerHeight - s.h - 12 }, s);
}

function clampPanelPos(p: Pos, s: Dims): Pos {
  if (typeof window === "undefined") return p;
  const maxX = Math.max(8, window.innerWidth - s.w - 8);
  const maxY = Math.max(8, window.innerHeight - s.h - 8);
  return {
    x: Math.min(Math.max(8, p.x), maxX),
    y: Math.min(Math.max(8, p.y), maxY),
  };
}

function loadPanelPos(s: Dims): Pos {
  return clampPanelPos(loadPosFrom(PANEL_POS_KEY) ?? defaultPanelPos(), s);
}

export function FloatingChatBubble() {
  const location = useLocation();
  const { user } = useAuth();
  const { selectedProject, globalSelectedProjectId, setGlobalSelectedProjectId, setSelectedProject } = useGlobalProject();
  const projectId = selectedProject?.id ?? globalSelectedProjectId ?? null;
  const { projects, loading: projectsLoading } = useProjects();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [model, setModel] = useState<string>(() => getStoredModel());
  const [pos, setPos] = useState<Pos>(() => loadPos() ?? defaultPos());
  const [dragging, setDragging] = useState(false);
  const dragState = useRef<{ ox: number; oy: number; moved: boolean } | null>(null);
  const [panelDims, setPanelDims] = useState<Dims>(() => loadDims() ?? defaultDims());
  const [panelPos, setPanelPos] = useState<Pos>(() => loadPanelPos(loadDims() ?? defaultDims()));
  const [panelDragging, setPanelDragging] = useState(false);
  const panelDragState = useRef<{ ox: number; oy: number } | null>(null);
  const [resizing, setResizing] = useState(false);
  const resizeState = useRef<{ sx: number; sy: number; sw: number; sh: number } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const panelDimsRef = useRef<Dims>(panelDims);
  panelDimsRef.current = panelDims;

  const { messages, loading, error, send, clear } = useProjectChat(projectId);

  const hidden = !user || location.pathname.startsWith("/auth");

  useEffect(() => {
    if (open) scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading, open]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 60);
  }, [open]);

  // Keep launcher and panel (position + size) in viewport on window resize.
  useEffect(() => {
    const onResize = () => {
      setPos((p) => ({
        x: Math.min(Math.max(0, p.x), window.innerWidth - LAUNCHER_SIZE.w),
        y: Math.min(Math.max(0, p.y), window.innerHeight - LAUNCHER_SIZE.h),
      }));
      const s = clampDims(panelDimsRef.current.w, panelDimsRef.current.h);
      setPanelDims(s);
      setPanelPos((p) => clampPanelPos(p, s));
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Drag handlers
  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: PointerEvent) => {
      if (!dragState.current) return;
      const nx = e.clientX - dragState.current.ox;
      const ny = e.clientY - dragState.current.oy;
      dragState.current.moved = true;
      setPos({
        x: Math.min(Math.max(0, nx), window.innerWidth - LAUNCHER_SIZE.w),
        y: Math.min(Math.max(0, ny), window.innerHeight - LAUNCHER_SIZE.h),
      });
    };
    const onUp = () => {
      setDragging(false);
      if (typeof window !== "undefined") {
        window.localStorage.setItem(LAUNCHER_POS_KEY, JSON.stringify(pos));
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [dragging, pos]);

  // Panel drag handlers
  useEffect(() => {
    if (!panelDragging) return;
    const onMove = (e: PointerEvent) => {
      if (!panelDragState.current) return;
      const s = panelDimsRef.current;
      const nx = e.clientX - panelDragState.current.ox;
      const ny = e.clientY - panelDragState.current.oy;
      setPanelPos(clampPanelPos({ x: nx, y: ny }, s));
    };
    const onUp = () => {
      setPanelDragging(false);
      if (typeof window !== "undefined") {
        window.localStorage.setItem(PANEL_POS_KEY, JSON.stringify(panelPos));
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [panelDragging, panelPos]);

  // Panel resize handlers (bottom-right grip)
  useEffect(() => {
    if (!resizing) return;
    const onMove = (e: PointerEvent) => {
      if (!resizeState.current) return;
      const { sx, sy, sw, sh } = resizeState.current;
      setPanelDims(clampDims(sw + (e.clientX - sx), sh + (e.clientY - sy)));
    };
    const onUp = () => {
      setResizing(false);
      if (typeof window !== "undefined") {
        window.localStorage.setItem(PANEL_DIMS_KEY, JSON.stringify(panelDimsRef.current));
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [resizing]);

  const onSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const text = input;
    setInput("");
    await send(text, model);
  };

  const onModelChange = (id: string) => {
    setModel(id);
    setStoredModel(id);
  };

  const projectLabel = selectedProject?.name ?? (projectId ? "Project" : null);

  // Keep the full selectedProject in sync with the active id (e.g. after a cross-page pick).
  useEffect(() => {
    if (!projectId) return;
    const match = projects.find((p) => p.id === projectId);
    if (match && match.id !== selectedProject?.id) setSelectedProject(match as any);
  }, [projectId, projects, selectedProject?.id, setSelectedProject]);

  const chooseProject = (id: string) => {
    setGlobalSelectedProjectId(id);
    setSelectedProject((projects.find((p) => p.id === id) ?? null) as any);
  };

  const openPanel = () => {
    const s = clampDims(panelDimsRef.current.w, panelDimsRef.current.h);
    setPanelDims(s);
    setPanelPos((p) => clampPanelPos(p, s));
    setOpen(true);
  };

  if (hidden) return null;

  const startDrag = (e: React.PointerEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    dragState.current = { ox: e.clientX - rect.left, oy: e.clientY - rect.top, moved: false };
    setDragging(true);
  };

  const startPanelDrag = (e: React.PointerEvent) => {
    panelDragState.current = { ox: e.clientX - panelPos.x, oy: e.clientY - panelPos.y };
    setPanelDragging(true);
  };

  const startResize = (e: React.PointerEvent) => {
    e.stopPropagation();
    resizeState.current = { sx: e.clientX, sy: e.clientY, sw: panelDims.w, sh: panelDims.h };
    setResizing(true);
  };

  return (
    <>
      {/* Launcher (draggable round button) */}
      {!open && (
        <button
          type="button"
          style={{ left: pos.x, top: pos.y, height: LAUNCHER_SIZE.h, width: LAUNCHER_SIZE.w }}
          onPointerDown={startDrag}
          onClick={() => {
            if (dragState.current?.moved) { dragState.current.moved = false; return; }
            openPanel();
          }}
          className="chat-launcher-comet group fixed z-[80] flex cursor-grab select-none items-center justify-center rounded-full border border-primary/30 bg-background shadow-xl transition hover:scale-105 active:cursor-grabbing"
          aria-label="Ask SC assistant"
          title="Ask SC assistant"
        >
          <AssistantMascot className="pointer-events-none h-8 w-8" />
        </button>
      )}

      {/* Panel */}
      {open && (
        <div
          style={{ left: panelPos.x, top: panelPos.y, width: panelDims.w, height: panelDims.h }}
          className="fixed z-[80] flex flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-2xl"
          role="dialog"
          aria-label="Supply Chain assistant"
        >
          {/* Header — two rows: identity + context controls */}
          <div className="border-b border-header-border bg-header-background">
            <div
              onPointerDown={startPanelDrag}
              className="flex cursor-move items-center justify-between gap-3 px-4 pt-3 pb-2"
            >
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 ring-1 ring-primary/20">
                  <AssistantMascot className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <h2 className="truncate text-[15px] font-semibold leading-tight tracking-tight text-foreground">
                    SC Assistant
                  </h2>
                  <p className="mt-0.5 truncate text-[12px] text-muted-foreground">
                    {selectedProject?.name
                      ? `Analyzing ${selectedProject.name}`
                      : "Ask anything about your supply chain"}
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 w-8 p-0"
                  onClick={(e) => { e.stopPropagation(); setOpen(false); }}
                  onPointerDown={(e) => e.stopPropagation()}
                  aria-label="Close"
                  title="Close"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>
            <div className="flex items-center gap-2 border-t border-header-border/60 px-3 py-2">
              <ProjectSelector
                projects={projects as any}
                selectedProjectId={projectId}
                onProjectSelect={chooseProject}
                placeholder="Select a project..."
                className="min-w-0 flex-1"
              />
              <ModelPicker value={model} onChange={onModelChange} />
              {messages.length > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 w-8 shrink-0 p-0"
                  onClick={clear}
                  aria-label="Clear chat"
                  title="Clear chat"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>





          {/* Body */}
          <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-3 py-3">
            {!projectId && (
              <div className="space-y-3">
                <div className="rounded-lg bg-muted/40 p-3 text-xs text-muted-foreground">
                  👋 I'm your Supply Chain assistant. Which project should we dig into?
                </div>
                {projectsLoading ? (
                  <div className="flex items-center gap-2 px-1 text-xs text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Loading your projects…
                  </div>
                ) : projects.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
                    You don't have any projects yet.
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {projects.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => chooseProject(p.id)}
                        className="block w-full rounded-md border border-border px-2.5 py-2 text-left transition hover:bg-muted"
                      >
                        <div className="text-xs font-medium text-foreground">{p.name}</div>
                        {p.plant_name && (
                          <div className="truncate text-[11px] text-muted-foreground">{p.plant_name}</div>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            {projectId && messages.length === 0 && (
              <div className="space-y-3">
                <div className="rounded-lg bg-muted/40 p-3 text-xs text-muted-foreground">
                  Working on <span className="font-medium text-foreground">{projectLabel}</span> with <span className="font-medium text-foreground">{getModelLabel(model)}</span>. Ask about your network, risks, or what to do next — or switch projects from the selector above.
                </div>
                <div className="space-y-1.5">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => send(s, model)}
                      className="block w-full rounded-md border border-border px-2.5 py-1.5 text-left text-xs text-foreground transition hover:bg-muted"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((m) => <MessageBubble key={m.id} message={m} />)}
            {loading && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Thinking…
              </div>
            )}
            {error && (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 px-2.5 py-1.5 text-xs text-destructive">
                {error}
              </div>
            )}
          </div>

          {/* Composer */}
          <form onSubmit={onSubmit} className="flex items-end gap-2 border-t border-border bg-background p-2">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  onSubmit();
                }
              }}
              placeholder={projectId ? "Ask about this project…" : "Select a project to start chatting"}
              disabled={!projectId || loading}
              rows={1}
              className="flex-1 resize-none rounded-md border border-input bg-background px-2.5 py-2 text-sm outline-none ring-offset-background placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
              style={{ maxHeight: 120 }}
            />
            <Button type="submit" size="icon" disabled={!projectId || !input.trim() || loading} aria-label="Send">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </Button>
          </form>

          {/* Resize grip (bottom-right) */}
          <div
            onPointerDown={startResize}
            className="absolute bottom-0 right-0 z-10 h-4 w-4 cursor-se-resize touch-none"
            title="Drag to resize"
            aria-label="Resize chat"
          >
            <div className="absolute bottom-1 right-1 h-2 w-2 border-b-2 border-r-2 border-muted-foreground/50" />
          </div>
        </div>
      )}
    </>
  );
}
