// supply-chain schema tables aren't in the generated DB types yet.
/**
 * Project Intelligence (SureSuite visual language).
 *
 * Same data flow as the current page — useChatThreads for the thread store,
 * useProjectChat inside the workspace, list_projects RPC for the project
 * picker, route ↔ active-thread sync via ?thread=. What changed is the shell:
 *
 *  - PageHeader with NO subtitle (AdminLayout pattern).
 *  - The chat panel is a resizable/collapsible grid: drag the 5px handle
 *    (200–460px) or collapse to a 48px rail to reclaim workspace. Track count
 *    changes with the state (48px 1fr collapsed vs Wpx 5px 1fr open) —
 *    keeping three tracks while the handle is unmounted squeezes the
 *    workspace into the rail column.
 *  - Sidebar file/memory panels are layer-tinted disclosures (teal #14b8c4 /
 *    purple #7c3aed) so they cost 36px when closed.
 */
import React, { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { PageLayout } from "@/components/shared/PageLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { PAGE_GUTTER } from "@/components/shared/PageBody";
import { useIsMobile } from "@/hooks/use-is-mobile";
import { PanelLeft, X } from "lucide-react";
import { useGlobalProject, type Project } from "@/hooks/useGlobalProject";
import { useAuth } from "@/hooks/useAuth";
import { useCapabilities } from "@/hooks/useCapabilities";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { ChatSidebar } from "@/components/intelligence/ChatSidebar";
import { ChatWorkspace } from "@/components/intelligence/ChatWorkspace";
import { useChatThreads, QUICK_THREAD_ID } from "@/hooks/useChatThreads";
import { getStoredModel, setStoredModel } from "@/components/chat/ModelPicker";
import { fileWorkspaceUiEnabled, useUserFiles, expiryCountdown } from "@/hooks/useUserFiles";
import { useProjectMemory } from "@/hooks/useProjectMemory";

interface ProjectIntelligenceProps {
  isCollapsed: boolean;
  setIsCollapsed: (value: boolean) => void;
}

/** list_projects returns the same shape the global project selection stores,
 * which is why `match` can be handed straight to setSelectedProject. The RPC
 * postdates the generated Supabase types — that mismatch is what the
 * file-wide `@ts-nocheck` used to paper over, along with every real type
 * error in the file. Loosen only the one call that needs it. */
type ProjectRow = Project;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

const SIDEBAR_MIN = 200;
const SIDEBAR_MAX = 460;
const SIDEBAR_DEFAULT = 264;
const KEY_SIDEBAR_W = "projectIntelligence.sidebarWidth.v1";
const KEY_SIDEBAR_COLLAPSED = "projectIntelligence.sidebarCollapsed.v1";

const ProjectIntelligence: React.FC<ProjectIntelligenceProps> = ({ isCollapsed, setIsCollapsed }) => {
  const { user } = useAuth();
  const { can } = useCapabilities();
  const { setGlobalSelectedProjectId, setSelectedProject } = useGlobalProject();
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [input, setInput] = useState("");
  const [model, setModel] = useState(() => getStoredModel());
  const [searchParams, setSearchParams] = useSearchParams();

  // Chat-panel geometry (persisted so the working space survives reloads).
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    const raw = typeof window !== "undefined" ? window.localStorage.getItem(KEY_SIDEBAR_W) : null;
    const n = raw ? Number(raw) : NaN;
    return Number.isFinite(n) ? Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, n)) : SIDEBAR_DEFAULT;
  });
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(
    () => (typeof window !== "undefined" ? window.localStorage.getItem(KEY_SIDEBAR_COLLAPSED) === "1" : false),
  );
  const [resizing, setResizing] = useState(false);

  // Below md the three-column grid cannot work: at 390px a 264px sidebar plus
  // the 5px handle leaves the workspace ~120px, and the handle is mouse-only so
  // it can never be collapsed by touch. One column, sidebar as an overlay.
  const isMobile = useIsMobile();
  const [chatListOpen, setChatListOpen] = useState(false);

  const {
    threads,
    activeThread,
    activeThreadId,
    setActiveThread,
    newThread,
    deleteThread,
    updateThread,
    syncEnabled,
    folders,
    createFolder,
    deleteFolder,
    moveThreadToFolder,
    setPinned,
    setArchived,
    searchMessages,
    setThreadMode,
    clearThreadSummary,
    bulkSetThreadFlags,
    bulkMoveToFolder,
    bulkDeleteThreads,
    getServerThreadId,
  } = useChatThreads();

  const memoryProjectId = activeThread?.projectId ?? null;

  // Files / memory sources for the sidebar's two bottom panels. Files load for
  // ALL projects (projectId=null) so the panel's Project/All toggle can filter
  // client-side — projectId must be populated on each row or Project scopes to
  // nothing (see SidebarPanels.UserFile).
  const { files: rawFiles, keep: keepFile, download: downloadFile } = useUserFiles(null);
  const { entries: rawMemory, save: saveMemory, archive: archiveMemory } = useProjectMemory(memoryProjectId);

  const sidebarFiles = useMemo(
    () =>
      rawFiles.map((f) => ({
        id: f.id,
        projectId: f.project_id,
        name: f.name,
        kind: f.kind,
        expiresLabel: f.retained ? "kept" : expiryCountdown(f.expires_at),
        retained: f.retained,
      })),
    [rawFiles],
  );

  const sidebarMemory = useMemo(
    () => rawMemory.map((m) => ({ id: m.id, kindLabel: m.kind, content: m.content })),
    [rawMemory],
  );

  const handleDownloadFile = async (id: string) => {
    const err = await downloadFile(id);
    if (err) toast.error(err);
  };

  const handleKeepFile = async (id: string) => {
    const f = rawFiles.find((x) => x.id === id);
    if (!f) return;
    const err = await keepFile(id, !f.retained);
    if (err) toast.error(err);
  };

  const handleAddMemory = async (content: string) => {
    const err = await saveMemory({ content, kind: "fact", sourceThreadId: activeThreadId });
    if (err) toast.error(err);
  };

  const handleArchiveMemory = async (id: string) => {
    const err = await archiveMemory(id);
    if (err) toast.error(err);
  };

  useEffect(() => {
    if (!user) return;
    (async () => {
      try {
        const { data, error } = await db.rpc("list_projects", {
          p_user_id: user.id,
          p_user_email: user.email,
        });
        if (error) throw error;
        setProjects((data as ProjectRow[]) ?? []);
      } catch (e) {
        console.error(e);
        toast.error("Failed to load projects");
      }
    })();
  }, [user]);

  // Route ↔ active thread sync. Without a ?thread=, fall back to the most
  // recent real chat — the Quick chat pseudo-thread is no longer listed here
  // (it backs the floating bubble only) and is never selected by default.
  useEffect(() => {
    const urlThread = searchParams.get("thread");
    if (urlThread) {
      if (urlThread !== activeThreadId) setActiveThread(urlThread);
      return;
    }
    if (activeThreadId && activeThreadId !== QUICK_THREAD_ID) return;
    const mostRecent = threads.find((t) => !t.archived && t.id !== QUICK_THREAD_ID);
    if (mostRecent) setActiveThread(mostRecent.id);
    else if (activeThreadId) setActiveThread(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, threads]);

  // Keep the global project selector in sync with the active thread's project.
  useEffect(() => {
    if (!activeThread?.projectId) return;
    const match = projects.find((p) => p.id === activeThread.projectId);
    if (match) {
      setGlobalSelectedProjectId(activeThread.projectId);
      setSelectedProject(match);
    }
  }, [activeThread?.projectId, projects, setGlobalSelectedProjectId, setSelectedProject]);

  const persistWidth = (w: number) => {
    setSidebarWidth(w);
    try {
      window.localStorage.setItem(KEY_SIDEBAR_W, String(w));
    } catch {
      /* ignore */
    }
  };

  const setCollapsed = (v: boolean) => {
    setSidebarCollapsed(v);
    try {
      window.localStorage.setItem(KEY_SIDEBAR_COLLAPSED, v ? "1" : "0");
    } catch {
      /* ignore */
    }
  };

  const startResize = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = sidebarWidth;
    setResizing(true);
    const move = (ev: MouseEvent) => {
      const w = Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, startW + (ev.clientX - startX)));
      setSidebarWidth(w);
    };
    const up = (ev: MouseEvent) => {
      setResizing(false);
      persistWidth(Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, startW + (ev.clientX - startX))));
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  const handleSelectThread = (id: string) => {
    setActiveThread(id);
    setSearchParams({ thread: id }, { replace: true });
    // No-op above md, where the overlay never opens.
    setChatListOpen(false);
  };

  const handleNewThread = () => {
    const id = newThread();
    if (id) setSearchParams({ thread: id }, { replace: true });
    setChatListOpen(false);
  };

  const handleModelChange = (id: string) => {
    setModel(id);
    setStoredModel(id);
  };

  const handleAgentChange = (agentId: string) => {
    if (!activeThreadId) return;
    updateThread(activeThreadId, { agentId: agentId || null });
  };

  const handleProjectChange = (projectId: string | null) => {
    if (!activeThreadId) return;
    updateThread(activeThreadId, { projectId });
  };

  // The single ChatSidebar prop set. Both the desktop grid child and the mobile
  // overlay spread this, so the two instances can never drift apart; only the
  // collapse trio below differs, because only the desktop instance collapses.
  const sidebarProps = {
    projects,
    threads,
    activeThreadId,
    onSelectThread: handleSelectThread,
    onNewThread: handleNewThread,
    onDeleteThread: deleteThread,
    onRenameThread: (id: string, title: string) => updateThread(id, { title }),
    onAttachProject: (id: string, projectId: string | null) => updateThread(id, { projectId }),
    syncEnabled,
    folders,
    onCreateFolder: createFolder,
    onDeleteFolder: deleteFolder,
    onMoveToFolder: moveThreadToFolder,
    onTogglePin: setPinned,
    onToggleArchive: setArchived,
    onSearchMessages: searchMessages,
    memoryEnabled: can("project_memory"),
    memoryProjectId,
    filesEnabled: fileWorkspaceUiEnabled() && can("reports"),
    onBulkSetFlags: bulkSetThreadFlags,
    onBulkMoveToFolder: bulkMoveToFolder,
    onBulkDelete: bulkDeleteThreads,
    files: sidebarFiles,
    memoryEntries: sidebarMemory,
    onDownloadFile: handleDownloadFile,
    onKeepFile: handleKeepFile,
    onAddMemory: handleAddMemory,
    onArchiveMemory: handleArchiveMemory,
  };

  // full_name is Supabase auth user_metadata, absent from the generated User type.
  const fullName = (user as { user_metadata?: { full_name?: string } } | null)?.user_metadata?.full_name;
  const firstName = (fullName ?? user?.email ?? "").split(/[ @]/)[0];

  return (
    <PageLayout isCollapsed={isCollapsed} setIsCollapsed={setIsCollapsed}>
      <div className={PAGE_GUTTER}>
        {/* No subtitle — AdminLayout header pattern. */}
        <PageHeader
          title="Project Intelligence"
          rightContent={
            isMobile ? (
              <button
                type="button"
                onClick={() => setChatListOpen(true)}
                aria-label="Chats, files and memory"
                title="Chats, files and memory"
                className="grid h-11 w-11 shrink-0 place-items-center rounded-md border border-border bg-card text-foreground"
              >
                <PanelLeft className="h-4 w-4" />
              </button>
            ) : undefined
          }
        />

        <div
          className="grid overflow-hidden rounded-sm border border-[--hair-border] bg-background
                     h-[calc(100svh-var(--pi-chrome,210px))] min-h-[420px]
                     md:h-[calc(100vh-150px)] md:min-h-[560px]"
          style={{
            gridTemplateColumns: isMobile
              ? "minmax(0,1fr)"
              : sidebarCollapsed
                ? "48px minmax(0,1fr)"
                : sidebarWidth + "px 5px minmax(0,1fr)",
          }}
        >
          {/* Below md the sidebar is off-canvas. It is the SAME component with the
              same sidebarProps; only the collapse trio differs, and the overlay
              never collapses — its close button dismisses the drawer instead. */}
          {isMobile && chatListOpen && (
            <div className="fixed inset-0 z-[60] flex md:hidden" role="dialog" aria-modal="true">
              <div className="flex w-[86vw] max-w-[330px] flex-col bg-background shadow-xl">
                <div className="flex h-14 shrink-0 items-center gap-2 border-b border-border pl-3 pr-2">
                  <span className="flex-1 text-[13px] font-semibold">Chats</span>
                  <button
                    type="button"
                    onClick={() => setChatListOpen(false)}
                    aria-label="Close"
                    className="grid h-11 w-11 place-items-center rounded-md hover:bg-accent"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto">
                  <ChatSidebar
                    collapsed={false}
                    onCollapse={() => setChatListOpen(false)}
                    onExpand={() => setChatListOpen(true)}
                    {...sidebarProps}
                  />
                </div>
              </div>
              <button
                type="button"
                aria-label="Close"
                onClick={() => setChatListOpen(false)}
                className="flex-1 bg-foreground/30"
              />
            </div>
          )}

          {/* Exactly one ChatSidebar is mounted at any width — this branch above
              md, the overlay below it. display:contents keeps this one a DIRECT
              grid child; a plain wrapper would collapse the three tracks into
              one cell and squeeze the workspace into the sidebar column. */}
          {!isMobile && (
            <div className="contents">
              <ChatSidebar
                collapsed={sidebarCollapsed}
                onCollapse={() => setCollapsed(true)}
                onExpand={() => setCollapsed(false)}
                {...sidebarProps}
              />
            </div>
          )}

          {/* 6 · the handle is onMouseDown-only, so it never mounts below md. */}
          {!isMobile && !sidebarCollapsed && (
            <div
              onMouseDown={startResize}
              title="Drag to resize"
              className="cursor-col-resize border-r border-[--hair-border]"
              style={{ background: resizing ? "var(--hair-border)" : "transparent" }}
            />
          )}

          <ChatWorkspace
            threadId={activeThreadId}
            projectId={activeThread?.projectId ?? null}
            agentId={activeThread?.agentId ?? null}
            onAgentChange={handleAgentChange}
            onProjectChange={handleProjectChange}
            projects={projects}
            userName={firstName}
            input={input}
            onInputChange={setInput}
            model={model}
            onModelChange={handleModelChange}
            threadMode={activeThread?.mode ?? "review"}
            onModeChange={(m) => activeThreadId && setThreadMode(activeThreadId, m)}
            serverThreadId={activeThreadId ? getServerThreadId(activeThreadId) : null}
            threadSummary={activeThread?.summary ?? null}
            onDeleteSummary={() => activeThreadId && clearThreadSummary(activeThreadId)}
          />
        </div>
      </div>
    </PageLayout>
  );
};

export default ProjectIntelligence;
