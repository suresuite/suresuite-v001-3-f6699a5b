import { useEffect, useRef } from "react";
import { Loader2, X } from "lucide-react";
import { MessageBubble } from "@/components/chat/MessageBubble";
import { AssistantMascot } from "@/components/chat/AssistantMascot";
import { useProjectChat } from "@/hooks/useProjectChat";
import { AgentPicker } from "./AgentPicker";
import { ChatComposer } from "./ChatComposer";
import { AGENTS, getAgent } from "@/lib/chat/agents";

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

  const empty = messages.length === 0;
  const activeAgent = agentId ? getAgent(agentId) : null;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background">
      {empty ? (
        <div className="flex flex-1 flex-col items-center justify-center overflow-y-auto px-6 py-10">
          <div className="w-full max-w-2xl space-y-6">
            <div className="flex items-center justify-center gap-3">
              <AssistantMascot className="h-10 w-10" />
              <h2 className="text-2xl font-semibold tracking-tight text-foreground">
                {greeting(userName)}
              </h2>
            </div>

            {activeAgent ? (
              <div className="flex items-center justify-center gap-2">
                <div className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs">
                  <activeAgent.icon className={`h-3.5 w-3.5 ${activeAgent.color}`} />
                  <span className="font-medium text-foreground">{activeAgent.name}</span>
                  <button
                    type="button"
                    onClick={() => onAgentChange("")}
                    className="rounded-full p-0.5 text-muted-foreground hover:bg-muted"
                    aria-label="Change agent"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-center text-xs uppercase tracking-wide text-muted-foreground">
                  Choose an agent to start with
                </p>
                <AgentPicker activeId={agentId} onSelect={onAgentChange} />
              </div>
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
              placeholder={activeAgent ? `Ask the ${activeAgent.name}…` : "How can I help you today?"}
              autoFocus
            />

            {error && (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {error}
              </div>
            )}
          </div>
        </div>
      ) : (
        <>
          <div ref={scrollRef} className="flex-1 overflow-y-auto">
            <div className="mx-auto max-w-3xl space-y-4 px-6 py-6">
              {activeAgent && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <activeAgent.icon className={`h-3.5 w-3.5 ${activeAgent.color}`} />
                  <span>{activeAgent.name}</span>
                </div>
              )}
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
