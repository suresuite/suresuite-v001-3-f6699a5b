// @ts-nocheck — schema mismatch: this file targets a supply-chain schema not yet migrated into this project. Remove once tables/RPCs are created.
import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { Plus, CheckCircle, AlertCircle, Trash2, Copy, Pencil, Factory, GitBranch, Layers, Eye, Upload, X, RefreshCw, Download } from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { StepwiseDatePicker } from '@/components/ui/stepwise-date-picker';
import { supabase } from '@/integrations/supabase/client';
import { Switch } from '@/components/ui/switch';
import { useAuth } from '@/hooks/useAuth';
import { useUserRole } from '@/hooks/useUserRole';
import { useGlobalProject } from '@/hooks/useGlobalProject';
import { PageLayout, PageHeader, ProjectSelector, PAGE_GUTTER } from '@/components/shared';
import { Toggle } from '@/components/ui/toggle';
import ProjectDataViewer from '@/components/ProjectDataViewer';
import ItemMasterEditor from '@/components/ItemMasterEditor';
import { getDefaultSimulationDateRange, formatDateForDatabase } from '@/utils/dateHelpers';
import UploadWizard from '@/components/UploadWizard';
import { ProjectCard } from '@/components/ProjectCard';
import { ErpConnectionsPanel } from '@/components/erp/ErpConnectionsPanel';

interface Project {
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
  data_type?: string;
}

interface DataManagerProps {
  isCollapsed: boolean;
  setIsCollapsed: (value: boolean) => void;
}

