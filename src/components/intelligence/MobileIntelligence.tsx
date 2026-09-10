/**
 * Project Intelligence — the phone tree (PAGES.md 16 · 17, mobile-ui-spec §4.4).
 *
 * WHY A SEPARATE TREE, not `md:` classes on ChatWorkspace. Below 768px this is
 * a different composition, not a reflow of the desktop one: the page title,
 * the agent strip, the memory strip, the suggestion chips and the composer's
 * four controls all fold into a chat header, a ⋯ menu and two composer
 * buttons — the ~150px of chrome the demo reclaims for the conversation, which
 * on a phone IS the product. `use-is-mobile.ts` reserves the hook for exactly
 * this case (a different component tree), and the desktop tree is untouched.
 *
 * What it does NOT own: messages, threads, files, memory and suggestions all
 * arrive as props or through the same hooks the desktop page already mounts,
 * so this adds no query and no state shape. The message stream itself is the
 * shared MessageStream, so all nine part kinds render identically on both
 * platforms.
 *
 * Sheet catalogue (all through the one MobileSheet shell):
 *   chats · agents · this chat → project / model / mode · suggested actions ·
 *   ⋯ menu → summary / how memory works / project memory / my files / rename.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUp, ChevronDown, Lightbulb, Maximize2, MessageSquare, Minimize2, MoreVertical } from "lucide-react";
import { AGENTS, getAgent } from "@/lib/chat/agents";
import { useProjectChat } from "@/hooks/useProjectChat";
import type { Thread } from "@/hooks/useChatThreads";
import { CHAT_MODELS, getModelLabel } from "@/components/chat/ModelPicker";
import { AUTO_TOOLTIP, chatModesUiEnabled } from "@/components/chat/ModeSwitch";
import { useCapabilities } from "@/hooks/useCapabilities";
import { MobileSheet, MobileSheetRow } from "@/components/shared/MobileSheet";
import { PAGE_HEADER_SHELL } from "@/components/shared/PageHeader";
import { M, M_LABEL, M_MICRO, MobilePanel, MobileRow } from "@/components/mobile";
import { AGENT_COLOR, AGENT_MONO } from "./piUi";
import { ChatSidebar } from "./ChatSidebar";
import { MessageStream } from "./MessageStream";
import { MyFilesPanel, ProjectMemoryPanel, type MemoryEntry, type UserFile } from "./SidebarPanels";
import { useSuggestedActions } from "./SuggestedActions";
import { cn } from "@/lib/utils";

/** Every sheet this screen can show. `null` is the conversation itself. */
type Sheet =
  | "chats"
  | "agents"
  | "setup"
  | "projects"
  | "models"
  | "mode"
  | "suggest"
  | "menu"
  | "summary"
  | "explainer"
  | "memory"
  | "files"
  | "rename"
  | null;

/** Composer heights (the demo's): collapsed grows 44→120, expanded 150→260. */
const COLLAPSED_MIN = 44;
const COLLAPSED_MAX = 120;
const EXPANDED_MIN = 150;
const EXPANDED_MAX = 260;

interface MobileIntelligenceProps {
  threads: Thread[];
  activeThread: Thread | null;
  activeThreadId: string | null;
  projects: Array<{ id: string; name: string }>;
  projectId: string | null;
  agentId: string | null;
  model: string;
  threadMode: "ask" | "review";
  serverThreadId: string | null;
  threadSummary: string | null;
  userName: string;
  input: string;
  onInputChange: (v: string) => void;
  onAgentChange: (id: string) => void;
  onProjectChange: (id: string | null) => void;
  onModelChange: (id: string) => void;
  onModeChange: (m: "ask" | "review") => void;
  onNewThread: () => void;
  onRenameThread: (id: string, title: string) => void;
  onDeleteThread: (id: string) => void;
  onDeleteSummary: () => void;
  /** Files and memory are already loaded by the page — passed, never refetched. */
  files: UserFile[];
  memoryEntries: MemoryEntry[];
  filesEnabled: boolean;
  memoryEnabled: boolean;
  onDownloadFile: (id: string) => void;
  onKeepFile: (id: string) => void;
  onAddMemory: (content: string) => void;
  onArchiveMemory: (id: string) => void;
  /** The one ChatSidebar prop set the page builds; the Chats sheet renders it. */
  sidebar: Omit<React.ComponentProps<typeof ChatSidebar>, "collapsed" | "onCollapse" | "onExpand">;
}

