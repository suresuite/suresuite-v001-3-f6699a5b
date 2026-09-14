/**
 * ChatWorkspace — chrome band, message stream, composer.
 *
 * Data flow is unchanged: useProjectChat(threadId) owns messages/loading/
 * error/send; this component only renders them. Empty threads show the agent
 * picker; populated threads show the stream with the composer docked below.
 *
 * THE BOTTOM-PIN CONTRACT (v1b space pass). This column is
 *
 *     flex column, min-h-0
 *       chrome band     shrink-0
 *       message stream  flex-1, min-h-0, overflow-y-auto   ← the ONLY flexible child
 *       composer        shrink-0
 *
 * and that is what keeps the composer on the bottom edge at every viewport
 * size: the stream absorbs all the slack and scrolls. Give the stream a fixed
 * height, or let the composer grow, and the composer walks up the panel on a
 * tall screen and off the bottom of it on a short one.
 *
 * The agent strip and the violet memory band used to be two stacked full-width
 * rows, ~60px of chrome above every conversation. They are one ~28px row now:
 * the memory band is a chip that opens SidebarPanels' MemoryPanel on demand,
 * and the row's far right carries the window-mode control.
 *
 * The min-w-0 on the column and the chrome band matters — without it a long
 * agent blurb widens the grid track and pushes the composer off-screen.
 */
import React from "react";
import { Brain, Maximize2, Minimize2 } from "lucide-react";
import { AGENTS, getAgent } from "@/lib/chat/agents";
import { useProjectChat } from "@/hooks/useProjectChat";
import { AGENT_COLOR, AGENT_MONO, KX_TIGHT, LAYER, READING_COL, Segmented, tint } from "./piUi";
import { ChatComposer } from "./ChatComposer";
import { MessageStream } from "./MessageStream";
import { MemoryPanel } from "./SidebarPanels";
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
  /** Window mode. The page owns the state (it owns the panel's positioning);
   *  the control lives here because the chrome band is where it belongs. */
  fullScreen?: boolean;
  onFullScreenChange?: (v: boolean) => void;
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
  fullScreen = false,
  onFullScreenChange = () => {},
}: ChatWorkspaceProps) {
  const { messages, loading, error, send } = useProjectChat(threadId);
  const agent = agentId ? getAgent(agentId) : null;
  const [memoryOpen, setMemoryOpen] = React.useState(false);
  const hasMemory = Boolean(threadSummary || projectId);
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
      {/* chrome band — agent, memory chip and window mode in ONE row */}
      <div className="flex min-w-0 shrink-0 items-center gap-2 border-b border-[--hair-border] bg-[#fcfcfc] py-[5px] pl-3.5 pr-2.5">
        {agent ? (
          <>
            <span
              className="inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-sm font-mono text-[9px] font-semibold"
              style={{
                background: tint(AGENT_COLOR[agent.id] ?? "#111111", 0.12),
                color: AGENT_COLOR[agent.id] ?? "#111111",
              }}
            >
              {AGENT_MONO[agent.id] ?? "GA"}
            </span>
            {/* min-w-0 truncate, not the prototype's flex-shrink:0: an agent
                name is interpolated text of no fixed width, and pinning it
                would push the memory chip and the window controls out of the
                band on a narrow workspace (adaptive-UI audit §2.5). It
                truncates before the blurb runs out, so the band's controls
                are always reachable. */}
            <span className="min-w-0 truncate text-[12px] font-semibold text-foreground" title={agent.name}>
              {agent.name}
            </span>
            <span className="shrink-0 text-[12px] text-[#c4c4c4]">·</span>
            <span className="min-w-0 flex-1 truncate text-[12px] text-muted-foreground">{agent.blurb}</span>
          </>
        ) : (
          /* No agent yet — the band still carries the window control, so the
             slack has to come from somewhere. */
          <span className="min-w-0 flex-1" />
        )}

        {hasMemory && (
          <button
            type="button"
            onClick={() => setMemoryOpen((v) => !v)}
            aria-expanded={memoryOpen}
            title="What the assistant remembers"
            className="inline-flex shrink-0 items-center gap-1 rounded-sm px-1.5 py-px text-[11px]"
            style={{
              background: tint(LAYER.product, memoryOpen ? 0.14 : 0.07),
              color: LAYER.product,
            }}
          >
            <Brain className="h-[11px] w-[11px]" />
            Memory
          </button>
        )}

        <Segmented
          size="icon"
          className="shrink-0"
          ariaLabel="Window mode"
          value={fullScreen ? "full" : "app"}
          onChange={(v) => onFullScreenChange(v === "full")}
          options={[
            { value: "app", label: "Fit to the SuReSuite app screen", icon: <Minimize2 className="h-3 w-3" /> },
            { value: "full", label: "Full screen", icon: <Maximize2 className="h-3 w-3" /> },
          ]}
        />

        {agent && (
          <button
            type="button"
            onClick={() => onAgentChange("")}
            title="Clear the agent"
            aria-label="Clear the agent"
            className="shrink-0 text-[12px] text-[#b8b8b8] hover:text-foreground"
          >
            ✕
          </button>
        )}
      </div>

      {/* the band the memory chip replaced, on demand (M1 §14.3) */}
      {hasMemory && memoryOpen && <MemoryPanel summary={threadSummary} onDeleteSummary={onDeleteSummary} />}

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
            mergedMeta
            containerClassName={cn(READING_COL, "gap-3 px-4 pb-4 pt-3.5")}
          />

          <div className="shrink-0 border-t border-[--hair-border] bg-[#fcfcfc] px-4 py-2">
            <div className={READING_COL}>
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