const DataManager = ({ isCollapsed, setIsCollapsed }: DataManagerProps) => {
  // Walk-to deep link (§8.2 findings → data): ?project=<id> expands the
  // project's data card; &item_master=<materials|products|suppliers> also
  // opens the Item Master editor on that tab (see fieldWalkToRoute).
  const [searchParams] = useSearchParams();
  const [projects, setProjects] = useState<Project[]>([]);
  const [isCreating, setIsCreating] = useState(false);
  const [expandedProjectId, setExpandedProjectId] = useState<string | null>(null);
  const [uploadingProject, setUploadingProject] = useState<Project | null>(null);
  const [itemMasterProjectId, setItemMasterProjectId] = useState<string | null>(null);
  const walkToTable = searchParams.get('item_master');
  useEffect(() => {
    const walkToProject = searchParams.get('project');
    if (!walkToProject) return;
    setExpandedProjectId(walkToProject);
    if (walkToTable) setItemMasterProjectId(walkToProject);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);
  const { globalSelectedProjectId, setGlobalSelectedProjectId, selectedProject, setSelectedProject } = useGlobalProject();
  const [newProjectName, setNewProjectName] = useState('');
  const [plantName, setPlantName] = useState('');
  const [dataType, setDataType] = useState('curated');
  const [supplyChainModel, setSupplyChainModel] = useState('Make-To-Order');
  const [bomLevel, setBomLevel] = useState('single');
  const [simulationStart, setSimulationStart] = useState<Date | undefined>(undefined);
  const [simulationEnd, setSimulationEnd] = useState<Date | undefined>(undefined);
  const [deepTierEnabled, setDeepTierEnabled] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [editProjectName, setEditProjectName] = useState('');
  const [editPlantName, setEditPlantName] = useState('');
  const [editDataType, setEditDataType] = useState('curated');
  const [editSupplyChainModel, setEditSupplyChainModel] = useState('Make-To-Order');
  const [editBomLevel, setEditBomLevel] = useState('single');
  const [editSimulationStart, setEditSimulationStart] = useState<Date | undefined>(undefined);
  const [editSimulationEnd, setEditSimulationEnd] = useState<Date | undefined>(undefined);
  const [editDeepTierEnabled, setEditDeepTierEnabled] = useState(false);
  // toast is imported from sonner
  const { user } = useAuth();
  const { role, canModify } = useUserRole();

  const isDuplicateName = projects.some(
    (project) => project.name.toLowerCase() === newProjectName.trim().toLowerCase()
  );

  const handleOpenCreateForm = () => {
    const defaultDates = getDefaultSimulationDateRange();
    setSimulationStart(defaultDates.start);
    setSimulationEnd(defaultDates.end);
    setIsCreating(true);
  };

  const loadProjects = async () => {
    if (!user?.id) return;

    try {
      const { data, error } = await supabase.rpc('list_projects', {
        p_user_id: user.id,
        p_user_email: user.email
      });

      if (error) throw error;
      setProjects(data || []);
    } catch (error) {
      console.error('Error loading projects:', error);
      toast.error(`Error loading projects: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  useEffect(() => {
    if (user?.id) {
      loadProjects();
    }
  }, [user?.id]);

  // Check data completion for all projects when they load
  useEffect(() => {
    const checkAllProjects = async () => {
      if (projects.length === 0) return;
      
      const statusPromises = projects.map(async (project) => {
        const completion = await checkProjectDataCompletion(project.id);
        return { projectId: project.id, completion };
      });
      
      const results = await Promise.all(statusPromises);
      const statusMap = results.reduce((acc, { projectId, completion }) => {
        acc[projectId] = completion;
        return acc;
      }, {} as Record<string, any>);
      
      setProjectDataStatus(statusMap);
    };

    checkAllProjects();
  }, [projects]);

  // Refresh status for selected project when selection changes
  useEffect(() => {
    const refreshSelected = async () => {
      if (!selectedProject) return;
      const completion = await checkProjectDataCompletion(selectedProject.id);
      setProjectDataStatus((prev) => ({ ...prev, [selectedProject.id]: completion }));
    };
    void refreshSelected();
  }, [selectedProject?.id]);

  // Close any expanded project data when selection changes
  useEffect(() => {
    setExpandedProjectId(null);
    setUploadingProject(null);
  }, [selectedProject?.id]);

  const handleCreateProject = async () => {
    if (!newProjectName.trim() || !plantName.trim() || !user?.id) return;

    if (isDuplicateName) {
      toast.error('A project with this name already exists');
      return;
    }

    try {
      const { data, error } = await supabase.rpc('create_project', {
        p_name: newProjectName.trim(),
        p_plant: plantName.trim(),
        p_model: supplyChainModel,
        p_bom_level: bomLevel,
        p_user_id: user.id,
        p_user_email: user.email,
        p_user_name: user.name,
        p_simulation_start: formatDateForDatabase(simulationStart),
        p_simulation_end: formatDateForDatabase(simulationEnd),
        p_data_type: dataType,
      });

      if (error) throw error;

      toast.success(`Project "${newProjectName}" has been created`);

      setNewProjectName('');
      setPlantName('');
      setDataType('curated');
      setSupplyChainModel('Make-To-Order');
      setBomLevel('single');
      // Reset to default dates for next project creation
      const defaultDates = getDefaultSimulationDateRange();
      setSimulationStart(defaultDates.start);
      setSimulationEnd(defaultDates.end);
      setDeepTierEnabled(false);
      setIsCreating(false);
      loadProjects();
    } catch (error: any) {
      console.error('Project creation error:', error);
      toast.error(error.message?.includes('uq_modeler_project') 
        ? 'A project with this name already exists for your account'
        : error.message || 'Unknown error');
    }
  };

  const handleDeleteProject = async (project: Project, forceDelete = false) => {
    if (!canModify || !user?.id || !user.email) return;

    try {
      const isComplex = forceDelete || (project.deep_tier_enabled && project.bom_level === 'multi_level');

      // Use edge function to run deletion in background to avoid timeouts
      const { data, error } = await supabase.functions.invoke('delete-project', {
        body: {
          projectId: project.id,
          userId: user.id,
          userEmail: user.email,
          force: isComplex,
        },
      });

      if (error) throw error;

      toast.success(`Deletion started for "${project.name}". This may take a few seconds...`);

      if (selectedProject?.id === project.id) {
        setSelectedProject(null);
      }
      if (globalSelectedProjectId === project.id) {
        setGlobalSelectedProjectId(null);
      }

      // Refresh projects a few times to reflect background completion
      setTimeout(loadProjects, 2000);
      setTimeout(loadProjects, 5000);
    } catch (error: any) {
      console.error('Project deletion error:', error);
      
      // Handle different error formats from Supabase
      let errorMessage = 'Unknown error';
      
      if (error?.message) {
        errorMessage = error.message;
      } else if (error?.code === '57014' || error?.code === 57014) {
        errorMessage = 'Statement timeout - project deletion took too long';
      } else if (typeof error === 'string') {
        errorMessage = error;
      }
      
      // Check for timeout in various formats
      const isTimeout = errorMessage.includes('timeout') || 
                       errorMessage.includes('canceling statement') ||
                       error?.code === '57014' || 
                       error?.code === 57014;
      
      if (isTimeout && !forceDelete) {
        toast.error(`Project deletion timed out. This project has complex data that requires force deletion. Try again - it will automatically clean data first.`);
      } else {
        toast.error(`Failed to delete project: ${errorMessage}`);
      }
    }
  };

  const handleDuplicateProject = async (project: Project) => {
    if (!user?.id || !user.email) return;

    try {
      const baseName = `${project.name} Copy`;
      let newName = baseName;
      let counter = 2;
      while (projects.some((p) => p.name.toLowerCase() === newName.toLowerCase())) {
        newName = `${baseName} ${counter}`;
        counter++;
      }

      const { error } = await supabase.rpc('create_project', {
        p_name: newName,
        p_plant: project.plant_name,
        p_model: project.supply_chain_model,
        p_bom_level: project.bom_level,
        p_user_id: user.id,
        p_user_email: user.email,
        p_user_name: user.name,
      });

      if (error) throw error;

      toast.success(`Project "${project.name}" duplicated as "${newName}"`);
      loadProjects();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unknown error');
    }
  };

  const handleUpdateProject = async () => {
    if (!editingProject || !user?.id || !user.email) return;

    try {
      const { error } = await supabase.rpc('update_project', {
        p_project_id: editingProject.id,
        p_name: editProjectName.trim(),
        p_plant: editPlantName.trim(),
        p_model: editSupplyChainModel,
        p_bom_level: editBomLevel,
        p_user_id: user.id,
        p_user_email: user.email,
        p_simulation_start: editSimulationStart ? editSimulationStart.toISOString().split('T')[0] : null,
        p_simulation_end: editSimulationEnd ? editSimulationEnd.toISOString().split('T')[0] : null,
        p_data_type: editDataType,
      });

      if (error) throw error;

      toast.success(`Project "${editProjectName}" has been updated`);
      setEditingProject(null);
      loadProjects();
    } catch (error: any) {
      toast.error(error?.message?.includes('uq_modeler_project')
        ? 'A project with this name already exists'
        : (error instanceof Error ? error.message : 'Unknown error'));
    }
  };

  const [projectDataStatus, setProjectDataStatus] = useState<Record<string, any>>({});

  const checkProjectDataCompletion = async (projectId: string) => {
    if (!user?.id || !user?.email) {
      return { bom: false, inbound: false, outbound: false, nodeList: false, deepNodes: false, deepEdges: false, deepSummary: false };
    }

    try {
      // Use the updated RPC function that includes deep tier checks
      const { data, error } = await supabase.rpc('get_project_dataset_status', {
        p_project_id: projectId,
        p_user_id: user.id,
        p_user_email: user.email
      });

      if (error) {
        console.error('Error checking project data:', error);
        return { bom: false, inbound: false, outbound: false, nodeList: false, deepNodes: false, deepEdges: false, deepSummary: false };
      }

      // Check node list separately since it's not in the RPC
      const { data: nodeListData, error: nodeListError } = await supabase.rpc('get_node_list', {
        p_project_id: projectId,
        p_plant_name: null,
        p_user_id: user.id,
        p_user_email: user.email,
      });

      const nodeListOk = !nodeListError && Array.isArray(nodeListData) && nodeListData.length > 0;

      const status = data as any;
      return {
        bom: status.has_bom,
        inbound: status.has_inbound,
        outbound: status.has_outbound,
        nodeList: nodeListOk,
        deepNodes: status.deep_tier_enabled ? status.has_deep_tier_nodes : undefined,
        deepEdges: status.deep_tier_enabled ? status.has_deep_tier_edges : undefined,
        deepSummary: status.deep_tier_enabled ? status.has_deep_tier_summary : undefined,
      };
    } catch (error) {
      console.error('Error checking project data:', error);
      return { bom: false, inbound: false, outbound: false, nodeList: false, deepNodes: false, deepEdges: false, deepSummary: false };
    }
  };

  const getCompletionInfo = (project: Project) => {
    return projectDataStatus[project.id] || { bom: false, inbound: false, outbound: false, nodeList: false };
  };
  const handleUploadData = () => {
    if (!selectedProject) {
      toast.error('Please select a project first');
      return;
    }
    // Close any expanded project view and toggle the upload wizard
    setExpandedProjectId(null);
    setUploadingProject((current) =>
      current?.id === selectedProject.id ? null : selectedProject
    );
  };

  const handleCombineProject = async (project: Project) => {
    if (!user?.id || !user?.email) return;

    // Update project status to running immediately
    setProjects(prevProjects => 
      prevProjects.map(p => 
        p.id === project.id 
          ? { ...p, combine_status: 'running' as const, combine_timestamp: new Date().toISOString() }
          : p
      )
    );

    try {
      // First update completion status
      const { data: statusResult, error: statusError } = await supabase.rpc('update_project_completion_status', {
        p_project_id: project.id,
        p_user_id: user.id,
        p_user_email: user.email
      });

      if (statusError) {
        console.error('Error updating project status:', statusError);
        // Update status to failed on error
        setProjects(prevProjects => 
          prevProjects.map(p => 
            p.id === project.id 
              ? { ...p, combine_status: 'failed' as const, combine_timestamp: new Date().toISOString() }
              : p
          )
        );
        toast.error('Failed to check project completion status.');
        return;
      }

      // If project is complete, start combine process
      if ((statusResult as any)?.completed) {
        // Call combine edge function in synchronous mode
        const { data: combineData, error: combineError } = await supabase.functions.invoke('combine-project', {
          body: {
            project_id: project.id,
            user_id: user.id,
            user_email: user.email,
            sync: true,
          }
        });

        if (combineError || (combineData as any)?.success === false) {
          // Extract detailed error from server response
          const errMsg = 
            (combineError as any)?.context?.error ||
            (combineData as any)?.error ||
            combineError?.message ||
            'Failed to combine project data.';
          
          setProjects(prevProjects => 
            prevProjects.map(p => 
              p.id === project.id 
                ? { ...p, combine_status: 'failed' as const, combine_timestamp: new Date().toISOString() }
                : p
            )
          );
          toast.error(errMsg);
          return;
        }

        // Poll node_list for readiness (up to ~20s)
        const start = Date.now();
        let populated = false;
        while (Date.now() - start < 20000) {
          const { data: nodeListData, error: nodeErr } = await supabase.rpc('get_node_list', {
            p_project_id: project.id,
            p_plant_name: null,
            p_user_id: user.id,
            p_user_email: user.email,
          });
          if (!nodeErr && Array.isArray(nodeListData) && nodeListData.length > 0) {
            populated = true;
            break;
          }
          await new Promise((res) => setTimeout(res, 1000));
        }

        if (populated) {
          setProjects(prevProjects => 
            prevProjects.map(p => 
              p.id === project.id 
                ? { ...p, combine_status: 'completed' as const, combine_timestamp: new Date().toISOString() }
                : p
            )
          );
          {
            const mt = (combineData as any)?.multi_tier_breakdown;
            const scd = (combineData as any)?.scd_breakdown;
            const scdMsg = scd ? `SCD — Outbound: ${scd.outbound}, BOM: ${scd.bom}, Inbound: ${scd.inbound}` : '';
            const mtMsg = mt ? `Multi-tier — Outbound: ${mt.outbound}, BOM: ${mt.bom}, Inbound: ${mt.inbound}` : '';
            const details = [scdMsg, mtMsg].filter(Boolean).join(' | ');
            toast.success(details ? `Data combined and node list is ready. ${details}` : 'Data combined and node list is ready.');
          }
        } else {
          setProjects(prevProjects => 
            prevProjects.map(p => 
              p.id === project.id 
                ? { ...p, combine_status: 'failed' as const, combine_timestamp: new Date().toISOString() }
                : p
            )
          );
          toast.error('Combine completed but node list not found yet. Please retry.');
        }

      } else {
        // Update status to failed if project not complete
        setProjects(prevProjects => 
          prevProjects.map(p => 
            p.id === project.id 
              ? { ...p, combine_status: 'failed' as const, combine_timestamp: new Date().toISOString() }
              : p
          )
        );
        toast.error('Project must have all required datasets uploaded first.');
      }
    } catch (error) {
      console.error('Error in handleCombineProject:', error);
      // Update status to failed on error
      setProjects(prevProjects => 
        prevProjects.map(p => 
          p.id === project.id 
            ? { ...p, combine_status: 'failed' as const, combine_timestamp: new Date().toISOString() }
            : p
        )
      );
      toast.error('An unexpected error occurred.');
    }
  };

  const handleViewData = () => {
    if (!selectedProject) {
      toast.error('Please select a project first');
      return;
    }
    setUploadingProject(null);
    setExpandedProjectId(expandedProjectId === selectedProject.id ? null : selectedProject.id);
  };

  const handleRefreshData = () => {
    if (!selectedProject) {
      toast.error('Please select a project first');
      return;
    }
    
    (async () => {
      try {
        await supabase.rpc('combine_project_into_supply_chain', {
          p_project_id: selectedProject.id,
          p_user_id: user?.id,
          p_user_email: user?.email
        });
        toast.success(`Project "${selectedProject.name}" combined successfully`);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Unknown error');
      }
    })();
  };

  const handleEditProject = () => {
    if (!selectedProject) {
      toast.error('Please select a project first');
      return;
    }
    setEditingProject(selectedProject);
    setEditProjectName(selectedProject.name);
    setEditPlantName(selectedProject.plant_name);
    setEditSupplyChainModel(selectedProject.supply_chain_model);
    setEditBomLevel(selectedProject.bom_level);
    setEditSimulationStart(selectedProject.simulation_start ? new Date(selectedProject.simulation_start) : undefined);
    setEditSimulationEnd(selectedProject.simulation_end ? new Date(selectedProject.simulation_end) : undefined);
    setEditDeepTierEnabled(selectedProject.deep_tier_enabled || false);
  };

  const handleDeleteSelectedProject = () => {
    if (!selectedProject) {
      toast.error('Please select a project first');
      return;
    }
    
    const isComplexProject = selectedProject.deep_tier_enabled && selectedProject.bom_level === 'multi_level';
    const message = isComplexProject 
      ? `Delete project "${selectedProject.name}"? This is a complex project that will be force-deleted (all data cleaned first).`
      : `Are you sure you want to delete project "${selectedProject.name}"?`;
      
    if (confirm(message)) {
      handleDeleteProject(selectedProject, isComplexProject);
    }
  };

  const handleDuplicateSelectedProject = () => {
    if (!selectedProject) {
      toast.error('Please select a project first');
      return;
    }
    handleDuplicateProject(selectedProject);
  };

  const handleDeleteAllData = async (project: Project) => {
    if (!canModify || !user?.id || !user?.email) return;

    const confirm = window.confirm(
      `Are you sure you want to delete ALL data for project "${project.name}"? This action cannot be undone.`
    );

    if (!confirm) return;

    try {
      // Use secure RPC to delete all datasets
      const { data: deletedCount, error } = await supabase.rpc('delete_project_dataset', {
        p_project_id: project.id,
        p_dataset: 'all',
        p_user_id: user.id,
        p_user_email: user.email
      });

      if (error) throw error;

      toast.success(`All data for project "${project.name}" has been deleted (${deletedCount} records)`);

      // Refresh project data status
      const updatedStatus = await checkProjectDataCompletion(project.id);
      setProjectDataStatus(prev => ({ ...prev, [project.id]: updatedStatus }));

    } catch (error) {
      console.error('Error deleting project data:', error);
      toast.error(error instanceof Error ? error.message : 'Unknown error');
    }
  };

  const handleDownloadNodeList = async (project: Project) => {
    if (!user?.id || !user?.email) return;

    try {
      const { data, error } = await supabase.rpc('get_node_list', {
        p_project_id: project.id,
        p_plant_name: null,
        p_user_id: user.id,
        p_user_email: user.email
      });

      if (error) throw error;

      if (!data || data.length === 0) {
        toast.error("This project doesn't have any node list data to download");
        return;
      }

      // Define columns for CSV
      const columns = [
        'node_id', 'plant_name', 'node_type', 'node_group', 'description_text', 
        'location_text', 'longitude', 'latitude', 'is_critical_node', 'critical_node_score'
      ];

      // Create CSV rows
      const rows = data.map((node: any) =>
        columns.map(col => {
          const value = node[col] ?? '';
          const stringValue = String(value).replace(/"/g, '""');
          return /[",\n]/.test(stringValue) ? `"${stringValue}"` : stringValue;
        }).join(',')
      );

      // Create and download CSV
      const csv = [columns.join(','), ...rows].join('\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${project.name.toLowerCase().replace(/\s+/g, '_')}_node_list.csv`;
      a.click();
      URL.revokeObjectURL(url);

      toast.success(`Pre-combined node list for "${project.name}" downloaded. Add more attributes to this file and upload it back to enhance your project data.`);
    } catch (error) {
      console.error('Error downloading node list:', error);
      toast.error(error instanceof Error ? error.message : 'Unknown error');
    }
  };

  const handleGenerateNodeList = async (project: Project) => {
    if (!user?.id || !user?.email) return;

    try {
      toast.loading(`Combining datasets and building node list for "${project.name}"`);

      // Ensure completion flag is up to date
      await supabase.rpc('update_project_completion_status', {
        p_project_id: project.id,
        p_user_id: user.id,
        p_user_email: user.email,
      });

      // Combine datasets then rebuild node list
      await supabase.rpc('combine_project_into_supply_chain', {
        p_project_id: project.id,
        p_user_id: user.id,
        p_user_email: user.email,
      });
      await supabase.rpc('rebuild_node_list', {
        p_project_id: project.id,
        p_user_id: user.id,
        p_user_email: user.email,
      });

      const finalStatus = await checkProjectDataCompletion(project.id);
      setProjectDataStatus((prev) => ({ ...prev, [project.id]: finalStatus }));
      await loadProjects();

      toast.success(`You can now download the node list for "${project.name}".`);
    } catch (error) {
      console.error('Error generating node list manually:', error);
      toast.error(error instanceof Error ? error.message : 'Unknown error');
    }
  };

  return (
    <PageLayout isCollapsed={isCollapsed} setIsCollapsed={setIsCollapsed}>
      <div className={PAGE_GUTTER}>
        <PageHeader
          title="Your Projects"
          subtitle={canModify
            ? 'Create and manage your supply chain projects'
            : 'View available projects'}
          rightContent={
            <div className="flex items-center space-x-2">
              {selectedProject && (
                <Badge variant="secondary" className="text-xs">
                  {selectedProject.name}
                </Badge>
              )}
              {canModify && (
                <Button
                  onClick={handleOpenCreateForm}
                  disabled={isCreating}
                  size="sm"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  New Project
                </Button>
              )}
            </div>
          }
        />
        <div className="space-y-4">
            {/* Create New Project Form */}
        {isCreating && canModify && (
          <Card className="border-dashed">
            <CardHeader className="pb-4">
              <CardTitle className="text-sm">Create New Project</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label htmlFor="projectName">Project Name</Label>
                <Input
                  id="projectName"
                  value={newProjectName}
                  onChange={(e) => setNewProjectName(e.target.value)}
                  placeholder="Enter project name"
                />
                {isDuplicateName && (
                  <p className="text-sm text-red-500 mt-1">A project with this name already exists</p>
                )}
              </div>
              <div>
                <Label htmlFor="plantName">Plant</Label>
                <Input
                  id="plantName"
                  value={plantName}
                  onChange={(e) => setPlantName(e.target.value)}
                  placeholder="Enter plant name"
                />
              </div>
              <div>
                <Label>Data</Label>
                <RadioGroup
                  value={dataType}
                  onValueChange={setDataType}
                  className="flex gap-4 mt-2"
                >
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="curated" id="data-curated" />
                    <Label htmlFor="data-curated">Curated data</Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="uncurated" id="data-uncurated" />
                    <Label htmlFor="data-uncurated">Uncurated data</Label>
                  </div>
                </RadioGroup>
              </div>
              <div>
                <Label>Supply Chain Model</Label>
                <RadioGroup
                  value={supplyChainModel}
                  onValueChange={setSupplyChainModel}
                  className="flex gap-4 mt-2"
                >
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="Make-To-Order" id="model-mto" />
                    <Label htmlFor="model-mto">Make-To-Order</Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="Make-To-Stock" id="model-mts" />
                    <Label htmlFor="model-mts">Make-To-Stock</Label>
                  </div>
                </RadioGroup>
              </div>
              <div>
                <Label>BOM Level</Label>
                <RadioGroup
                  value={bomLevel}
                  onValueChange={setBomLevel}
                  className="flex gap-4 mt-2"
                >
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="single" id="bom-single" />
                    <Label htmlFor="bom-single">Single Level BOM</Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="multi" id="bom-multi" />
                    <Label htmlFor="bom-multi">Multiple Level BOM</Label>
                  </div>
                </RadioGroup>
              </div>
              
              <div className="space-y-2">
                <Label className="text-xs font-medium">Deep Tier Network</Label>
                <div className="flex items-center space-x-3">
                  <Switch
                    id="deep-tier-enabled"
                    checked={deepTierEnabled}
                    onCheckedChange={setDeepTierEnabled}
                  />
                  <Label htmlFor="deep-tier-enabled" className="text-xs">
                    Enable Deep Tier Network Analysis
                  </Label>
                </div>
                {deepTierEnabled && (
                  <p className="text-xs text-muted-foreground">
                    This will enable tier-2 and tier-3 supplier data collection for extended supply chain visibility.
                  </p>
                )}
              </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="text-xs">Simulation Start Date</Label>
                <StepwiseDatePicker
                  date={simulationStart}
                  onSelect={setSimulationStart}
                  placeholder="Pick start date"
                />
              </div>
              <div>
                <Label className="text-xs">Simulation End Date</Label>
                <StepwiseDatePicker
                  date={simulationEnd}
                  onSelect={setSimulationEnd}
                  placeholder="Pick end date"
                  disabled={(date) => simulationStart ? date < simulationStart : false}
                />
              </div>
            </div>
              <div className="flex gap-2">
                <Button
                  onClick={handleCreateProject}
                  disabled={!newProjectName.trim() || !plantName.trim() || isDuplicateName}
                >
                  Create Project
                </Button>
                <Button variant="outline" onClick={() => setIsCreating(false)}>
                  Cancel
                </Button>
              </div>
            </CardContent>
          </Card>
        )}


        {projects.length === 0 ? (
          <Card>
            <CardContent className="p-8 text-center">
              <div className="text-muted-foreground">
                <p className="text-lg font-medium mb-2">No projects found</p>
                <p className="text-sm">Create your first project to get started</p>
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {projects.map((project) => {
              const completion = getCompletionInfo(project);
              const isSelected = selectedProject?.id === project.id;

              return (
                <div key={project.id}>
                  <ProjectCard
                    project={project}
                    completion={completion}
                    isSelected={isSelected}
                    isEditing={editingProject?.id === project.id}
                    globalSelectedProjectId={globalSelectedProjectId}
                    canModify={canModify}
                    role={role}
                    userId={user?.id || ''}
                    editProjectName={editProjectName}
                    editPlantName={editPlantName}
                    editSupplyChainModel={editSupplyChainModel}
                    editBomLevel={editBomLevel}
                    editDataType={editDataType}
                    editSimulationStart={editSimulationStart}
                    editSimulationEnd={editSimulationEnd}
                    onSelect={setSelectedProject}
                    onGlobalSelect={setGlobalSelectedProjectId}
                    onDownloadNodeList={handleDownloadNodeList}
                    onGenerateNodeList={handleGenerateNodeList}
                    onViewData={(project) => {
                      setSelectedProject(project);
                      setUploadingProject(null);
                      setExpandedProjectId(expandedProjectId === project.id ? null : project.id);
                    }}
                    onUploadData={(project) => {
                      setSelectedProject(project);
                      setExpandedProjectId(null);
                      setUploadingProject((current) =>
                        current?.id === project.id ? null : project
                      );
                    }}
                    onEditItemMaster={(project) => {
                      setSelectedProject(project);
                      setItemMasterProjectId((current) =>
                        current === project.id ? null : project.id
                      );
                    }}
                    onEdit={(project) => {
                      setSelectedProject(project);
                      setEditingProject(project);
                      setEditProjectName(project.name);
                      setEditPlantName(project.plant_name);
                      setEditDataType(project.data_type || 'curated');
                      setEditSupplyChainModel(project.supply_chain_model);
                      setEditBomLevel(project.bom_level);
                      setEditSimulationStart(project.simulation_start ? new Date(project.simulation_start) : undefined);
                      setEditSimulationEnd(project.simulation_end ? new Date(project.simulation_end) : undefined);
                    }}
                    onDelete={handleDeleteProject}
                    onCombine={handleCombineProject}
                    onCancelEdit={() => setEditingProject(null)}
                    onUpdateProject={handleUpdateProject}
                    onEditProjectNameChange={setEditProjectName}
                    onEditPlantNameChange={setEditPlantName}
                    onEditSupplyChainModelChange={setEditSupplyChainModel}
                    onEditBomLevelChange={setEditBomLevel}
                    onEditDataTypeChange={setEditDataType}
                    onEditSimulationStartChange={setEditSimulationStart}
                    onEditSimulationEndChange={setEditSimulationEnd}
                    onEditDeepTierEnabledChange={setEditDeepTierEnabled}
                    editDeepTierEnabled={editDeepTierEnabled}
                  />

                  {expandedProjectId === project.id && (
                    <div className="mt-4 ml-4 pl-4 border-l-2 border-border space-y-4">
                       <ProjectDataViewer
                         project={project}
                         onClose={() => setExpandedProjectId(null)}
                         onDataDeleted={() => {
                           checkProjectDataCompletion(project.id).then((status) => {
                             setProjectDataStatus((prev) => ({ ...prev, [project.id]: status }));
                           });
                         }}
                       />
                       {/* Complementary to the Upload Wizard above, never a replacement —
                           docs/design/erp-mrp-integration-plan.md §2.0, §6c. */}
                       <ErpConnectionsPanel projectId={project.id} />
                    </div>
                  )}
                  {itemMasterProjectId === project.id && (
                    <div className="mt-4 ml-4 pl-4 border-l-2 border-border">
                      <ItemMasterEditor
                        projectId={project.id}
                        initialTab={
                          walkToTable === 'materials' || walkToTable === 'products' || walkToTable === 'suppliers'
                            ? walkToTable
                            : undefined
                        }
                        onClose={() => setItemMasterProjectId(null)}
                      />
                    </div>
                  )}
                  {uploadingProject?.id === project.id && (
                    <div className="mt-4 ml-4 pl-4 border-l-2 border-border">
                      <UploadWizard
                        selectedProject={uploadingProject}
                        userId={user?.id || ''}
                        onUploadComplete={async () => {
                          console.log('🔄 Upload completion callback triggered for project:', project.name);
                          
                          try {
                            // Step 1: Clear upload state immediately to prevent UI issues
                            setUploadingProject(null);
                            
                            console.log('📊 Refreshing project status after upload...');
                            
                            // Step 2: Sequential async operations to prevent race conditions
                            await new Promise(resolve => setTimeout(resolve, 200)); // Brief delay to ensure upload transaction completes
                            
                            // Step 3: Reload projects and check completion status
                            await loadProjects();
                            const updatedStatus = await checkProjectDataCompletion(project.id);
                            setProjectDataStatus((prev) => ({ ...prev, [project.id]: updatedStatus }));
                            
                            console.log('📈 Updated project status:', updatedStatus);
                            
                            // Step 4: Check if project datasets are complete (excluding node list initially)
                            const isCompleteByData = updatedStatus.bom && updatedStatus.inbound && updatedStatus.outbound;
                            
                            if (isCompleteByData && !updatedStatus.nodeList) {
                              console.log('ℹ️ Core datasets complete. Skipping auto-completion to avoid timeouts in Multi Level BOM projects.');
                              toast.success(`All datasets uploaded. Click "Refresh Data" to finalize project "${project.name}".`);
                            } else {
                              console.log('ℹ️ Upload complete, no additional processing needed');
                            }
                            
                          } catch (completionError) {
                            console.error('❌ Upload completion callback failed:', completionError);
                            toast.error("Upload completed but status refresh failed. Please refresh the page.");
                          }
                        }}
                        onClose={() => setUploadingProject(null)}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
          </div>
        </div>
    </PageLayout>
  );
};

export default DataManager;