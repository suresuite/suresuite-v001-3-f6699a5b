import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { MessageBubble } from "@/components/chat/MessageBubble";
import { AssistantMascot } from "@/components/chat/AssistantMascot";
import { useProjectChat } from "@/hooks/useProjectChat";
import type { ThreadMode } from "@/components/chat/ModeSwitch";
import { AgentPicker } from "./AgentPicker";
import { ChatComposer } from "./ChatComposer";
import { SuggestedActions, suggestedActionsUiEnabled } from "./SuggestedActions";
import { ThreadInfoPanel } from "./ThreadInfoPanel";
import { getAgent } from "@/lib/chat/agents";

interface Project { id: string; name: string; plant_name?: string | null }

interface ChatWorkspaceProps {
  threadId: string | null;
  projectId: string | null;
  agentId: string | null;
  onAgentChange: (id: string) => void;
  onProjectChange: (id: string | null) => void;
  projects: Project[];
  userName?: string | null;
  input: string;
  onInputChange: (v: string) => void;
  model: string;
  onModelChange: (id: string) => void;
  /** §15 per-thread interaction mode (Review when absent). */
  threadMode?: ThreadMode;
  onModeChange?: (mode: ThreadMode) => void;
}

function greeting(name?: string | null) {
  const h = new Date().getHours();
  const part = h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
  return name ? `${part}, ${name}` : part;
}

export function ChatWorkspace({
  threadId,
  projectId,
  agentId,
  onAgentChange,
  onProjectChange,
  projects,
  userName,
  input,
  onInputChange,
  model,
  onModelChange,
  threadMode = "review",
  onModeChange,
}: ChatWorkspaceProps) {
  const { messages, loading, error, send } = useProjectChat(threadId);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading]);

  const submit = async () => {
    const text = input;
    onInputChange("");
    await send(text, { model, projectId, agentId });
  };

  // §17.3: a picked chip sends its utterance — a plain sentence the user
  // could have typed (the chips teach the interface by example).
  const pickSuggestion = (utterance: string) => {
    if (!loading) void send(utterance, { model, projectId, agentId });
  };

  const empty = messages.length === 0;
  const suggestionsOn = suggestedActionsUiEnabled() && Boolean(projectId);
  const activeAgent = agentId ? getAgent(agentId) : null;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background">
      {/* Persistent agent strip */}
      {activeAgent && (
        <div className="flex items-center justify-between gap-2 border-b border-border bg-surface-elevated px-4 py-2">
          <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
            <activeAgent.icon className={`h-3.5 w-3.5 ${activeAgent.color}`} />
            <span className="font-medium text-foreground">{activeAgent.name}</span>
            <span className="text-muted-foreground/60">·</span>
            <span className="truncate">{activeAgent.blurb}</span>
          </div>
          <button
            type="button"
            onClick={() => onAgentChange("")}
            className="rounded-md p-1 text-muted-foreground transition hover:bg-muted hover:text-foreground"
            aria-label="Change agent"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* M1 (§14.3): rolling-summary visibility + deletion; renders nothing
          until the server has maintained a summary for this thread. */}
      <ThreadInfoPanel threadId={threadId} />

      {empty ? (
        <div className="flex flex-1 flex-col items-center justify-center overflow-y-auto px-6 py-10">
          <div className="w-full max-w-[640px] space-y-6">
            <div className="flex items-center justify-center gap-3">
              <AssistantMascot className="h-9 w-9" />
              <h2 className="text-[22px] font-semibold tracking-tight text-foreground">
                {greeting(userName)}
              </h2>
            </div>

            {!activeAgent && (
              <div className="space-y-2.5">
                <p className="text-center text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                  Choose an agent
                </p>
                <AgentPicker activeId={agentId} onSelect={onAgentChange} />
              </div>
            )}

            {/* §17.3: empty-thread starters — the same server-computed chips */}
            {suggestionsOn && (
              <SuggestedActions
                projectId={projectId}
                threadId={threadId}
                threadMode={threadMode}
                onPick={pickSuggestion}
                disabled={loading}
              />
            )}

            <ChatComposer
              input={input}
              onInputChange={onInputChange}
              onSubmit={submit}
              loading={loading}
              model={model}
              onModelChange={onModelChange}
              projects={projects}
              projectId={projectId}
              onProjectChange={onProjectChange}
              mode={threadMode}
              onModeChange={onModeChange}
              placeholder={activeAgent ? `Ask the ${activeAgent.name}…` : "How can I help you today?"}
              autoFocus
            />

            {error && (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-[12px] text-destructive">
                {error}
              </div>
            )}
          </div>
        </div>
      ) : (
        <>
          <div ref={scrollRef} className="flex-1 overflow-y-auto">
            <div className="mx-auto max-w-[720px] space-y-5 px-6 py-8">
              {messages.map((m) => (
                <MessageBubble key={m.id} message={m} />
              ))}
              {loading && (
                <div className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
                  <span className="relative flex h-1.5 w-1.5">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-foreground opacity-40" />
                    <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-foreground" />
                  </span>
                  Thinking…
                </div>
              )}
              {error && (
                <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-[12px] text-destructive">
                  {error}
                </div>
              )}
            </div>
          </div>

          <div className="border-t border-border bg-surface-sunken">
            <div className="mx-auto max-w-[720px] px-4 py-3">
              {/* §17.3: chips above the composer */}
              {suggestionsOn && (
                <SuggestedActions
                  projectId={projectId}
                  threadId={threadId}
                  threadMode={threadMode}
                  onPick={pickSuggestion}
                  disabled={loading}
                />
              )}
              <ChatComposer
                input={input}
                onInputChange={onInputChange}
                onSubmit={submit}
                loading={loading}
                model={model}
                onModelChange={onModelChange}
                projects={projects}
                projectId={projectId}
                onProjectChange={onProjectChange}
                mode={threadMode}
                onModeChange={onModeChange}
                placeholder="Reply…"
                minRows={1}
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
