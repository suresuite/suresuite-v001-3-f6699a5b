// @ts-nocheck — the underlying supply-chain schema tables aren't in this project yet.
import React, { useEffect, useState } from "react";
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

interface ProjectIntelligenceProps {
  isCollapsed: boolean;
  setIsCollapsed: (value: boolean) => void;
}

const ProjectIntelligence: React.FC<ProjectIntelligenceProps> = ({
  isCollapsed,
  setIsCollapsed,
}) => {
  const { user } = useAuth();
  const { can } = useCapabilities();
  const { setGlobalSelectedProjectId, setSelectedProject } = useGlobalProject();
  const [projects, setProjects] = useState<any[]>([]);
  const [input, setInput] = useState("");
  const [model, setModel] = useState(() => getStoredModel());
  const [searchParams, setSearchParams] = useSearchParams();

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
  } = useChatThreads();

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

  // Keep global project selector in sync with the active thread's project.
  useEffect(() => {
    if (!activeThread?.projectId) return;
    const match = projects.find((p) => p.id === activeThread.projectId);
    if (match) {
      setGlobalSelectedProjectId(activeThread.projectId);
      setSelectedProject(match);
    }
  }, [activeThread?.projectId, projects, setGlobalSelectedProjectId, setSelectedProject]);

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
        <PageHeader
          title="Project Intelligence"
          subtitle="Your on-demand supply-chain colleague"
        />

        <div className="grid h-[calc(100vh-160px)] min-h-[560px] grid-cols-[260px_1fr] overflow-hidden rounded-xl border border-border bg-background shadow-xs">
          <ChatSidebar
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
            memoryProjectId={activeThread?.projectId ?? null}
          />
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
          />
        </div>
      </div>
    </PageLayout>
  );
};

export default ProjectIntelligence;
