import { createContext, useContext, useState, ReactNode, useEffect } from 'react';

/** The project shape the global selection stores — and what list_projects
 * returns. Exported so callers that feed setSelectedProject can type their
 * rows as this rather than `any` (ProjectIntelligence did the latter under a
 * file-wide @ts-nocheck). */
export interface Project {
  id: string;
  name: string;
  plant_name: string;
  supply_chain_model: string;
  bom_level: string;
  completed: boolean;
  created_at: string;
  modeler_id: string;
  modeler_name: string;
  simulation_start?: string | null;
  simulation_end?: string | null;
  deep_tier_enabled?: boolean;
  combine_status?: 'pending' | 'running' | 'completed' | 'failed';
  combine_timestamp?: string | null;
}

interface GlobalProjectContextType {
  globalSelectedProjectId: string | null;
  setGlobalSelectedProjectId: (projectId: string | null) => void;
  selectedProject: Project | null;
  setSelectedProject: (project: Project | null) => void;
}

const GlobalProjectContext = createContext<GlobalProjectContextType | undefined>(undefined);

export function GlobalProjectProvider({ children }: { children: ReactNode }) {
  const [globalSelectedProjectId, setGlobalSelectedProjectId] = useState<string | null>(null);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);

  // Persist global selection to localStorage
  useEffect(() => {
    const saved = localStorage.getItem('globalSelectedProjectId');
    if (saved) {
      setGlobalSelectedProjectId(saved);
    }
  }, []);

  useEffect(() => {
    if (globalSelectedProjectId) {
      localStorage.setItem('globalSelectedProjectId', globalSelectedProjectId);
    } else {
      localStorage.removeItem('globalSelectedProjectId');
    }
  }, [globalSelectedProjectId]);

  return (
    <GlobalProjectContext.Provider
      value={{
        globalSelectedProjectId,
        setGlobalSelectedProjectId,
        selectedProject,
        setSelectedProject,
      }}
    >
      {children}
    </GlobalProjectContext.Provider>
  );
}

export function useGlobalProject() {
  const context = useContext(GlobalProjectContext);
  if (context === undefined) {
    throw new Error('useGlobalProject must be used within a GlobalProjectProvider');
  }
  return context;
}