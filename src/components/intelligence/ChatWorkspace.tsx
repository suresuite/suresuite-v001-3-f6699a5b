import { useEffect, useRef } from "react";
import { Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MessageBubble } from "@/components/chat/MessageBubble";
import { AssistantMascot } from "@/components/chat/AssistantMascot";
import { getModelLabel, ModelPicker } from "@/components/chat/ModelPicker";
import { useProjectChat } from "@/hooks/useProjectChat";

const SUGGESTIONS = [
  "Which suppliers carry the highest risk?",
  "Show top 5 materials by spend.",
  "What's our exposure to single-sourced materials?",
  "If our top tier-1 supplier goes down, what should we do?",
];

interface ChatWorkspaceProps {
  projectId: string | null;
  threadId: string | null;
  projectLabel?: string | null;
  userName?: string | null;
  input: string;
  onInputChange: (v: string) => void;
  model: string;
  onModelChange: (id: string) => void;
}

function greeting(name?: string | null) {
  const h = new Date().getHours();
  const part = h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
  return name ? `${part}, ${name}` : part;
}

export function ChatWorkspace({
  projectId,
  threadId,
  projectLabel,
  userName,
  input,
  onInputChange,
  model,
  onModelChange,
}: ChatWorkspaceProps) {
  const { messages, loading, error, send } = useProjectChat(projectId, threadId);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading]);

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 40);
  }, [threadId, projectId]);

  const submit = async () => {
    const text = input;
    onInputChange("");
    await send(text, model);
  };

  const empty = messages.length === 0;

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      {empty ? (
        <div className="flex flex-1 flex-col items-center justify-center px-6">
          <div className="w-full max-w-2xl space-y-8">
            <div className="flex items-center justify-center gap-3">
              <AssistantMascot className="h-10 w-10" />
              <h2 className="text-2xl font-semibold tracking-tight text-foreground">
                {greeting(userName)}
              </h2>
            </div>
            <p className="text-center text-sm text-muted-foreground">
              {projectId
                ? `Ask about ${projectLabel ?? "your project"} — network structure, risks, or next steps.`
                : "Pick a project from the sidebar to start."}
            </p>

            <div className="rounded-2xl border border-border bg-card shadow-sm">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => onInputChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey && input.trim() && projectId) {
                    e.preventDefault();
                    submit();
                  }
                }}
                placeholder={projectId ? "How can I help you today?" : "Select a project first"}
                disabled={!projectId || loading}
                rows={2}
                className="w-full resize-none rounded-t-2xl bg-transparent px-4 py-3 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
                style={{ minHeight: 64 }}
              />
              <div className="flex items-center justify-between gap-2 border-t border-border/60 px-3 py-2">
                <ModelPicker value={model} onChange={onModelChange} />
                <Button
                  size="sm"
                  onClick={submit}
                  disabled={!projectId || !input.trim() || loading}
                  className="h-8 gap-1.5"
                >
                  {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                  Send
                </Button>
              </div>
            </div>

            {projectId && (
              <div className="flex flex-wrap justify-center gap-2 pt-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => send(s, model)}
                    className="rounded-full border border-border bg-card px-3 py-1.5 text-xs text-foreground/80 transition hover:bg-accent hover:text-accent-foreground"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : (
        <>
          <div ref={scrollRef} className="flex-1 overflow-y-auto">
            <div className="mx-auto max-w-3xl space-y-4 px-6 py-6">
              {messages.map((m) => (
                <MessageBubble key={m.id} message={m} />
              ))}
              {loading && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Thinking…
                </div>
              )}
              {error && (
                <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                  {error}
                </div>
              )}
            </div>
          </div>

          <div className="border-t border-border bg-card">
            <div className="mx-auto max-w-3xl px-4 py-3">
              <div className="rounded-2xl border border-border bg-background shadow-sm">
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={(e) => onInputChange(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey && input.trim() && projectId) {
                      e.preventDefault();
                      submit();
                    }
                  }}
                  placeholder="Ask about this project…"
                  disabled={!projectId || loading}
                  rows={1}
                  className="w-full resize-none rounded-t-2xl bg-transparent px-4 py-3 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
                  style={{ minHeight: 48, maxHeight: 160 }}
                />
                <div className="flex items-center justify-between gap-2 border-t border-border/60 px-3 py-2">
                  <div className="text-[11px] text-muted-foreground">
                    {getModelLabel(model)}
                  </div>
                  <div className="flex items-center gap-2">
                    <ModelPicker value={model} onChange={onModelChange} />
                    <Button
                      size="sm"
                      onClick={submit}
                      disabled={!projectId || !input.trim() || loading}
                      className="h-8 gap-1.5"
                    >
                      {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                      Send
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