const greeting = (name: string) => {
  const h = new Date().getHours();
  const part = h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
  return name ? part + ", " + name : part;
};

export function MobileIntelligence(props: MobileIntelligenceProps) {
  const {
    activeThread,
    activeThreadId,
    projects,
    projectId,
    agentId,
    model,
    threadMode,
    serverThreadId,
    threadSummary,
    userName,
    input,
    onInputChange,
    onAgentChange,
    onProjectChange,
    onModelChange,
    onModeChange,
    onNewThread,
    onRenameThread,
    onDeleteThread,
    onDeleteSummary,
    files,
    memoryEntries,
    filesEnabled,
    memoryEnabled,
    onDownloadFile,
    onKeepFile,
    onAddMemory,
    onArchiveMemory,
    sidebar,
  } = props;

  const { messages, loading, error, send } = useProjectChat(activeThreadId);
  const { isModelAllowed } = useCapabilities();
  const { suggestions, recordClick } = useSuggestedActions({
    projectId,
    threadId: serverThreadId,
    threadMode,
  });

  const [sheet, setSheet] = useState<Sheet>(null);
  const [expanded, setExpanded] = useState(false);
  const [filesScope, setFilesScope] = useState<"project" | "all">("project");
  const [renameDraft, setRenameDraft] = useState("");
  const taRef = useRef<HTMLTextAreaElement | null>(null);

  const agent = agentId ? getAgent(agentId) : null;
  const modesOn = chatModesUiEnabled();
  const closeSheet = () => setSheet(null);

  /* ── composer auto-grow ──────────────────────────────────────────────
     Do NOT put a static height in the style prop — React re-applies it on
     every render and clobbers the imperative resize (same rule as the
     desktop ChatComposer). */
  const resize = useCallback(() => {
    const el = taRef.current;
    if (!el) return;
    const max = expanded ? EXPANDED_MAX : COLLAPSED_MAX;
    const min = expanded ? EXPANDED_MIN : COLLAPSED_MIN;
    el.style.height = "auto";
    el.style.height = Math.max(min, Math.min(el.scrollHeight, max)) + "px";
    el.style.overflowY = el.scrollHeight > max ? "auto" : "hidden";
  }, [expanded]);

  useEffect(() => {
    resize();
  }, [input, expanded, resize]);

  const submit = () => {
    const text = input.trim();
    if (!text || loading) return;
    onInputChange("");
    void send(text, { model, projectId, agentId });
  };

  const project = projects.find((p) => p.id === projectId) ?? null;
  const setupLabel =
    (project ? project.name : "No project") +
    " · " +
    getModelLabel(model) +
    (modesOn ? " · " + (threadMode === "review" ? "Review" : "Ask") : "");

  // Same allowlist rule as ModelPicker: only permitted models, but never hide
  // the current value or the sheet cannot show what is selected.
  const visibleModels = CHAT_MODELS.filter((m) => isModelAllowed(m.id).ok || m.id === model);
  const modelOptions = visibleModels.length > 0 ? visibleModels : CHAT_MODELS;

  const canSend = Boolean(input.trim()) && !loading;
  const threadTitle = activeThread?.title ?? "New chat";

  /* ── header ──────────────────────────────────────────────────────── */
  const header = (
    // Same chrome as every other page (PAGE_HEADER_SHELL/_ROW). It used to
    // carry a hand-rolled copy: #fafafa instead of the header tint - a literal
    // that ignores the dark theme - --hair-border instead of the header rule,
    // and a bespoke gutter clamp that put this screen's left edge ~2px inboard
    // of every other header. `shrink-0` stays: this header is a flex child of
    // the fixed-height chat column, not a page-flow element.
    <header
      className={cn(
        PAGE_HEADER_SHELL,
        // The skin's header sits ON the canvas: no rule, no blur, no tint of
        // its own, a flat 16px gutter, and a ~46px band (§4).
        "shrink-0 border-b-0 bg-[hsl(var(--m-canvas))] backdrop-blur-none",
        "flex min-h-[46px] items-center gap-2 px-4 py-1.5",
      )}
    >
      <button
        type="button"
        onClick={() => setSheet("chats")}
        aria-label="Chats"
        title="Chats"
        className="-ml-1.5 grid h-11 w-11 shrink-0 place-items-center text-[#18181b]"
      >
        <MessageSquare className="h-[18px] w-[18px]" />
      </button>

      <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
        {/* An <h1>, not a <span>: this is the page title on this route, and it
            was the one app screen that rendered no h1 at all. */}
        <h1
          className="min-w-0 truncate text-[length:var(--fs-title)] font-semibold leading-tight tracking-[-0.019em] text-[#171717]"
          title={threadTitle}
        >
          {threadTitle}
        </h1>
        {/* §2.4: padding grows the hit area to 44px, the negative margin
            returns the space so the line sits exactly where it looks. */}
        <button
          type="button"
          onClick={() => setSheet("agents")}
          aria-label={agent ? agent.name + " — change agent" : "Choose an agent"}
          className="-my-[11px] flex min-h-11 max-w-full items-center gap-1.5 self-start py-[11px]"
        >
          {/* The agent badge is the skin's mono chip: a filled 3px tag, the
              largest a colour fill is allowed to get (§3, §7). */}
          <span
            className="shrink-0 rounded-[3px] px-1.5 py-0.5 font-mono text-[10px] font-semibold text-white"
            style={{ background: agent ? AGENT_COLOR[agent.id] ?? M.ink : M.quiet }}
          >
            {agent ? AGENT_MONO[agent.id] ?? "GA" : "··"}
          </span>
          <span className={cn(M_MICRO, "min-w-0 truncate")}>
            {agent ? agent.name : "Choose an agent"}
          </span>
          {modesOn && threadMode === "review" && (
            <span className={cn(M_MICRO, "shrink-0 whitespace-nowrap")}>· review</span>
          )}
          <ChevronDown className="h-3 w-3 shrink-0 text-[#525252]" />
        </button>
      </div>

      <button
        type="button"
        onClick={() => setSheet("menu")}
        aria-label="Chat options"
        title="Chat options"
        className="-mr-1.5 grid h-11 w-11 shrink-0 place-items-center text-[#18181b]"
      >
        <MoreVertical className="h-[18px] w-[18px]" />
      </button>
    </header>
  );

  /* ── empty state ─────────────────────────────────────────────────── */
  const emptyState = (
    <div className="flex min-h-full flex-col justify-center gap-3 px-4 py-5">
      <div className="flex items-center justify-center gap-2.5">
        <span className="h-[26px] w-[26px] rounded-[4px] bg-[#18181b]" />
        <span className="text-[length:var(--fs-title)] font-semibold tracking-[-0.019em] text-[#171717]">
          {greeting(userName)}
        </span>
      </div>
      {/* The agent picker was a 2-up grid of bordered cards — a second
          container style, which the skin does not have (§12). It is one panel
          of rows now: badge, name, blurb, and the "needs project" chip where
          it applies. Same agents, same order, same handler. */}
      {/* The screen's one ink head: with no thread open, choosing the agent
          IS the screen (v2 §2). The per-agent colour rides the row badge, so
          the panel takes no accent of its own. */}
      <MobilePanel tone="primary" label="Choose an agent" counter={`${AGENTS.length}`}>
        {AGENTS.map((a) => (
          <MobileRow
            key={a.id}
            onClick={() => onAgentChange(a.id)}
            chevron={false}
            dot={a.id === agentId ? M.ink : undefined}
            leading={
              <span
                className="shrink-0 rounded-[3px] px-1.5 py-0.5 font-mono text-[10px] font-semibold text-white"
                style={{ background: AGENT_COLOR[a.id] ?? M.ink }}
              >
                {AGENT_MONO[a.id]}
              </span>
            }
            label={a.name}
            sub={a.blurb}
            trailing={
              a.requiresProject ? (
                <span
                  className={cn(
                    M_LABEL,
                    "shrink-0 whitespace-nowrap rounded-[3px] border border-[#d4d4d4] px-1.5 py-0.5 text-[#525252]",
                  )}
                >
                  needs project
                </span>
              ) : undefined
            }
          />
        ))}
      </MobilePanel>
    </div>
  );

  /* ── composer ────────────────────────────────────────────────────── */
  const composer = (
    <div className="shrink-0 border-t border-[#d4d4d4] bg-white px-[var(--m-gutter)] py-2.5">
      {/* §7 gives the composer the pill radius. It holds a textarea over a
          control row rather than the reference's single line, so the corners
          are 22px — a pill at the collapsed height, and still reading as one
          at the expanded one. */}
      <div className="rounded-[22px] border border-[#18181b] bg-white">
        <textarea
          ref={taRef}
          rows={2}
          value={input}
          onChange={(e) => onInputChange(e.target.value)}
          placeholder={agent ? "Ask the " + agent.name + "…" : "How can I help you today?"}
          className="block w-full resize-none border-none bg-transparent px-4 pb-[9px] pt-[13px] text-[14.5px] leading-[1.5] text-[#18181b] outline-none placeholder:text-[#525252]"
          style={{ minHeight: COLLAPSED_MIN, overflow: "hidden" }}
        />
        <div className="flex items-center gap-1.5 border-t border-t-[#e8e8ea] px-2 py-1.5">
          {/* The one control row: project · model · mode as a single chip. */}
          <button
            type="button"
            onClick={() => setSheet("setup")}
            title={setupLabel}
            className="flex min-h-11 min-w-0 flex-1 items-center gap-1.5 px-1 text-[#525252]"
          >
            <span className={cn(M_MICRO, "min-w-0 flex-1 truncate text-left")}>{setupLabel}</span>
            <ChevronDown className="h-3 w-3 shrink-0 text-[#525252]" />
          </button>

          {suggestions.length > 0 && (
            <button
              type="button"
              onClick={() => setSheet("suggest")}
              aria-label="Suggested actions"
              title="Suggested actions"
              className="grid h-11 w-11 shrink-0 place-items-center text-[#525252]"
            >
              <Lightbulb className="h-4 w-4" />
            </button>
          )}

          <button
            type="button"
            onClick={() => {
              setExpanded((v) => !v);
              requestAnimationFrame(() => taRef.current?.focus());
            }}
            aria-label={expanded ? "Collapse composer" : "Expand composer for longer input"}
            title={expanded ? "Collapse composer" : "Expand composer for longer input"}
            className={cn(
              "grid h-11 w-11 shrink-0 place-items-center",
              expanded ? "text-[#18181b]" : "text-[#525252]",
            )}
          >
            {expanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </button>

          <button
            type="button"
            onClick={submit}
            disabled={!canSend}
            aria-label="Send"
            // The reference's 32px send disc, inside a 44px hit area so the
            // touch floor holds without growing the circle.
            className="grid h-11 w-11 shrink-0 place-items-center"
          >
            <span
              className={cn(
                "grid h-8 w-8 place-items-center rounded-full",
                canSend ? "bg-[#18181b] text-white" : "cursor-default bg-[#d4d4d4] text-[#6b6b6b]",
              )}
            >
              <ArrowUp className="h-4 w-4" />
            </span>
          </button>
        </div>
      </div>
    </div>
  );

  /* ── sheets ──────────────────────────────────────────────────────── */
  const backToSetup = () => setSheet("setup");
  const backToMenu = () => setSheet("menu");

  const sheets = (
    <>
      <MobileSheet
        open={sheet === "chats"}
        title="Chats"
        sub="Folders group related chats — tap a folder to open or close it."
        onClose={closeSheet}
      >
        {/* The SAME ChatSidebar the desktop grid mounts, so the thread list,
            search, folders and per-row actions cannot drift. Files and memory
            are switched off here — they are their own sheets in the ⋯ menu. */}
        <div className="h-full [&>aside]:border-r-0">
          <ChatSidebar
            {...sidebar}
            collapsed={false}
            collapsible={false}
            onCollapse={closeSheet}
            onExpand={closeSheet}
            filesEnabled={false}
            memoryEnabled={false}
            onSelectThread={(id) => {
              sidebar.onSelectThread(id);
              closeSheet();
            }}
            onNewThread={() => {
              onNewThread();
              closeSheet();
            }}
          />
        </div>
      </MobileSheet>

      <MobileSheet open={sheet === "agents"} title="Choose an agent" onClose={closeSheet}>
        {AGENTS.map((a) => (
          <MobileSheetRow
            key={a.id}
            mono={AGENT_MONO[a.id]}
            monoColor={AGENT_COLOR[a.id]}
            title={a.name}
            meta={a.blurb}
            tag={a.requiresProject ? "project" : undefined}
            checked={a.id === agentId}
            onClick={() => {
              onAgentChange(a.id);
              closeSheet();
            }}
          />
        ))}
      </MobileSheet>

      <MobileSheet open={sheet === "setup"} title="This chat" onClose={closeSheet}>
        <MobileSheetRow
          title="Project"
          meta={project ? project.name : "None attached"}
          onClick={() => setSheet("projects")}
        />
        <MobileSheetRow title="Model" meta={getModelLabel(model)} onClick={() => setSheet("models")} />
        {modesOn && (
          <MobileSheetRow
            title="Mode"
            meta={threadMode === "review" ? "Review — proposals can be approved" : "Ask — nothing is changed"}
            onClick={() => setSheet("mode")}
          />
        )}
      </MobileSheet>

      <MobileSheet
        open={sheet === "projects"}
        title="Attach a project"
        sub="Grounds every answer in that project’s data."
        onClose={closeSheet}
        onBack={backToSetup}
      >
        <MobileSheetRow
          title="No project"
          meta="General questions only"
          checked={!projectId}
          onClick={() => {
            onProjectChange(null);
            setSheet("setup");
          }}
        />
        {projects.map((p) => (
          <MobileSheetRow
            key={p.id}
            title={p.name}
            checked={p.id === projectId}
            onClick={() => {
              onProjectChange(p.id);
              setSheet("setup");
            }}
          />
        ))}
      </MobileSheet>

      <MobileSheet open={sheet === "models"} title="Model" onClose={closeSheet} onBack={backToSetup}>
        {modelOptions.map((m) => (
          <MobileSheetRow
            key={m.id}
            title={m.label}
            meta={m.id}
            checked={m.id === model}
            onClick={() => {
              onModelChange(m.id);
              setSheet("setup");
            }}
          />
        ))}
      </MobileSheet>

      <MobileSheet
        open={sheet === "mode"}
        title="Mode"
        sub="Ask and Review are the real modes. Auto is shown so you know it exists."
        onClose={closeSheet}
        onBack={backToSetup}
      >
        <MobileSheetRow
          title="Ask"
          meta="Answers and drafts only — nothing in the project changes."
          checked={threadMode === "ask"}
          onClick={() => {
            onModeChange("ask");
            setSheet("setup");
          }}
        />
        <MobileSheetRow
          title="Review"
          meta="Proposals can be approved; every write is still yours to confirm."
          checked={threadMode === "review"}
          onClick={() => {
            onModeChange("review");
            setSheet("setup");
          }}
        />
        {/* Auto does not exist (§10 Q23) — visible, disabled, explained. */}
        <MobileSheetRow
          title="Auto"
          meta="Auto isn’t available: it unlocks only after sustained accepted-proposal rates, org opt-in, and resolved identities."
          tag="locked"
          disabled
          hint={AUTO_TOOLTIP}
          onClick={() => {}}
        />
      </MobileSheet>

      <MobileSheet
        open={sheet === "suggest"}
        title="Suggested actions"
        sub="Computed from your project — each one sends a sentence you could have typed."
        onClose={closeSheet}
      >
        {suggestions.map((s) => (
          <MobileSheetRow
            key={s.rule}
            title={s.label}
            meta={s.reason}
            hint={s.reason}
            onClick={() => {
              recordClick(s);
              onInputChange("");
              closeSheet();
              void send(s.utterance, { model, projectId, agentId });
            }}
          />
        ))}
      </MobileSheet>

      <MobileSheet open={sheet === "menu"} title="Chat" onClose={closeSheet}>
        {/* Both memories and the file workspace are project-scoped — the
            sidebar mounts their panels only with a project attached, and these
            rows follow the same condition rather than opening an empty sheet. */}
        {memoryEnabled && projectId && (
          <>
            <MobileSheetRow
              title="What it remembers here"
              meta="The rolling summary of older turns in this chat"
              onClick={() => setSheet(threadSummary ? "summary" : "explainer")}
            />
            <MobileSheetRow
              title="How memory works"
              meta="Two kinds of memory, and what you control"
              onClick={() => setSheet("explainer")}
            />
            <MobileSheetRow
              title="Project memory"
              meta="Facts, preferences and decisions for the whole project"
              onClick={() => setSheet("memory")}
            />
          </>
        )}
        {filesEnabled && projectId && (
          <MobileSheetRow
            title="My files"
            meta="Rendered reports and exports — kept 14 days unless you Keep them"
            onClick={() => setSheet("files")}
          />
        )}
        {activeThreadId && (
          <>
            <MobileSheetRow
              title="Rename chat"
              meta={threadTitle}
              onClick={() => {
                setRenameDraft(threadTitle);
                setSheet("rename");
              }}
            />
            <MobileSheetRow
              title="Delete chat"
              meta="Removes the chat and its summary"
              danger
              onClick={() => {
                onDeleteThread(activeThreadId);
                closeSheet();
              }}
            />
          </>
        )}
      </MobileSheet>

      <MobileSheet
        open={sheet === "summary"}
        title="What it remembers here"
        sub="Used only to keep older context in this conversation — never as a source of facts."
        onClose={closeSheet}
        onBack={backToMenu}
      >
        <div className="px-3.5 py-3">
          <p className="text-[13.5px] leading-[1.6] text-muted-foreground [text-wrap:pretty]">
            {threadSummary}
          </p>
          <button
            type="button"
            onClick={() => {
              onDeleteSummary();
              closeSheet();
            }}
            className="mt-3 flex min-h-11 w-full items-center justify-center rounded-sm border border-[--hair-border] bg-background text-[13.5px] text-muted-foreground"
          >
            Delete summary
          </button>
        </div>
      </MobileSheet>

      <MobileSheet open={sheet === "explainer"} title="How memory works" onClose={closeSheet} onBack={backToMenu}>
        <div className="px-3.5 py-3 text-[13.5px] leading-[1.6] text-muted-foreground [text-wrap:pretty]">
          The assistant keeps two kinds of memory, and you control both:{" "}
          <strong className="font-semibold text-foreground">this conversation</strong> keeps a rolling summary you can
          delete any time, and <strong className="font-semibold text-foreground">project memory</strong> stores facts,
          preferences and decisions for the whole project. Writes are consent-only, every entry is visible with its
          source, and it is cited whenever it informs an answer.
        </div>
      </MobileSheet>

      <MobileSheet
        open={sheet === "memory"}
        title="Project memory"
        sub="Everything the assistant remembers for this project — visible per entry, with its source."
        onClose={closeSheet}
        onBack={backToMenu}
      >
        <ProjectMemoryPanel
          variant="sheet"
          entries={memoryEntries}
          onAdd={onAddMemory}
          onArchive={onArchiveMemory}
        />
      </MobileSheet>

      <MobileSheet
        open={sheet === "files"}
        title="My files"
        sub="Rendered reports and exports — kept 14 days unless you Keep them."
        onClose={closeSheet}
        onBack={backToMenu}
      >
        {/* Same rule as ChatSidebar's scopedFiles: with no project attached,
            "This project" cannot narrow anything, so it shows everything
            rather than an empty list. */}
        <MyFilesPanel
          variant="sheet"
          files={filesScope === "project" && projectId ? files.filter((f) => f.projectId === projectId) : files}
          scope={filesScope}
          onScopeChange={setFilesScope}
          onDownload={onDownloadFile}
          onKeep={onKeepFile}
        />
      </MobileSheet>

      <MobileSheet open={sheet === "rename"} title="Rename chat" onClose={closeSheet} onBack={backToMenu}>
        <div className="flex flex-col gap-2.5 px-3.5 py-3">
          <input
            autoFocus
            value={renameDraft}
            onChange={(e) => setRenameDraft(e.target.value)}
            aria-label="Chat name"
            className="min-h-11 w-full rounded-sm border border-[--hair-border] px-2.5 text-[14px] text-foreground outline-none focus:border-foreground"
          />
          <button
            type="button"
            onClick={() => {
              const v = renameDraft.trim();
              if (v && activeThreadId) onRenameThread(activeThreadId, v);
              closeSheet();
            }}
            className="flex min-h-11 w-full items-center justify-center rounded-sm bg-foreground text-[13.5px] font-semibold text-background"
          >
            Save
          </button>
        </div>
      </MobileSheet>
    </>
  );

  return (
    // --pi-chrome is published by PageLayout: the measured bottom reservation
    // plus this page's gutter. The fallback only covers the first paint before
    // the credit bar is measured.
    <div className="relative flex h-[calc(100svh-var(--pi-chrome,170px))] min-h-[420px] flex-col overflow-hidden bg-white">
      {header}

      {messages.length === 0 ? (
        <div className="min-h-0 flex-1 overflow-y-auto bg-[hsl(var(--m-canvas))]">
          {emptyState}
          {error && (
            <div className="mx-4 mb-4 flex gap-2.5 rounded-[4px] border border-[#e0930b] bg-[#e0930b1f] px-3 py-[11px]">
              <span aria-hidden className="shrink-0 font-mono text-[12px] leading-[1.3] text-[#6b4405]">
                !
              </span>
              <p className="m-0 text-[12.5px] leading-[1.5] text-[#6b4405] [text-wrap:pretty]">
                {error}
              </p>
            </div>
          )}
        </div>
      ) : (
        <MessageStream
          messages={messages}
          loading={loading}
          error={error}
          threadMode={threadMode}
          onModeChange={onModeChange}
          // §2: the thread canvas is white — the conversation IS the page
          // here, so it gets the panel interior rather than the page ground.
          className="bg-white"
          containerClassName="px-4 pb-[18px] pt-3.5"
          userBubbleClassName="rounded-[16px] rounded-br-[4px] px-3.5 py-2.5 text-[14.5px] leading-[1.5]"
        />
      )}

      {composer}
      {sheets}
    </div>
  );
}
