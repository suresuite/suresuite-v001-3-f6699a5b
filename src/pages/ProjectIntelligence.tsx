// @ts-nocheck — the underlying supply-chain schema tables aren't in this project yet.
import React, { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { PageLayout } from "@/components/shared/PageLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { useGlobalProject } from "@/hooks/useGlobalProject";
import { useAuth } from "@/hooks/useAuth";
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
  const { globalSelectedProjectId, selectedProject, setGlobalSelectedProjectId, setSelectedProject } =
    useGlobalProject();
  const { user } = useAuth();
  const [projects, setProjects] = useState<any[]>([]);
  const [input, setInput] = useState("");
  const [model, setModel] = useState(() => getStoredModel());
  const [searchParams, setSearchParams] = useSearchParams();

  const {
    threads,
    activeThreadId,
    setActiveThread,
    newThread,
    deleteThread,
  } = useChatThreads(globalSelectedProjectId);

  // Load projects
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

  // Sync selectedProject metadata when active project id changes.
  useEffect(() => {
    if (!globalSelectedProjectId || projects.length === 0) return;
    const match = projects.find((p) => p.id === globalSelectedProjectId);
    if (match && match.id !== selectedProject?.id) setSelectedProject(match);
  }, [globalSelectedProjectId, projects, selectedProject?.id, setSelectedProject]);

  // Read ?thread= from the URL on mount / when project changes; default to Quick.
  useEffect(() => {
    if (!globalSelectedProjectId) return;
    const urlThread = searchParams.get("thread");
    if (urlThread) {
      if (urlThread !== activeThreadId) setActiveThread(urlThread);
    } else if (!activeThreadId) {
      setActiveThread(QUICK_THREAD_ID);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [globalSelectedProjectId, searchParams]);

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

  const firstName = (user?.user_metadata?.full_name ?? user?.email ?? "").split(/[ @]/)[0];

  return (
    <PageLayout isCollapsed={isCollapsed} setIsCollapsed={setIsCollapsed}>
      <div className="px-12 py-6">
        <PageHeader
          title="Project Intelligence"
          subtitle={
            selectedProject
              ? `Chatting about ${selectedProject.name}${selectedProject.plant_name ? ` · ${selectedProject.plant_name}` : ""}`
              : "AI-powered insights for your supply chain project"
          }
        />

        <div className="grid h-[calc(100vh-190px)] min-h-[560px] grid-cols-[280px_1fr] overflow-hidden rounded-lg border border-border bg-card">
          <ChatSidebar
            projects={projects}
            selectedProjectId={globalSelectedProjectId}
            onSelectProject={(id) => setGlobalSelectedProjectId(id)}
            threads={threads}
            activeThreadId={activeThreadId}
            onSelectThread={handleSelectThread}
            onNewThread={handleNewThread}
            onDeleteThread={deleteThread}
          />
          <ChatWorkspace
            projectId={globalSelectedProjectId}
            threadId={activeThreadId}
            projectLabel={selectedProject?.name ?? null}
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
