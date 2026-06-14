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
const PANEL_SIZE = { w: 480, h: 760 };

interface Pos { x: number; y: number }

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
  return loadPosFrom(LAUNCHER_POS_KEY);
}

function defaultPos(): Pos {
  if (typeof window === "undefined") return { x: 20, y: 20 };
  return { x: window.innerWidth - LAUNCHER_SIZE.w - 20, y: window.innerHeight - LAUNCHER_SIZE.h - 20 };
}

// Effective panel size, capped to the viewport so it always fits.
function panelSize(): { w: number; h: number } {
  if (typeof window === "undefined") return { w: PANEL_SIZE.w, h: PANEL_SIZE.h };
  return {
    w: Math.min(PANEL_SIZE.w, window.innerWidth - 16),
    h: Math.min(PANEL_SIZE.h, window.innerHeight - 24),
  };
}

function defaultPanelPos(): Pos {
  if (typeof window === "undefined") return { x: 20, y: 20 };
  const s = panelSize();
  return { x: window.innerWidth - s.w - 12, y: window.innerHeight - s.h - 12 };
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
  const [panelPos, setPanelPos] = useState<Pos>(() => loadPosFrom(PANEL_POS_KEY) ?? defaultPanelPos());
  const [panelDragging, setPanelDragging] = useState(false);
  const panelDragState = useRef<{ ox: number; oy: number } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const { messages, loading, error, send, clear } = useProjectChat(projectId);

  const hidden = !user || location.pathname.startsWith("/auth");

  useEffect(() => {
    if (open) scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading, open]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 60);
  }, [open]);

  // Keep launcher and panel in viewport on resize.
  useEffect(() => {
    const onResize = () => {
      setPos((p) => ({
        x: Math.min(Math.max(0, p.x), window.innerWidth - LAUNCHER_SIZE.w),
        y: Math.min(Math.max(0, p.y), window.innerHeight - LAUNCHER_SIZE.h),
      }));
      const s = panelSize();
      setPanelPos((p) => ({
        x: Math.min(Math.max(8, p.x), window.innerWidth - s.w),
        y: Math.min(Math.max(8, p.y), window.innerHeight - s.h),
      }));
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
      const s = panelSize();
      const nx = e.clientX - panelDragState.current.ox;
      const ny = e.clientY - panelDragState.current.oy;
      setPanelPos({
        x: Math.min(Math.max(8, nx), window.innerWidth - s.w),
        y: Math.min(Math.max(8, ny), window.innerHeight - s.h),
      });
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

  if (hidden) return null;

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

  const startDrag = (e: React.PointerEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    dragState.current = { ox: e.clientX - rect.left, oy: e.clientY - rect.top, moved: false };
    setDragging(true);
  };

  const startPanelDrag = (e: React.PointerEvent) => {
    panelDragState.current = { ox: e.clientX - panelPos.x, oy: e.clientY - panelPos.y };
    setPanelDragging(true);
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
            setOpen(true);
          }}
          className="group fixed z-50 flex cursor-grab select-none items-center justify-center rounded-full border border-[#ff0033]/30 bg-black text-white shadow-lg shadow-[0_0_14px_3px_rgba(255,0,51,0.6)] transition hover:bg-neutral-900 active:cursor-grabbing"
          aria-label="Ask SC assistant"
          title="Ask SC assistant"
        >
          {/* Rotating light: a neon-red glow with a fading tail rides on top of the border */}
          <span
            className="pointer-events-none absolute -inset-[2px] animate-spin rounded-full"
            style={{
              animationDuration: "2.4s",
              background:
                "conic-gradient(from 0deg, rgba(255,0,51,0) 0deg, rgba(255,0,51,0) 225deg, rgba(255,0,51,0.7) 315deg, rgba(255,45,75,1) 352deg, rgba(255,0,51,1) 358deg, rgba(255,0,51,0) 360deg)",
            }}
          />
          <span className="pointer-events-none absolute inset-[2px] rounded-full bg-black" />
          <AssistantMascot className="pointer-events-none relative h-[34px] w-[34px]" />
        </button>
      )}

      {/* Panel */}
      {open && (
        <div
          style={{
            left: panelPos.x,
            top: panelPos.y,
            width: "min(480px, calc(100vw - 16px))",
            height: "min(760px, calc(100vh - 24px))",
          }}
          className="fixed z-50 flex flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-2xl"
          role="dialog"
          aria-label="Supply Chain assistant"
        >
          {/* Header */}
          <div className="border-b border-border bg-gradient-to-r from-muted/40 to-transparent">
            <div className="flex items-center gap-2 px-3 py-2.5">
              <div
                onPointerDown={startPanelDrag}
                className="flex min-w-0 flex-1 cursor-move select-none items-center gap-2"
                title="Drag to move"
              >
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                  <MessageSquare className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold leading-tight">SC assistant</div>
                  <div className="truncate text-[11px] text-muted-foreground">
                    {projectLabel ? `Project: ${projectLabel}` : "No project selected"}
                  </div>
                </div>
              </div>
              <ModelPicker value={model} onChange={onModelChange} />
              {messages.length > 0 && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={clear}
                  aria-label="Clear chat"
                  title="Clear chat"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => setOpen(false)}
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            {/* Active-project switcher (always available) */}
            <div className="flex items-center gap-2 px-3 pb-2">
              <span className="shrink-0 text-[11px] font-medium text-muted-foreground">Project</span>
              <ProjectSelector
                projects={projects as any}
                selectedProjectId={projectId}
                onProjectSelect={chooseProject}
                placeholder="Select a project…"
                className="h-7 flex-1 text-xs"
              />
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
        </div>
      )}
    </>
  );
}
