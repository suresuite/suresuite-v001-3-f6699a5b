import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { GripVertical, Loader2, MessageSquare, Send, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { useGlobalProject } from "@/hooks/useGlobalProject";
import { useProjectChat } from "@/hooks/useProjectChat";
import { MessageBubble } from "./MessageBubble";
import { ModelPicker, getModelLabel, getStoredModel, setStoredModel } from "./ModelPicker";

const SUGGESTIONS = [
  "Which suppliers carry the highest risk?",
  "Show top 5 materials by spend.",
  "What's our exposure to single-sourced materials?",
  "If our top tier-1 supplier goes down, what should we do?",
];

const LAUNCHER_POS_KEY = "projectChat.launcherPos";
const LAUNCHER_SIZE = { w: 168, h: 44 };

interface Pos { x: number; y: number }

function loadPos(): Pos | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(LAUNCHER_POS_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw);
    if (typeof p?.x === "number" && typeof p?.y === "number") return p;
  } catch { /* ignore */ }
  return null;
}

function defaultPos(): Pos {
  if (typeof window === "undefined") return { x: 20, y: 20 };
  return { x: window.innerWidth - LAUNCHER_SIZE.w - 20, y: window.innerHeight - LAUNCHER_SIZE.h - 20 };
}

export function FloatingChatBubble() {
  const location = useLocation();
  const { user } = useAuth();
  const { selectedProject, globalSelectedProjectId } = useGlobalProject();
  const projectId = selectedProject?.id ?? globalSelectedProjectId ?? null;
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [model, setModel] = useState<string>(() => getStoredModel());
  const [pos, setPos] = useState<Pos>(() => loadPos() ?? defaultPos());
  const [dragging, setDragging] = useState(false);
  const dragState = useRef<{ ox: number; oy: number; moved: boolean } | null>(null);
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

  // Keep launcher in viewport on resize.
  useEffect(() => {
    const onResize = () => {
      setPos((p) => ({
        x: Math.min(Math.max(0, p.x), window.innerWidth - LAUNCHER_SIZE.w),
        y: Math.min(Math.max(0, p.y), window.innerHeight - LAUNCHER_SIZE.h),
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

  const startDrag = (e: React.PointerEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    dragState.current = { ox: e.clientX - rect.left, oy: e.clientY - rect.top, moved: false };
    setDragging(true);
  };

  return (
    <>
      {/* Launcher (draggable) */}
      {!open && (
        <div
          style={{ left: pos.x, top: pos.y, width: LAUNCHER_SIZE.w }}
          className="fixed z-50 flex select-none items-stretch overflow-hidden rounded-lg border-2 border-red-500/70 bg-emerald-500 text-white shadow-lg shadow-emerald-500/40"
          aria-label="Supply Chain assistant launcher"
        >
          <button
            type="button"
            onPointerDown={startDrag}
            className="flex cursor-grab items-center justify-center bg-emerald-600/80 px-1.5 active:cursor-grabbing"
            aria-label="Drag to reposition"
            title="Drag to reposition"
            onClick={(e) => e.stopPropagation()}
          >
            <GripVertical className="h-4 w-4 opacity-90" />
          </button>
          <button
            type="button"
            onClick={() => {
              if (dragState.current?.moved) { dragState.current.moved = false; return; }
              setOpen(true);
            }}
            className="flex flex-1 items-center justify-center gap-1.5 px-3 py-2.5 text-sm font-semibold transition hover:bg-emerald-600"
          >
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-80" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
            </span>
            Ask SC assistant
          </button>
        </div>
      )}

      {/* Panel */}
      {open && (
        <div
          className="fixed inset-x-2 bottom-2 z-50 flex h-[min(80vh,640px)] flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-2xl sm:inset-auto sm:bottom-5 sm:right-5 sm:h-[640px] sm:w-[420px]"
          role="dialog"
          aria-label="Supply Chain assistant"
        >
          {/* Header */}
          <div className="flex items-center gap-2 border-b border-border bg-gradient-to-r from-emerald-500/10 to-transparent px-3 py-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-500 text-white">
              <MessageSquare className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold leading-tight">SC assistant</div>
              <div className="truncate text-[11px] text-muted-foreground">
                {projectLabel ? `Project: ${projectLabel}` : "No project selected"}
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

          {/* Body */}
          <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-3 py-3">
            {!projectId && (
              <div className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
                Select a project from the sidebar to start asking questions about its supply chain.
              </div>
            )}
            {projectId && messages.length === 0 && (
              <div className="space-y-3">
                <div className="rounded-lg bg-muted/40 p-3 text-xs text-muted-foreground">
                  I'm your Supply Chain assistant, currently running on <span className="font-medium text-foreground">{getModelLabel(model)}</span>. I help you understand your network, spot risks, and decide what to do next.
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
