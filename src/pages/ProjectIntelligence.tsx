// @ts-nocheck — mirrors src/pages/ProjectIntelligence.tsx: the underlying
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
import { useGlobalProject } from "@/hooks/useGlobalProject";
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

const SIDEBAR_MIN = 200;
const SIDEBAR_MAX = 460;
const SIDEBAR_DEFAULT = 264;
const KEY_SIDEBAR_W = "projectIntelligence.sidebarWidth.v1";
const KEY_SIDEBAR_COLLAPSED = "projectIntelligence.sidebarCollapsed.v1";

const ProjectIntelligence: React.FC<ProjectIntelligenceProps> = ({ isCollapsed, setIsCollapsed }) => {
  const { user } = useAuth();
  const { can } = useCapabilities();
  const { setGlobalSelectedProjectId, setSelectedProject } = useGlobalProject();
  const [projects, setProjects] = useState<any[]>([]);
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
        const { data, error } = await supabase.rpc("list_projects", {
          p_user_id: user.id,
          p_user_email: user.email,
        });
        if (error) throw error;
        setProjects(data || []);
      } catch (e) {
        console.error(e);
        toast.error("Failed to load projects");
      }
    })();
  }, [user]);

  // Route ↔ active thread sync.
  useEffect(() => {
    const urlThread = searchParams.get("thread");
    if (urlThread) {
      if (urlThread !== activeThreadId) setActiveThread(urlThread);
    } else if (!activeThreadId) {
      setActiveThread(QUICK_THREAD_ID);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

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
  };

  const handleNewThread = () => {
    const id = newThread();
    if (id) setSearchParams({ thread: id }, { replace: true });
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

  const firstName = (user?.user_metadata?.full_name ?? user?.email ?? "").split(/[ @]/)[0];

  return (
    <PageLayout isCollapsed={isCollapsed} setIsCollapsed={setIsCollapsed}>
      <div className="px-12 py-6">
        {/* No subtitle — AdminLayout header pattern. */}
        <PageHeader title="Project Intelligence" />

        <div
          className="grid h-[calc(100vh-150px)] min-h-[560px] overflow-hidden rounded-sm border border-[--hair-border] bg-background"
          style={{
            gridTemplateColumns: sidebarCollapsed ? "48px 1fr" : sidebarWidth + "px 5px 1fr",
          }}
        >
          <ChatSidebar
            collapsed={sidebarCollapsed}
            onCollapse={() => setCollapsed(true)}
            onExpand={() => setCollapsed(false)}
            projects={projects}
            threads={threads}
            activeThreadId={activeThreadId}
            onSelectThread={handleSelectThread}
            onNewThread={handleNewThread}
            onDeleteThread={deleteThread}
            onRenameThread={(id, title) => updateThread(id, { title })}
            onAttachProject={(id, projectId) => updateThread(id, { projectId })}
            syncEnabled={syncEnabled}
            folders={folders}
            onCreateFolder={createFolder}
            onDeleteFolder={deleteFolder}
            onMoveToFolder={moveThreadToFolder}
            onTogglePin={setPinned}
            onToggleArchive={setArchived}
            onSearchMessages={searchMessages}
            memoryEnabled={can("project_memory")}
            memoryProjectId={memoryProjectId}
            filesEnabled={fileWorkspaceUiEnabled() && can("reports")}
            onBulkSetFlags={bulkSetThreadFlags}
            onBulkMoveToFolder={bulkMoveToFolder}
            onBulkDelete={bulkDeleteThreads}
            files={sidebarFiles}
            memoryEntries={sidebarMemory}
            onDownloadFile={handleDownloadFile}
            onKeepFile={handleKeepFile}
            onAddMemory={handleAddMemory}
            onArchiveMemory={handleArchiveMemory}
          />

          {!sidebarCollapsed && (
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
            threadSummary={activeThread?.summary ?? null}
            onDeleteSummary={() => activeThreadId && clearThreadSummary(activeThreadId)}
          />
        </div>
      </div>
    </PageLayout>
  );
};

export default ProjectIntelligence;
