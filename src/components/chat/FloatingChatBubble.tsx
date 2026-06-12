import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { Loader2, MessageSquare, Send, Sparkles, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { useGlobalProject } from "@/hooks/useGlobalProject";
import { useProjectChat } from "@/hooks/useProjectChat";
import { MessageBubble } from "./MessageBubble";

const SUGGESTIONS = [
  "Which suppliers carry the highest risk?",
  "Show top 5 materials by spend.",
  "What's our exposure to single-sourced materials?",
  "If our top tier-1 supplier goes down, what should we do?",
];

export function FloatingChatBubble() {
  const location = useLocation();
  const { user } = useAuth();
  const { selectedProject, globalSelectedProjectId } = useGlobalProject();
  const projectId = selectedProject?.id ?? globalSelectedProjectId ?? null;
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const { messages, loading, error, send, clear } = useProjectChat(projectId);

  // Hide on auth page or when not signed in.
  const hidden = !user || location.pathname.startsWith("/auth");

  useEffect(() => {
    if (open) scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading, open]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 60);
  }, [open]);

  if (hidden) return null;

  const onSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const text = input;
    setInput("");
    await send(text);
  };

  const projectLabel = selectedProject?.name ?? (projectId ? "Project" : null);

  return (
    <>
      {/* Launcher */}
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open Supply Chain AI"
          className="group fixed bottom-5 right-5 z-50 flex items-center gap-2 rounded-full bg-primary px-4 py-3 text-primary-foreground shadow-lg shadow-primary/30 ring-2 ring-primary/30 transition hover:scale-[1.02] hover:shadow-xl"
        >
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-400" />
          </span>
          <Sparkles className="h-4 w-4" />
          <span className="text-sm font-medium">Ask AI</span>
        </button>
      )}

      {/* Panel */}
      {open && (
        <div
          className="fixed inset-x-2 bottom-2 z-50 flex h-[min(80vh,640px)] flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-2xl sm:inset-auto sm:bottom-5 sm:right-5 sm:h-[640px] sm:w-[400px]"
          role="dialog"
          aria-label="Supply Chain AI"
        >
          {/* Header */}
          <div className="flex items-center gap-2 border-b border-border bg-gradient-to-r from-primary/10 to-transparent px-3 py-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <MessageSquare className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold leading-tight">Supply Chain AI</div>
              <div className="truncate text-[11px] text-muted-foreground">
                {projectLabel ? `Project: ${projectLabel}` : "No project selected"}
              </div>
            </div>
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
                  Ask about suppliers, procurement spend, material risk, or recovery strategies for this project. Answers always come from your project data.
                </div>
                <div className="space-y-1.5">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => send(s)}
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
