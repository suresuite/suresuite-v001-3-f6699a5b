/**
 * ChatWorkspace — agent strip, memory strip, message stream, composer.
 *
 * Data flow is unchanged: useProjectChat(threadId) owns messages/loading/
 * error/send; this component only renders them. Empty threads show the agent
 * picker; populated threads show the stream with the composer docked below.
 *
 * The min-w-0 on the column and the agent strip matters — without it a long
 * agent blurb widens the grid track and pushes the composer off-screen.
 */
import React from "react";
import { AGENTS, getAgent } from "@/lib/chat/agents";
import { useProjectChat } from "@/hooks/useProjectChat";
import { AGENT_COLOR, AGENT_MONO, KX_TIGHT, LAYER, tint } from "./piUi";
import { ChatComposer } from "./ChatComposer";
import { MessageStream } from "./MessageStream";
import { ThreadInfoStrip } from "./SidebarPanels";
import { SuggestedActions } from "./SuggestedActions";
import { cn } from "@/lib/utils";

interface ChatWorkspaceProps {
  threadId: string | null;
  projectId: string | null;
  agentId: string | null;
  onAgentChange: (id: string) => void;
  onProjectChange: (id: string | null) => void;
  projects: Array<{ id: string; name: string }>;
  userName: string;
  input: string;
  onInputChange: (v: string) => void;
  model: string;
  onModelChange: (id: string) => void;
  threadMode: "ask" | "review";
  onModeChange: (m: "ask" | "review") => void;
  /** The chat_threads row id, when this thread has synced. §17.3 resolves the
   * thread's mode from that row, so the LOCAL thread id would never match. */
  serverThreadId?: string | null;
  threadSummary?: string | null;
  onDeleteSummary?: () => void;
}

const greeting = (name: string) => {
  const h = new Date().getHours();
  const part = h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
  return name ? part + ", " + name : part;
};

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
  threadMode,
  onModeChange,
  serverThreadId = null,
  threadSummary = null,
  onDeleteSummary = () => {},
}: ChatWorkspaceProps) {
  const { messages, loading, error, send } = useProjectChat(threadId);
  const agent = agentId ? getAgent(agentId) : null;
  const submit = () => {
    const text = input.trim();
    if (!text || loading) return;
    onInputChange("");
    void send(text, { model, projectId, agentId });
  };

  // §17.3 suggestion chips are SERVER-computed, deterministic and
  // capability-filtered — SuggestedActions calls mode:"suggest" and records
  // suggestion.clicked. This used to be two hardcoded strings, which shadowed
  // that entire surface even though the server's SUGGESTED_ACTIONS_ENABLED and
  // the client's VITE_SUGGESTED_ACTIONS_ENABLED are both true in the
  // deployment. SuggestedActions renders nothing when the flag is off or the
  // server returns no chips, so an empty state stays empty rather than
  // inventing prompts.
  const pickSuggestion = (utterance: string) => {
    onInputChange("");
    void send(utterance, { model, projectId, agentId });
  };

  const composer = (
    <ChatComposer
      value={input}
      onChange={onInputChange}
      onSubmit={submit}
      disabled={loading}
      placeholder={agent ? "Ask the " + agent.name + "…" : "How can I help you today?"}
      projects={projects}
      projectId={projectId}
      onProjectChange={onProjectChange}
      model={model}
      onModelChange={onModelChange}
      mode={threadMode}
      onModeChange={onModeChange}
    />
  );

  return (
    <div className="flex min-h-0 min-w-0 flex-col bg-background">
      {/* agent strip */}
      {agent && (
        <div className="flex min-w-0 items-center justify-between gap-2 border-b border-[--hair-border] bg-[#fcfcfc] px-4 py-2">
          <div className="flex min-w-0 flex-1 items-center gap-2 text-[12px] text-muted-foreground">
            <span
              className="inline-flex h-[18px] w-[18px] items-center justify-center rounded-sm font-mono text-[9px] font-semibold"
              style={{
                background: tint(AGENT_COLOR[agent.id] ?? "#111111", 0.12),
                color: AGENT_COLOR[agent.id] ?? "#111111",
              }}
            >
              {AGENT_MONO[agent.id] ?? "GA"}
            </span>
            <span className="min-w-0 truncate font-semibold text-foreground" title={agent.name}>{agent.name}</span>
            <span className="shrink-0 text-[#c4c4c4]">·</span>
            <span className="min-w-0 flex-1 truncate">{agent.blurb}</span>
          </div>
          <button
            type="button"
            onClick={() => onAgentChange("")}
            className="shrink-0 text-[13px] text-muted-foreground"
          >
            ✕
          </button>
        </div>
      )}

      {/* memory strip (M1 §14.3) */}
      {(threadSummary || projectId) && (
        <ThreadInfoStrip summary={threadSummary} onDeleteSummary={onDeleteSummary} />
      )}

      {messages.length === 0 ? (
        /* ── empty state ─────────────────────────────────────────────── */
        <div className="flex flex-1 flex-col items-center justify-center overflow-y-auto p-6">
          <div className="w-full max-w-[640px]">
            <div className="mb-5 flex items-center justify-center gap-2.5">
              <div className="h-7 w-7 rounded-sm bg-foreground" />
              <h2 className="m-0 text-[21px] font-semibold text-foreground">{greeting(userName)}</h2>
            </div>

            {!agent && (
              <div className="mb-[18px]">
                <p className={cn(KX_TIGHT, "mb-2 flex justify-center")}>Choose an agent</p>
                <div className="grid grid-cols-3 gap-2">
                  {AGENTS.map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => onAgentChange(a.id)}
                      className="rounded-sm border border-[--hair-border] bg-background p-2.5 text-left hover:bg-[#fcfcfc]"
                    >
                      <span
                        className="flex h-6 w-6 items-center justify-center rounded-sm font-mono text-[10px] font-semibold"
                        style={{
                          background: tint(AGENT_COLOR[a.id] ?? "#111111", 0.12),
                          color: AGENT_COLOR[a.id] ?? "#111111",
                        }}
                      >
                        {AGENT_MONO[a.id]}
                      </span>
                      <div className="mt-2 text-[13px] font-medium text-foreground">{a.name}</div>
                      <div className="mt-0.5 text-[11.5px] leading-[1.4] text-muted-foreground">{a.blurb}</div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {agent && (
              <div className="mb-2.5">
                <SuggestedActions
                  projectId={projectId}
                  threadId={serverThreadId}
                  threadMode={threadMode}
                  onPick={pickSuggestion}
                  disabled={loading}
                />
              </div>
            )}

            {composer}
            {error && (
              <div className="mt-2 rounded-sm border border-[#f0c7cb] bg-[#fdf2f3] px-3 py-2 text-[12.5px] text-[#8a2a30]">
                {error}
              </div>
            )}
          </div>
        </div>
      ) : (
        /* ── populated thread ────────────────────────────────────────── */
        <>
          <MessageStream
            messages={messages}
            loading={loading}
            error={error}
            threadMode={threadMode}
            onModeChange={onModeChange}
            containerClassName="mx-auto max-w-[740px] px-5 pb-7 pt-5"
          />

          <div className="border-t border-[--hair-border] bg-[#fcfcfc] px-4 py-3">
            <div className="mx-auto max-w-[740px]">
              <SuggestedActions
                projectId={projectId}
                threadId={serverThreadId}
                threadMode={threadMode}
                onPick={pickSuggestion}
                disabled={loading}
              />
              {composer}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
