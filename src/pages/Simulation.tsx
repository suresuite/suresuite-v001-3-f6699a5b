// @ts-nocheck — schema mismatch: this file targets a supply-chain schema not yet migrated into this project. Remove once tables/RPCs are created.
import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useUserRole } from '@/hooks/useUserRole';
import { useGlobalProject } from '@/hooks/useGlobalProject';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { PageLayout, PageHeader, ProjectSelector, ScenarioImpactSlider } from '@/components/shared';
import { DisruptionDialog } from '@/components/DisruptionDialog';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible';

import { SimulationResultsComparisonChart } from '@/components/SimulationResultsComparisonChart';
import { KPIDualCard } from '@/components/KPIDualCard';
import { SimpleResilienceKPICard } from '@/components/SimpleResilienceKPICard';
import { SimulationJobMonitor } from '@/components/SimulationJobMonitor';
import { SimulationResultsFilter } from '@/components/SimulationResultsFilter';
import { SimulationSummaryCards } from '@/components/SimulationSummaryCards';
import { SimulationMetrics, DEFAULT_KPI_CONFIGS, BaselineSimulation, SimulationResult, SimulationSelectionMode, SimulationFilterState, ScenarioJob } from '@/types/simulation';
import {
  Play,
  AlertTriangle,
  Clock,
  CheckCircle,
  XCircle,
  RefreshCw,
  Plus,
  Trash2,
  Edit,
  Copy,
  CalendarIcon,
  Download,
  CheckSquare,
  Square,
  TrendingDown,
  ChartBar,
  Info,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';

interface DisruptionScenario {
  id: string;
  scenario_name: string;
  description?: string;
  status: string;
  created_at: string;
  disruption_start?: string;
  disruption_end?: string;
  targets: {
    target_type: string;
    node_ids?: string[];
    edge_list?: any;
  }[];
  effects: {
    effect_type: string;
    magnitude: number;
    unit: string;
  }[];
}


interface SimulationProps {
  isCollapsed: boolean;
  setIsCollapsed: (value: boolean) => void;
}

export default function Simulation({ isCollapsed, setIsCollapsed }: SimulationProps) {
  const { user } = useAuth();
  const { role, canModify } = useUserRole();
  const { globalSelectedProjectId, setGlobalSelectedProjectId } = useGlobalProject();
  const [projects, setProjects] = useState<any[]>([]);
  const [scenarios, setScenarios] = useState<DisruptionScenario[]>([]);
  const [selectedScenarios, setSelectedScenarios] = useState<string[]>([]);
  const [scenarioJobs, setScenarioJobs] = useState<ScenarioJob[]>([]);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [scenarioResultsMap, setScenarioResultsMap] = useState<{ [jobId: string]: SimulationResult }>({});
  const [simulations, setSimulations] = useState<SimulationResult[]>([]);
  const [baselineSimulations, setBaselineSimulations] = useState<BaselineSimulation[]>([]);
  const [hasShownAutoSelectToast, setHasShownAutoSelectToast] = useState(false);
  const [loading, setLoading] = useState(false);
  
  // Section visibility states
  const [showSimulationResults, setShowSimulationResults] = useState(false);
  const [showSingleComparison, setShowSingleComparison] = useState(false);
  const [showMultiComparison, setShowMultiComparison] = useState(false);
  const [runningSimulation, setRunningSimulation] = useState(false);
  // One-time toast for baseline-as-scenario fallback
  const [baselineFallbackToastShown, setBaselineFallbackToastShown] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [disruptionDialogOpen, setDisruptionDialogOpen] = useState(false);
  const [selectedSimulations, setSelectedSimulations] = useState<string[]>([]);
  const [selectedSimulationId, setSelectedSimulationId] = useState<string | null>(null);
  const [selectionMode, setSelectionMode] = useState<SimulationSelectionMode>('latest');
  const [filterState, setFilterState] = useState<SimulationFilterState>({
    status: [],
    dateRange: { from: null, to: null },
    simulationType: 'all'
  });
  const [isDebugInfoExpanded, setIsDebugInfoExpanded] = useState(false);

  const scenariosPerPage = 6;
  const totalPages = Math.ceil(scenarios.length / scenariosPerPage);
  const startIndex = (currentPage - 1) * scenariosPerPage;
  const endIndex = startIndex + scenariosPerPage;
  const currentScenarios = scenarios.slice(startIndex, endIndex);

  // Project-level permission: admin or project owner can modify
  const currentProject = React.useMemo(() => (
    projects.find(p => p.id === globalSelectedProjectId)
  ), [projects, globalSelectedProjectId]);

  const canModifyProject = React.useMemo(() => {
    if (!user) return false;
    return role === 'admin' || currentProject?.modeler_id === user.id;
  }, [role, user, currentProject]);

  // Helper function to clean and validate metrics data
  const cleanMetricsData = (metrics: any): SimulationMetrics | null => {
    if (!metrics) return null;
    
    try {
      // Normalize: parse stringified JSON if needed
      let normalized: any = metrics;
      if (typeof normalized === 'string') {
        try {
          normalized = JSON.parse(normalized);
        } catch (e) {
          console.warn('Metrics is a string but failed to parse JSON:', e);
          return null;
        }
      }

      // Handle MaxDepthReached errors by filtering them out
      const cleanedMetrics = JSON.parse(
        JSON.stringify(normalized, (key, value) => {
          if (value && typeof value === 'object' && value._type === 'MaxDepthReached') {
            return null; // Remove corrupted data points
          }
          return value;
        })
      );

      return transformSimulationData(cleanedMetrics);
    } catch (error) {
      console.error('Failed to clean metrics data:', error);
      return null;
    }
  };
  const transformSimulationData = (metrics: any) => {
    if (!metrics) return null;
    
    console.log('Raw simulation metrics:', metrics);
    
    // Detect data format: New format has KPIs under kpi_time_series
    // Old format has KPIs directly under baseline/scenario
    const hasKpiTimeSeries = (
      (metrics.baseline?.kpi_time_series && Object.keys(metrics.baseline.kpi_time_series).length > 0) ||
      (metrics.scenario?.kpi_time_series && Object.keys(metrics.scenario.kpi_time_series).length > 0)
    );
    
    console.log('Detected format:', hasKpiTimeSeries ? 'new (kpi_time_series)' : 'old (direct KPI)');
    
    let baselineKpis: string[] = [];
    let scenarioKpis: string[] = [];
    
    if (hasKpiTimeSeries) {
      // New format: KPIs are under kpi_time_series
      baselineKpis = Object.keys(metrics.baseline?.kpi_time_series || {});
      scenarioKpis = Object.keys(metrics.scenario?.kpi_time_series || {});
    } else {
      // Old format: KPIs are directly under baseline/scenario
      baselineKpis = Object.keys(metrics.baseline || {}).filter(key => 
        Array.isArray(metrics.baseline?.[key])
      );
      scenarioKpis = Object.keys(metrics.scenario || {}).filter(key => 
        Array.isArray(metrics.scenario?.[key])
      );
    }
    
    // Use available_kpis if provided, otherwise derive from data
    const providedKpis = metrics.available_kpis || [];
    const summaryKpis = Array.from(new Set([
      ...Object.keys(metrics.baseline?.kpi_values || {}),
      ...Object.keys(metrics.scenario?.kpi_values || {})
    ]));
    const derivedKpis = Array.from(new Set([...baselineKpis, ...scenarioKpis, ...summaryKpis]));
    const allKpis = providedKpis.length > 0 ? providedKpis : derivedKpis;
    
    // Calculate simulation period from the actual data
    let minTime = 0;
    let maxTime = 0;
    
    [...baselineKpis, ...scenarioKpis].forEach(kpiId => {
      let baselineData: any[] = [];
      let scenarioData: any[] = [];
      
      if (hasKpiTimeSeries) {
        baselineData = metrics.baseline?.kpi_time_series?.[kpiId] || [];
        scenarioData = metrics.scenario?.kpi_time_series?.[kpiId] || [];
      } else {
        baselineData = metrics.baseline?.[kpiId] || [];
        scenarioData = metrics.scenario?.[kpiId] || [];
      }
      
      [...baselineData, ...scenarioData].forEach((point: any) => {
        // Handle both day and week properties, convert day to week for consistency
        const time = point.week || point.day || 0;
        minTime = Math.min(minTime, time);
        maxTime = Math.max(maxTime, time);
      });
    });
    
    // Transform from database format to component format
    const transformed = {
      ...metrics,
      baseline: {},
      scenario: {},
      available_kpis: allKpis,
      simulation_period: { 
        start_day: minTime, 
        end_day: maxTime,
        start_week: minTime, 
        end_week: maxTime 
      }
    };
    
    // Preserve summary KPI values if provided by backend
    if (metrics.baseline?.kpi_values) {
      (transformed as any).baseline.kpi_values = metrics.baseline.kpi_values;
    }
    if (metrics.scenario?.kpi_values) {
      (transformed as any).scenario.kpi_values = metrics.scenario.kpi_values;
    }
    
    // Transform baseline data
    if (metrics.baseline) {
      baselineKpis.forEach(kpiId => {
        let timeSeriesData: any[] = [];
        
        if (hasKpiTimeSeries) {
          timeSeriesData = metrics.baseline.kpi_time_series?.[kpiId] || [];
        } else {
          timeSeriesData = metrics.baseline[kpiId] || [];
        }
        
         if (Array.isArray(timeSeriesData)) {
           transformed.baseline[kpiId] = timeSeriesData.map((point: any) => ({
             week: point.week || point.day || 0,
             day: point.day || point.week || 0,
             value: Number(point.value) || 0
           }));
         }
      });
    }
    
    // Transform scenario data
    if (metrics.scenario) {
      scenarioKpis.forEach(kpiId => {
        let timeSeriesData: any[] = [];
        
        if (hasKpiTimeSeries) {
          timeSeriesData = metrics.scenario.kpi_time_series?.[kpiId] || [];
        } else {
          timeSeriesData = metrics.scenario[kpiId] || [];
        }
        
         if (Array.isArray(timeSeriesData)) {
           transformed.scenario[kpiId] = timeSeriesData.map((point: any) => ({
             week: point.week || point.day || 0,
             day: point.day || point.week || 0,
             value: Number(point.value) || 0
           }));
         }
      });
    }
    
    // If no baseline data but we have scenario data, create empty baseline for consistency
    if (Object.keys(transformed.baseline).length === 0 && Object.keys(transformed.scenario).length > 0) {
      console.log('No baseline data found, creating empty baseline structure');
      scenarioKpis.forEach(kpiId => {
        transformed.baseline[kpiId] = [];
      });
    }
    
    console.log('Transformed simulation metrics:', transformed);
    return transformed;
  };

  // Get selected scenario result for display
  const selectedScenarioResult = React.useMemo(() => {
    if (!selectedJobId || !scenarioResultsMap[selectedJobId]) return null;
    
    const result = scenarioResultsMap[selectedJobId];
    if (result && result.metrics) {
      const transformedMetrics = transformSimulationData(result.metrics);
      if (transformedMetrics) {
        return {
          ...result,
          metrics: transformedMetrics
        };
      }
    }
    
    return null;
  }, [selectedJobId, scenarioResultsMap]);

  // Get independent baseline simulation for display (completely separate from selected scenario)
  const independentBaselineSimulation = React.useMemo(() => {
    // Only look for dedicated baseline simulations with job_type = "baseline"
    const dedicatedBaseline = baselineSimulations.find(s => 
      s.status === 'completed' && s.metrics && s.job_type === 'baseline'
    );
    
    if (dedicatedBaseline && dedicatedBaseline.metrics) {
      console.log('Using independent dedicated baseline simulation:', dedicatedBaseline.id);
      const transformedMetrics = transformSimulationData(dedicatedBaseline.metrics);
      if (transformedMetrics) {
        return {
          ...dedicatedBaseline,
          metrics: transformedMetrics
        };
      }
    }
    
    // Alternative: Look for baseline jobs in scenarioJobs if no dedicated baseline simulations
    const baselineJob = scenarioJobs.find(job => 
      job.job_type === 'baseline' && 
      scenarioResultsMap[job.id]?.status === 'completed' &&
      scenarioResultsMap[job.id]?.metrics
    );
    
    if (baselineJob && scenarioResultsMap[baselineJob.id]) {
      const result = scenarioResultsMap[baselineJob.id];
      console.log('Using baseline job from scenario results:', baselineJob.id);
      const transformedMetrics = transformSimulationData(result.metrics);
      if (transformedMetrics) {
        return {
          ...result,
          id: baselineJob.id,
          job_type: 'baseline' as const,
          metrics: transformedMetrics
        };
      }
    }
    
    console.log('No independent baseline simulation available');
    return null;
  }, [baselineSimulations, scenarioJobs, scenarioResultsMap]);

  // Simplified fallback - no longer needed with direct job-based data loading
  const fallbackScenarioData = React.useMemo(() => {
    // With the simplified job-based approach, fallback data should not be needed
    // Data comes directly from the simulation_jobs -> simulation_results relationship
    return null;
  }, [selectedJobId]);

  // Show toast when using fallback data
  React.useEffect(() => {
    if (fallbackScenarioData && !hasShownAutoSelectToast) {
      toast.info('Displaying results from individual scenario simulation');
      setHasShownAutoSelectToast(true);
    }
  }, [fallbackScenarioData, hasShownAutoSelectToast]);


  const fetchScenarioJobs = async () => {
    if (!globalSelectedProjectId) return;
    
    try {
      console.log('Fetching jobs via edge function: simulation-status');

      const { data: statusData, error: statusError } = await supabase.functions.invoke('simulation-status', {
        body: {
          project_id: globalSelectedProjectId
        }
      });

      if (statusError) {
        console.error('simulation-status error:', statusError);
        throw new Error(statusError.message || 'Failed to load jobs');
      }

      const jobs: ScenarioJob[] = (statusData?.jobs || []).map((job: any) => ({
        id: job.id,
        status: job.status,
        started_at: job.started_at,
        completed_at: job.completed_at,
        scenario_ids: job.scenario_ids || [],
        config: job.config || { scenario_details: [] },
        simulation_result_id: job.simulation_result_id || null,
        job_type: job.job_type as 'scenarios' | 'baseline' | 'baseline_scenario' | 'scenario_only'
      }));

      console.log('Jobs from simulation-status:', jobs);
      setScenarioJobs(jobs);

      // Process linked simulation results directly from jobs
      const newScenarioResultsMap: { [jobId: string]: SimulationResult } = {};
      const rawJobs = (statusData?.jobs || []);
      
      // 1) Prefer results joined by the edge function
      rawJobs.forEach((job: any) => {
        if (job.simulation_results && job.simulation_results.length > 0) {
          const simResult = job.simulation_results[0]; // Take first linked result
          console.log('Processing job result:', job.id, 'with simulation_result:', simResult.id);

          const scenarioResult: SimulationResult = {
            id: simResult.id,
            simulation_id: simResult.id,
            status: simResult.status || job.status,
            started_at: simResult.started_at || job.started_at,
            completed_at: simResult.completed_at || job.completed_at,
            scenario_ids: job.scenario_ids || [],
            metrics: cleanMetricsData(simResult.metrics)
          };

          if (scenarioResult.metrics) {
            newScenarioResultsMap[job.id] = scenarioResult;
          }
        }
      });

      // 2) Fetch missing results using RPC only (no direct table reads due to RLS)
      const jobsNeedingFetch = rawJobs.filter((job: any) => !newScenarioResultsMap[job.id] && job.simulation_result_id);
      if (jobsNeedingFetch.length > 0) {
        const ids = jobsNeedingFetch.map((j: any) => j.simulation_result_id);
        console.log(`🔍 Jobs needing simulation results fetch:`, jobsNeedingFetch.map(j => ({ 
          job_id: j.id, 
          result_id: j.simulation_result_id,
          status: j.status 
        })));
        
        // Check if our target result ID is in this batch
        const targetId = 'fdcf718d-9847-4e8a-93ce-046461d25558';
        if (ids.includes(targetId)) {
          console.log(`🎯 Target result ID ${targetId} found in batch, attempting RPC fetch...`);
        }

        // Use RPC call exclusively (bypasses RLS issues)
        try {
          const { data: rpcAll, error: rpcErr } = await supabase.rpc('get_simulation_results', {
            p_project_id: globalSelectedProjectId,
            p_user_id: user?.id || '',
            p_user_email: user?.email || ''
          });
          
          if (rpcErr) {
            console.error('❌ get_simulation_results RPC error:', rpcErr);
          } else if (rpcAll) {
            console.log(`📊 RPC returned ${rpcAll.length} total simulation results`);
            
            // Filter and normalize results for our needed IDs
            const matchedResults = (rpcAll as any[])
              .filter((r: any) => {
                const resultId = r.id || r.simulation_id;
                return ids.includes(resultId);
              })
              .map((r: any) => {
                const resultId = r.id || r.simulation_id;
                const metricsCandidate = r.metrics ?? r.metrics_json ?? r.result ?? r.data ?? r.payload;
                
                if (resultId === targetId) {
                  console.log(`🎯 Processing target result ${targetId}:`, {
                    status: r.status,
                    has_metrics: !!metricsCandidate,
                    metrics_type: typeof metricsCandidate
                  });
                }
                
                return {
                  id: resultId,
                  status: r.status,
                  started_at: r.started_at,
                  completed_at: r.completed_at,
                  metrics: metricsCandidate,
                };
              });

            console.log(`✅ Found ${matchedResults.length} matching results for needed IDs`);
            
            if (matchedResults.some(r => r.id === targetId)) {
              console.log(`✅ Target result ID ${targetId} successfully found in RPC results!`);
            } else {
              console.log(`❌ Target result ID ${targetId} NOT found in matched results`);
            }

            matchedResults.forEach((row: any) => {
              const job = jobsNeedingFetch.find((j: any) => j.simulation_result_id === row.id);
              if (!job) {
                console.log(`⚠️ No job found for result ${row.id}`);
                return;
              }

              const cleanedMetrics = cleanMetricsData(row.metrics);
              const scenarioResult: SimulationResult = {
                id: row.id,
                simulation_id: row.id,
                status: row.status || job.status,
                started_at: row.started_at || job.started_at,
                completed_at: row.completed_at || job.completed_at,
                scenario_ids: job.scenario_ids || [],
                metrics: cleanedMetrics
              };

              if (scenarioResult.metrics) {
                newScenarioResultsMap[job.id] = scenarioResult;
                console.log(`✅ Mapped result ${row.id} to job ${job.id} with valid metrics`);
                
                if (row.id === targetId) {
                  console.log(`🎯 Target result ${targetId} successfully mapped to job ${job.id}!`);
                }
              } else {
                console.log(`⚠️ Result ${row.id} has no valid metrics after cleaning`);
                if (row.id === targetId) {
                  console.log(`🎯 Target result ${targetId} failed metrics cleaning:`, row.metrics);
                }
              }
            });
          } else {
            console.log('📭 RPC returned no data');
          }
        } catch (e) {
          console.error('💥 Failed RPC call for simulation results:', e);
        }
      }

      console.log('Processed scenario results map:', newScenarioResultsMap);
      setScenarioResultsMap(newScenarioResultsMap);
      
    } catch (e) {
      console.error('Failed to fetch simulation results:', e);
      toast.error('Failed to load simulation results');
    }
  };

  // Remove unused functions since we now get data directly from jobs
  const fetchSimulations = async () => {
    // This function is no longer needed - data comes from fetchScenarioJobs
    console.log('fetchSimulations() is deprecated - data now comes from fetchScenarioJobs()');
  };

  const fetchScenarioResultByJob = async (jobId: string) => {
    // Results are now processed directly in fetchScenarioJobs
    console.log('fetchScenarioResultByJob() is deprecated - data processed in fetchScenarioJobs()');
  };
  const fetchProjects = async () => {
    if (!user) return;
    
    try {
      const { data, error } = await supabase.rpc('list_projects', {
        p_user_id: user.id,
        p_user_email: user.email || ''
      });
      
      if (error) throw error;
      setProjects(data || []);
    } catch (e) {
      console.error('Failed to fetch projects:', e);
      toast.error('Failed to load projects');
    }
  };
  const fetchScenarios = async () => {
    if (!user || !globalSelectedProjectId) return;
    
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('get_disruption_scenarios', {
        p_project_id: globalSelectedProjectId,
        p_plant_name: null, // No plant filtering
        p_user_id: user.id,
        p_user_email: user.email,
      });

      if (error) throw error;

      const transformedScenarios: DisruptionScenario[] = (data || []).map((item: any) => ({
        id: item.id,
        scenario_name: item.scenario_name,
        description: item.description,
        status: item.status,
        created_at: item.created_at,
        disruption_start: item.disruption_start,
        disruption_end: item.disruption_end,
        targets: Array.isArray(item.targets) ? item.targets : [],
        effects: Array.isArray(item.effects) ? item.effects : [],
      }));

      setScenarios(transformedScenarios);
    } catch (e) {
      console.error('Failed to fetch scenarios:', e);
      toast.error('Failed to load disruption scenarios');
    } finally {
      setLoading(false);
    }
  };

  // Deprecated: fetchSimulations is no longer needed - data comes from fetchScenarioJobs
  // const fetchSimulations = async () => { ... };

  const fetchBaselineSimulations = async () => {
    if (!user || !globalSelectedProjectId) return;
    
    try {
      console.log('Fetching baseline simulations for project:', globalSelectedProjectId);
      console.log('User context:', { id: user.id, email: user.email, organization: user.organization });
      
      // Use the new RPC function to get baseline simulation results
      const { data, error } = await supabase
        .rpc('get_baseline_simulation_results', {
          p_project_id: globalSelectedProjectId,
          p_user_id: user.id,
          p_user_email: user.email || ''
        });

      if (error) {
        console.error('Fetch baseline simulations error:', error);
        if (error.message?.includes('organization') || error.message?.includes('access denied')) {
          toast.error('Access denied for baseline - organization mismatch may persist');
        }
        throw error;
      }
      
      console.log('Fetched baseline simulations:', data);
      console.log('Baseline data length:', data?.length || 0);
      
      if (!data || data.length === 0) {
        console.log('No baseline simulation data available - this should now work after organization fix');
      }
      
      // Filter out invalid/malformed data and transform
      const validResults = (data || []).filter((result: any) => 
        result && 
        result.simulation_id && 
        result.metrics &&
        typeof result.metrics === 'object' &&
        !JSON.stringify(result.metrics).includes('MaxDepthReached')
      );

      const baselineSimulations: BaselineSimulation[] = validResults.map((result: any) => ({
        id: result.simulation_id,
        status: result.status,
        started_at: result.started_at,
        completed_at: result.completed_at,
        metrics: cleanMetricsData(result.metrics),
        job_type: 'baseline' as const
      }));
      
      console.log(`Filtered ${validResults.length} valid baseline results from ${(data || []).length} total results`);
      console.log('Setting baseline simulations:', baselineSimulations);
      setBaselineSimulations(baselineSimulations);
    } catch (e) {
      console.error('Failed to fetch baseline simulations:', e);
      toast.error('Failed to load baseline simulation results - check console for details');
      setBaselineSimulations([]); // Clear baselines on error
    }
  };

  const runSimulation = async () => {
    if (!user || !globalSelectedProjectId || selectedScenarios.length === 0) {
      toast.error('Please select at least one scenario to run');
      return;
    }

    setRunningSimulation(true);
    
    try {
      // Collect current magnitude values from UI state
      const currentMagnitudes: { [key: string]: number } = {};
      selectedScenarios.forEach(scenarioId => {
        const scenario = scenarios.find(s => s.id === scenarioId);
        if (scenario?.effects?.[0]?.magnitude) {
          currentMagnitudes[scenarioId] = scenario.effects[0].magnitude;
        }
      });

      toast.info('Starting scenario simulation...');

      const { data: simulationData, error: simulationError } = await supabase.functions.invoke('simulation-runner', {
        body: {
          project_id: globalSelectedProjectId,
          scenario_ids: selectedScenarios,
          config: {
            baseline_enabled: false,
            priority: 1,
            simulation_days: 60,
            convergence_threshold: 0.001
          },
          current_magnitudes: currentMagnitudes,
          user_id: user.id,
          user_email: user.email || ''
        }
      });

      if (simulationError) {
        console.error('Simulation runner error:', simulationError);
        throw new Error(simulationError.message || 'Failed to start simulation');
      }

      if (!simulationData.success) {
        throw new Error(simulationData.error || 'Simulation failed to start');
      }

      console.log('Simulation started successfully:', simulationData);
      
      const jobCount = simulationData.jobs_created?.length || 0;
      const estimatedMinutes = Math.round(simulationData.estimated_duration_seconds / 60);
      toast.success(`${jobCount} scenario job${jobCount > 1 ? 's' : ''} queued! Estimated time: ${estimatedMinutes} minutes`);
      
      // Refresh simulation jobs to show the new jobs/results
      fetchScenarioJobs();
    } catch (e) {
      console.error('Failed to run simulation:', e);
      toast.error(`Failed to start simulation: ${e.message}`);
    } finally {
      setRunningSimulation(false);
    }
  };

  const runBaselineSimulation = async () => {
    if (!globalSelectedProjectId || !user) {
      toast.error('Please ensure you have a project selected');
      return;
    }

    setRunningSimulation(true);
    
    try {
      const { error } = await supabase.functions.invoke('simulation-runner', {
        body: {
          project_id: globalSelectedProjectId,
          scenario_ids: [], // Empty for baseline
          current_magnitudes: {},
          availability_check: true, // triggers baseline computation
          config: {
            simulation_days: 180, // 6 months default
            convergence_threshold: 0.001,
            priority: 1,
          },
          user_id: user.id,
          user_email: user.email || ''
        }
      });

      if (error) {
        console.error('Baseline simulation error:', error);
        toast.error(`Baseline simulation failed: ${error.message}`);
        return;
      }

      toast.success('Baseline simulation started! This will provide a standalone baseline for comparison.');
      
      // Refresh baseline results after starting
      setTimeout(() => {
        fetchBaselineSimulations();
      }, 3000);
      
    } catch (error) {
      console.error('Baseline simulation error:', error);
      toast.error(`Baseline simulation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setRunningSimulation(false);
    }
  };

  const seedSyntheticData = async () => {
    if (!user || !globalSelectedProjectId) {
      toast.error('Please select a project first');
      return;
    }
    try {
      const { data, error } = await (supabase.rpc as any)('seed_synthetic_simulation_data', {
        p_project_id: globalSelectedProjectId,
        p_user_id: user.id,
        p_user_email: user.email,
        p_num_profiles: 5,
        p_num_simulations: 3,
      });
      if (error) throw error;
      console.log('Seed result:', data);
      toast.success('Seeded synthetic scenarios and simulations');
      await fetchScenarios();
      await fetchScenarioJobs();
    } catch (e) {
      console.error('Failed to seed data:', e);
      toast.error('Failed to seed synthetic data');
    }
  };

  const toggleScenarioSelection = (scenarioId: string) => {
    setSelectedScenarios(prev =>
      prev.includes(scenarioId)
        ? prev.filter(id => id !== scenarioId)
        : [...prev, scenarioId]
    );
  };

  // Optimistic UI update for immediate feedback
  const updateScenarioMagnitudeUI = (scenarioId: string, newMagnitude: number) => {
    setScenarios(prev => prev.map(s => 
      s.id === scenarioId 
        ? { 
            ...s, 
            effects: s.effects.map(effect => ({ ...effect, magnitude: newMagnitude }))
          }
        : s
    ));
  };

  // Database update function for effect type
  const updateScenarioEffectType = async (scenarioId: string, effectType: string, unit: string) => {
    if (!user || !globalSelectedProjectId) return;

    try {
      // Optimistic update
      setScenarios(prev => prev.map(s => 
        s.id === scenarioId 
          ? { 
              ...s, 
              effects: s.effects.map(effect => ({ ...effect, effect_type: effectType, unit }))
            }
          : s
      ));

      const { error } = await supabase
        .from('disruption_scenarios')
        .update({ 
          capacity_reduction_percent: effectType === 'capacity_reduction' ? 50 : null,
          time_delay_days: effectType === 'time_delay' ? 7 : null
        })
        .eq('id', scenarioId);

      if (error) throw error;
      
      toast.success('Effect type updated successfully');
    } catch (error) {
      console.error('Error updating effect type:', error);
      toast.error('Failed to update effect type');
    }
  };

  // Database update function
  const updateScenarioMagnitude = async (scenarioId: string, newMagnitude: number) => {
    if (!user || !globalSelectedProjectId) return;

    try {
      // Update using RPC with proper authorization and context
      const { data, error } = await supabase.rpc('update_scenario_effect_magnitude_by_profile', {
        p_profile_id: scenarioId,
        p_user_id: user.id,
        p_user_email: user.email,
        p_magnitude: newMagnitude
      });

      if (error) {
        console.error('Failed to update scenario magnitude:', error);
        toast.error('Failed to update scenario impact');
        // Revert optimistic update on error
        fetchScenarios();
        return;
      }
      
      if (data === 0) {
        console.warn('No effects updated - scenario may not have capacity_reduction effects');
        toast.error('No effects found to update');
        fetchScenarios();
        return;
      }
      
      // Get the effect type to show appropriate toast message
      const scenario = scenarios.find(s => s.id === scenarioId);
      const effectType = scenario?.effects?.[0]?.effect_type;
      const unit = scenario?.effects?.[0]?.unit;
      
      if (effectType === 'time_delay') {
        toast.success(`Updated delay to ${newMagnitude} ${unit || 'days'}`);
      } else {
        toast.success(`Updated capacity reduction to ${newMagnitude}%`);
      }
    } catch (error: any) {
      console.error('Failed to update scenario magnitude:', error);
      toast.error('Failed to update scenario impact');
      // Revert optimistic update on error
      fetchScenarios();
    }
  };

  const deleteAllScenarios = async () => {
    if (!user || !globalSelectedProjectId) return;
    if (!window.confirm('Delete all disruption scenarios?')) return;

    try {
      const { data, error } = await supabase.rpc('delete_all_disruption_scenarios', {
        p_project_id: globalSelectedProjectId,
        p_user_id: user.id,
        p_user_email: user.email,
      });

      if (error) throw error;

      toast.success('All disruption scenarios deleted');
      setSelectedScenarios([]);
      fetchScenarios();
    } catch (e) {
      console.error('Failed to delete scenarios:', e);
      toast.error('Failed to delete disruption scenarios');
    }
  };

  const handleEditScenario = (scenarioId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    console.log('Edit functionality for scenario:', scenarioId);
    
    // Find the scenario to edit
    const scenarioToEdit = scenarios.find(s => s.id === scenarioId);
    if (!scenarioToEdit) {
      toast.error('Scenario not found');
      return;
    }
    
    // For now, we'll show the disruption dialog in edit mode
    setDisruptionDialogOpen(true);
    toast.success('Opening edit dialog (pre-population coming soon)');
  };

  const handleCopyScenario = async (scenario: DisruptionScenario, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!user || !globalSelectedProjectId) return;

    try {
      const { error } = await (supabase.rpc as any)('create_disruption_scenario_v2', {
        p_project_id: globalSelectedProjectId,
        p_plant_name: projects.find(p => p.id === globalSelectedProjectId)?.plant_name || 'Unknown Plant',
        p_scenario_name: `${scenario.scenario_name} (Copy)`,
        p_user_id: user.id,
        p_user_email: user.email,
        p_description: scenario.description,
        p_targets: scenario.targets,
        p_effects: scenario.effects,
        p_status: 'draft',
        p_tags: [],
        p_settings: null,
        p_disruption_start: null,
        p_disruption_end: null
      });

      if (error) throw error;

      await fetchScenarios();
      toast.success('Scenario copied successfully');
    } catch (error: any) {
      console.error('Error copying scenario:', error);
      toast.error('Failed to copy scenario');
    }
  };

  const handleDeleteScenario = async (scenarioId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!user || !globalSelectedProjectId) return;
    
    if (!window.confirm('Delete this scenario?')) return;

    try {
      const { error } = await (supabase.rpc as any)('delete_disruption_scenario', {
        p_scenario_id: scenarioId,
        p_user_id: user.id,
        p_user_email: user.email
      });

      if (error) throw error;

      await fetchScenarios();
      setSelectedScenarios(prev => prev.filter(id => id !== scenarioId));
      toast.success('Scenario deleted successfully');
    } catch (error: any) {
      console.error('Error deleting scenario:', error);
      toast.error('Failed to delete scenario');
    }
  };

  // Simulation management functions
  const toggleSimulationSelection = (simulationId: string) => {
    setSelectedSimulations(prev => 
      prev.includes(simulationId)
        ? prev.filter(id => id !== simulationId)
        : [...prev, simulationId]
    );
  };

  const selectAllSimulations = () => {
    setSelectedSimulations(simulations.map(sim => sim.id));
  };

  const clearSimulationSelection = () => {
    setSelectedSimulations([]);
  };

  const downloadSimulation = async (simulationId: string) => {
    try {
      const simulation = simulations.find(s => s.id === simulationId);
      if (!simulation) {
        toast.error('Simulation not found');
        return;
      }

      const data = {
        id: simulation.id,
        status: simulation.status,
        started_at: simulation.started_at,
        completed_at: simulation.completed_at,
        scenario_ids: simulation.scenario_ids,
        metrics: simulation.metrics,
        created_at: new Date().toISOString()
      };

      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `simulation-${simulationId}-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast.success('Simulation data downloaded');
    } catch (error) {
      console.error('Download error:', error);
      toast.error('Failed to download simulation data');
    }
  };

  const downloadSelectedSimulations = async () => {
    if (selectedSimulations.length === 0) return;

    try {
      const selectedSims = simulations.filter(s => selectedSimulations.includes(s.id));
      const data = {
        exported_at: new Date().toISOString(),
        project_id: globalSelectedProjectId,
        simulations: selectedSims.map(sim => ({
          id: sim.id,
          status: sim.status,
          started_at: sim.started_at,
          completed_at: sim.completed_at,
          scenario_ids: sim.scenario_ids,
          metrics: sim.metrics
        }))
      };

      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `simulations-batch-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast.success(`${selectedSimulations.length} simulation(s) downloaded`);
    } catch (error) {
      console.error('Batch download error:', error);
      toast.error('Failed to download simulation data');
    }
  };

  const deleteSimulation = async (simulationId: string) => {
    if (!user || !canModifyProject) {
      toast.error('Permission denied');
      return;
    }

    try {
      const { error } = await supabase.rpc('delete_simulation_result', {
        p_simulation_id: simulationId,
        p_user_id: user.id,
        p_user_email: user.email || ''
      });

      if (error) throw error;

      toast.success('Simulation deleted');
      fetchScenarioJobs();
      setSelectedSimulations(prev => prev.filter(id => id !== simulationId));
    } catch (error: any) {
      console.error('Delete error:', error);
      toast.error(error?.message || 'Failed to delete simulation');
    }
  };

  const deleteSelectedSimulations = async () => {
    if (selectedSimulations.length === 0) return;
    if (!user || !canModifyProject) {
      toast.error('Permission denied');
      return;
    }

    const confirmDelete = window.confirm(
      `Are you sure you want to delete ${selectedSimulations.length} simulation(s)? This action cannot be undone.`
    );

    if (!confirmDelete) return;

    try {
      const { data: deletedCount, error } = await supabase.rpc('delete_simulation_results_batch', {
        p_simulation_ids: selectedSimulations,
        p_user_id: user.id,
        p_user_email: user.email || ''
      });

      if (error) throw error;

      toast.success(`${deletedCount || 0} simulation(s) deleted successfully`);
      fetchScenarioJobs();
      setSelectedSimulations([]);
    } catch (error: any) {
      console.error('Batch delete error:', error);
      toast.error(error?.message || 'Failed to delete simulations');
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'running':
        return <Clock className="h-4 w-4 text-yellow-500" />;
      case 'completed':
        return <CheckCircle className="h-4 w-4 text-green-500" />;
      case 'failed':
        return <XCircle className="h-4 w-4 text-red-500" />;
      default:
        return <Clock className="h-4 w-4 text-gray-500" />;
    }
  };

  const handleExport = async () => {
    try {
      const dataToExport = {
        project_id: globalSelectedProjectId,
        scenario_jobs: scenarioJobs,
        selected_job: selectedJobId ? scenarioResultsMap[selectedJobId] : null,
        baseline_simulation: independentBaselineSimulation,
        exported_at: new Date().toISOString(),
        filter_state: filterState
      };
      
      const blob = new Blob([JSON.stringify(dataToExport, null, 2)], {
        type: 'application/json'
      });
      
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `simulation-results-${format(new Date(), 'yyyy-MM-dd-HHmm')}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
      toast.success('Simulation results exported successfully');
    } catch (e) {
      console.error('Failed to export:', e);
      toast.error('Failed to export simulation results');
    }
  };

  useEffect(() => {
    if (user) {
      fetchProjects();
    }
  }, [user]);

  useEffect(() => {
    fetchScenarios();
    fetchScenarioJobs();
    fetchBaselineSimulations();
  }, [globalSelectedProjectId]);

  // Auto-select latest job when jobs are loaded but no job is selected
  useEffect(() => {
    if (scenarioJobs.length > 0 && !selectedJobId) {
      const latestJob = scenarioJobs.reduce((latest, current) => 
        new Date(current.completed_at || current.started_at || 0) > new Date(latest.completed_at || latest.started_at || 0) 
          ? current 
          : latest
      );
      
      setSelectedJobId(latestJob.id);
      
      if (!hasShownAutoSelectToast) {
        toast.info('Displaying latest simulation job automatically', {
          description: 'Select a different job from the dropdown to view other results'
        });
        setHasShownAutoSelectToast(true);
      }
    }
  }, [scenarioJobs, selectedJobId, hasShownAutoSelectToast]);

  // Real-time subscription for disruption_scenario_effects updates
  useEffect(() => {
    if (!globalSelectedProjectId) return;

    const channel = supabase
      .channel('disruption-effects-changes')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'disruption_scenario_effects'
        },
        (payload) => {
          console.log('Real-time update received:', payload);
          // Refetch scenarios to get updated data
          fetchScenarios();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [globalSelectedProjectId]);

  useEffect(() => {
    setCurrentPage(1);
  }, [scenarios]);

  // Computed variable to check if there are any displayable results
  const hasDisplayableResults = (
    Object.values(scenarioResultsMap).some(r => !!r?.metrics) ||
    scenarioJobs.some(j => j.status === 'completed')
  );

  return (
    <PageLayout isCollapsed={isCollapsed} setIsCollapsed={setIsCollapsed}>
      <div className="px-12 py-6">
        <PageHeader
          title="Simulation Center"
          subtitle={`Run disruption scenarios and analyze supply chain resilience across ${scenarios.length} available scenario${scenarios.length !== 1 ? 's' : ''}`}
          onRefresh={fetchScenarios}
          refreshLoading={loading}
          rightContent={
            <div className="flex items-center space-x-2">
              {canModifyProject && (
                <>
                  <Button
                    onClick={seedSyntheticData}
                    disabled={loading || !globalSelectedProjectId}
                    variant="secondary"
                    size="sm"
                    title="Seed synthetic scenarios and simulations"
                  >
                    <Plus className="h-4 w-4 mr-1" />
                    Seed data
                  </Button>
                  
                  <Button
                    onClick={runBaselineSimulation}
                    disabled={loading || !globalSelectedProjectId || runningSimulation}
                    variant="secondary"
                    size="sm"
                    title="Generate baseline simulation for comparison"
                  >
                    <ChartBar className="h-4 w-4 mr-1" />
                    Baseline
                  </Button>
                </>
              )}

              <Select value={globalSelectedProjectId || ''} onValueChange={setGlobalSelectedProjectId}>
                <SelectTrigger className="w-[180px] h-9">
                  <SelectValue placeholder="Select Project" />
                </SelectTrigger>
                <SelectContent>
                  {projects.map((project) => (
                    <SelectItem key={project.id} value={project.id}>
                      {project.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          }
        />
        <div className="space-y-6">

          {globalSelectedProjectId ? (
            <div className="grid grid-cols-1 xl:grid-cols-4 gap-6">
              {/* Disruption Scenarios */}
              <div className="xl:col-span-3">
                <Card>
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <CardTitle className="flex items-center gap-2">
                        <AlertTriangle className="h-5 w-5" />
                        Disruption Scenarios
                        {selectedScenarios.length > 0 && (
                          <Badge variant="secondary" className="ml-2">
                            {selectedScenarios.length} selected
                          </Badge>
                        )}
                      </CardTitle>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setDisruptionDialogOpen(true)}
                          aria-label="Add scenario"
                          title="Add scenario"
                        >
                          <Plus className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={deleteAllScenarios}
                          disabled={scenarios.length === 0}
                          aria-label="Delete all scenarios"
                          title="Delete all scenarios"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    {scenarios.length === 0 ? (
                      <div className="text-center py-12 text-muted-foreground">
                        <AlertTriangle className="h-16 w-16 mx-auto mb-4 opacity-30" />
                        <h3 className="text-lg font-semibold mb-2">No Disruption Scenarios</h3>
                        <p className="mb-2">Get started by creating disruption scenarios.</p>
                        <p className="text-sm">
                          Navigate to the Product-Level Network and right-click nodes to create scenarios.
                        </p>
                      </div>
                    ) : (
                       <>
                         <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                           {currentScenarios.map((scenario) => (
                             <Card
                               key={scenario.id}
                               className={`cursor-pointer transition-all duration-200 hover:shadow-lg ${
                                 selectedScenarios.includes(scenario.id)
                                   ? 'ring-2 ring-primary bg-primary/5'
                                   : 'hover:bg-muted/30'
                               }`}
                               onClick={() => toggleScenarioSelection(scenario.id)}
                             >
                                <CardContent className="p-4">
                                  <div className="flex items-start justify-between mb-3">
                                    <div className="flex-1">
                                      <h4 className="font-semibold text-sm mb-1">{scenario.scenario_name}</h4>
                                      {/* Disruption Type Badge */}
                                      {scenario.effects?.[0] && (
                                        <div className="flex justify-start mt-2">
                                          <Badge 
                                            variant="outline" 
                                            className="flex items-center gap-1 text-xs bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-300 border-red-200 dark:border-red-800 cursor-pointer hover:bg-red-100 dark:hover:bg-red-900/40"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              const currentType = scenario.effects?.[0]?.effect_type;
                                              const newEffectType = currentType === 'capacity_reduction' ? 'time_delay' : 'capacity_reduction';
                                              const newUnit = newEffectType === 'capacity_reduction' ? 'percent' : 'days';
                                              updateScenarioEffectType(scenario.id, newEffectType, newUnit);
                                            }}
                                          >
                                            {scenario.effects[0].effect_type === 'time_delay' ? (
                                              <>
                                                <Clock className="h-3 w-3" /> Time delay
                                              </>
                                            ) : (
                                              <>
                                                <TrendingDown className="h-3 w-3" /> Capacity Reduction
                                              </>
                                            )}
                                          </Badge>
                                        </div>
                                      )}
                                    </div>
                                   <div className="flex items-center gap-1">
                                     <div className="flex gap-1 mr-2">
                                       <TooltipProvider>
                                         <Tooltip>
                                           <TooltipTrigger asChild>
                                             <Button
                                               variant="ghost"
                                               size="icon"
                                               className="h-6 w-6 hover:bg-muted"
                                               onClick={(e) => handleEditScenario(scenario.id, e)}
                                             >
                                               <Edit className="h-3 w-3" />
                                             </Button>
                                           </TooltipTrigger>
                                           <TooltipContent>Edit scenario</TooltipContent>
                                         </Tooltip>
                                       </TooltipProvider>
                                       
                                       <TooltipProvider>
                                         <Tooltip>
                                           <TooltipTrigger asChild>
                                             <Button
                                               variant="ghost"
                                               size="icon"
                                               className="h-6 w-6 hover:bg-muted"
                                               onClick={(e) => handleCopyScenario(scenario, e)}
                                             >
                                               <Copy className="h-3 w-3" />
                                             </Button>
                                           </TooltipTrigger>
                                           <TooltipContent>Copy scenario</TooltipContent>
                                         </Tooltip>
                                       </TooltipProvider>

                                       <TooltipProvider>
                                         <Tooltip>
                                           <TooltipTrigger asChild>
                                             <Button
                                               variant="ghost"
                                               size="icon"
                                               className="h-6 w-6 hover:bg-destructive/10 hover:text-destructive"
                                               onClick={(e) => handleDeleteScenario(scenario.id, e)}
                                             >
                                               <Trash2 className="h-3 w-3" />
                                             </Button>
                                           </TooltipTrigger>
                                           <TooltipContent>Delete scenario</TooltipContent>
                                         </Tooltip>
                                       </TooltipProvider>
                                      </div>
                                    </div>
                                  </div>

                                       <div className="space-y-4">
                                          {/* Target Information */}
                                          <div className="space-y-2 mt-4">
                                           <span className="text-xs text-muted-foreground font-medium">Disruption location:</span>
                                           <div className="bg-secondary/50 p-2 rounded-md border">
                                           <span className="font-mono text-sm font-medium">{(() => {
                                             const allNodeIds = scenario.targets.flatMap(target => target.node_ids || []);
                                             const hasEdges = scenario.targets.some(target => target.edge_list);
                                             
                                             if (allNodeIds.length > 0) {
                                               return allNodeIds[0]; // Show first target prominently
                                             } else if (hasEdges) {
                                               return `${scenario.targets.filter(t => t.edge_list).length} Edge(s)`;
                                             } else {
                                               return 'No targets';
                                             }
                                           })()}</span>
                                           {(() => {
                                             const allNodeIds = scenario.targets.flatMap(target => target.node_ids || []);
                                             if (allNodeIds.length > 1) {
                                               return (
                                                 <div className="text-xs text-muted-foreground mt-1">
                                                   +{allNodeIds.length - 1} more target{allNodeIds.length > 2 ? 's' : ''}
                                                 </div>
                                               );
                                             }
                                             return null;
                                           })()}
                                         </div>
                                       </div>
                                     
                                      {/* Impact Control Slider */}
                                      <div className="space-y-3">
                                        <div className="flex items-center justify-between text-xs">
                                          <span className="text-muted-foreground flex items-center">
                                            <AlertTriangle className="h-3 w-3 mr-1" />
                                            {scenario.effects?.[0]?.effect_type === 'time_delay' ? 'Delay Duration' : 'Impact Level'}
                                          </span>
                                          <span className="font-semibold">
                                            {scenario.effects?.[0]?.effect_type === 'time_delay' 
                                              ? `${scenario.effects?.[0]?.magnitude || 0} ${scenario.effects?.[0]?.unit || 'days'}`
                                              : `${scenario.effects?.[0]?.magnitude || 50}${scenario.effects?.[0]?.unit === 'percent' ? '%' : ' units'}`
                                            }
                                          </span>
                                        </div>
                                         <div className="px-1">
                                           <Slider
                                             value={[scenario.effects?.[0]?.magnitude || 50]}
                                             onValueChange={(value) => {
                                               updateScenarioMagnitudeUI(scenario.id, value[0]);
                                             }}
                                             onValueCommit={(value) => {
                                               updateScenarioMagnitude(scenario.id, value[0]);
                                             }}
                                             max={(() => {
                                               const effect = scenario.effects?.[0];
                                               if (effect?.effect_type === 'time_delay') {
                                                 return effect.unit === 'weeks' ? 26 : 100; // 26 weeks or 100 days
                                               }
                                               return effect?.unit === 'percent' ? 100 : 1000;
                                             })()}
                                             min={0}
                                             step={(() => {
                                               const effect = scenario.effects?.[0];
                                               if (effect?.effect_type === 'capacity_reduction' && effect?.unit === 'percent') {
                                                 return 5; // 5% increments for capacity reduction
                                               }
                                               return effect?.effect_type === 'time_delay' ? 1 : 1;
                                             })()}
                                             className="w-full"
                                             onClick={(e) => e.stopPropagation()}
                                           />
                                         </div>
                                      </div>

                                     {/* Disruption Timing */}
                                     <div className="space-y-2">
                                       <div className="grid grid-cols-2 gap-2">
                                         <div className="space-y-1">
                                           <span className="text-xs text-muted-foreground">Start</span>
                                           <Popover>
                                             <PopoverTrigger asChild>
                                               <Button
                                                 variant="outline"
                                                 className={cn(
                                                   "h-7 w-full justify-start text-xs font-normal",
                                                   !scenario.disruption_start && "text-muted-foreground"
                                                 )}
                                                 onClick={(e) => e.stopPropagation()}
                                               >
                                                 <CalendarIcon className="mr-1 h-3 w-3" />
                                                 {scenario.disruption_start ? (
                                                   format(new Date(scenario.disruption_start), "MMM dd")
                                                 ) : (
                                                   <span>Start</span>
                                                 )}
                                               </Button>
                                             </PopoverTrigger>
                                             <PopoverContent className="w-auto p-0" align="start">
                                               <Calendar
                                                 mode="single"
                                                 selected={scenario.disruption_start ? new Date(scenario.disruption_start) : undefined}
                                                 onSelect={(date) => {
                                                   // TODO: Update start date - for now just visual
                                                   console.log('Start date changed:', date);
                                                 }}
                                                 initialFocus
                                                 className={cn("p-3 pointer-events-auto")}
                                               />
                                             </PopoverContent>
                                           </Popover>
                                         </div>
                                         <div className="space-y-1">
                                           <span className="text-xs text-muted-foreground">End</span>
                                           <Popover>
                                             <PopoverTrigger asChild>
                                               <Button
                                                 variant="outline"
                                                 className={cn(
                                                   "h-7 w-full justify-start text-xs font-normal",
                                                   !scenario.disruption_end && "text-muted-foreground"
                                                 )}
                                                 onClick={(e) => e.stopPropagation()}
                                               >
                                                 <CalendarIcon className="mr-1 h-3 w-3" />
                                                 {scenario.disruption_end ? (
                                                   format(new Date(scenario.disruption_end), "MMM dd")
                                                 ) : (
                                                   <span>End</span>
                                                 )}
                                               </Button>
                                             </PopoverTrigger>
                                             <PopoverContent className="w-auto p-0" align="start">
                                               <Calendar
                                                 mode="single"
                                                 selected={scenario.disruption_end ? new Date(scenario.disruption_end) : undefined}
                                                 onSelect={(date) => {
                                                   // TODO: Update end date - for now just visual
                                                   console.log('End date changed:', date);
                                                 }}
                                                 initialFocus
                                                 className={cn("p-3 pointer-events-auto")}
                                               />
                                             </PopoverContent>
                                           </Popover>
                                         </div>
                                       </div>
                                     </div>
                                  </div>
                               </CardContent>
                             </Card>
                           ))}
                         </div>

                         {totalPages > 1 && (
                           <div className="mt-6">
                             <Pagination>
                               <PaginationContent>
                                 <PaginationItem>
                                   <PaginationPrevious 
                                     onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                                     className={currentPage === 1 ? 'pointer-events-none opacity-50' : 'cursor-pointer'}
                                   />
                                 </PaginationItem>
                                 
                                 {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
                                   <PaginationItem key={page}>
                                     <PaginationLink
                                       onClick={() => setCurrentPage(page)}
                                       isActive={currentPage === page}
                                       className="cursor-pointer"
                                     >
                                       {page}
                                     </PaginationLink>
                                   </PaginationItem>
                                 ))}
                                 
                                 <PaginationItem>
                                   <PaginationNext 
                                     onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                                     className={currentPage === totalPages ? 'pointer-events-none opacity-50' : 'cursor-pointer'}
                                   />
                                 </PaginationItem>
                               </PaginationContent>
                             </Pagination>
                           </div>
                         )}
                       </>
                    )}
                  </CardContent>
                </Card>
              </div>

              {/* Simulation Control Panel */}
              <div className="xl:col-span-1">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Play className="h-5 w-5" />
                      Simulation Control
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="space-y-2">
                      <div className="text-sm font-medium">Selected Scenarios</div>
                      <div className="text-xs text-muted-foreground">
                        {selectedScenarios.length === 0 ? (
                          'No scenarios selected'
                        ) : (
                          `${selectedScenarios.length} scenario${selectedScenarios.length !== 1 ? 's' : ''} selected`
                        )}
                      </div>
                    </div>

                    <div className="flex gap-2">
                      <Button
                        onClick={runSimulation}
                        disabled={selectedScenarios.length === 0 || runningSimulation}
                        className="flex-1"
                      >
                        {runningSimulation ? (
                          <>
                            <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                            Running...
                          </>
                        ) : (
                          <>
                            <Play className="h-4 w-4 mr-2" />
                            Run Simulation
                          </>
                        )}
                      </Button>
                      
                    </div>

                    <div className="pt-4 border-t space-y-2">
                      <div className="text-sm font-medium">Recent Activity</div>
                      {(() => {
                        // Helper function to format job description
                        const formatJobDescription = (activity: any) => {
                          if (activity.type === 'baseline') {
                            return 'Baseline Calculation';
                          }
                          
                          if (activity.type === 'scenario') {
                            // Try to get scenario names from config
                            const scenarioDetails = activity.config?.scenario_details;
                            if (scenarioDetails && Array.isArray(scenarioDetails)) {
                              const names = scenarioDetails.map((s: any) => s.scenario_name).filter(Boolean);
                              if (names.length > 0) {
                                if (names.length === 1) {
                                  return names[0];
                                } else if (names.length <= 2) {
                                  return names.join(', ');
                                } else {
                                  return `${names.slice(0, 2).join(', ')} +${names.length - 2} more`;
                                }
                              }
                            }
                            
                            // Fallback to job type
                            if (activity.job_type === 'baseline') {
                              return 'Baseline Analysis';
                            }
                            return 'Scenario Analysis';
                          }
                          
                          return 'Analysis';
                        };

                        // Helper function to format effect summary for scenarios
                        const formatEffectSummary = (activity: any) => {
                          if (activity.type !== 'scenario') return null;
                          
                          const scenarioDetails = activity.config?.scenario_details;
                          if (!scenarioDetails || !Array.isArray(scenarioDetails)) return null;
                          
                          // Collect all effects from all scenarios
                          const allEffects = scenarioDetails.flatMap((scenario: any) => 
                            scenario.effects || []
                          ).filter(Boolean);
                          
                          if (allEffects.length === 0) return null;
                          
                          // Format up to 2 effects
                          const effectTexts = allEffects.slice(0, 2).map((effect: any) => {
                            if (effect.effect_type === 'capacity_reduction') {
                              return `${effect.magnitude}% capacity reduction`;
                            } else if (effect.effect_type === 'time_delay') {
                              return `${effect.magnitude} ${effect.unit || 'days'} delay`;
                            }
                            return `${effect.magnitude} ${effect.unit || 'units'} ${effect.effect_type}`;
                          });
                          
                          let summary = effectTexts.join(', ');
                          if (allEffects.length > 2) {
                            summary += ` +${allEffects.length - 2} more`;
                          }
                          
                          return summary;
                        };

                        // Helper function to format time ago
                        const formatTimeAgo = (dateStr: string) => {
                          if (!dateStr) return 'Unknown time';
                          const now = new Date();
                          const date = new Date(dateStr);
                          const diffMs = now.getTime() - date.getTime();
                          const diffMins = Math.floor(diffMs / (1000 * 60));
                          const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
                          const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

                          if (diffMins < 1) return 'Just now';
                          if (diffMins < 60) return `${diffMins}m ago`;
                          if (diffHours < 24) return `${diffHours}h ago`;
                          if (diffDays < 7) return `${diffDays}d ago`;
                          return date.toLocaleDateString();
                        };

                        // Combine and sort recent activities with enhanced data
                        const recentActivities = [
                          ...scenarioJobs.map(job => ({
                            id: job.id,
                            status: job.status,
                            started_at: job.started_at,
                            completed_at: job.completed_at,
                            config: job.config,
                            job_type: job.job_type,
                            scenario_ids: job.scenario_ids,
                            type: 'scenario'
                          })),
                          ...baselineSimulations.map(sim => ({
                            id: sim.id,
                            status: sim.status,
                            started_at: sim.started_at,
                            completed_at: sim.completed_at,
                            job_type: sim.job_type,
                            type: 'baseline'
                          }))
                        ]
                        .sort((a, b) => {
                          const aTime = new Date(a.completed_at || a.started_at || 0).getTime();
                          const bTime = new Date(b.completed_at || b.started_at || 0).getTime();
                          return bTime - aTime; // Most recent first
                        })
                        .slice(0, 3);

                        return recentActivities.length > 0 ? (
                          recentActivities.map((activity) => (
                            <div key={activity.id} className="space-y-0.5">
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-1.5">
                                  {getStatusIcon(activity.status)}
                                  <span className="text-xs font-medium truncate">
                                    {formatJobDescription(activity)}
                                  </span>
                                </div>
                                <span className="text-xs text-muted-foreground/70 flex-shrink-0">
                                  {formatTimeAgo(activity.completed_at || activity.started_at || '')}
                                </span>
                              </div>
                              {(() => {
                                const effectSummary = formatEffectSummary(activity);
                                return effectSummary ? (
                                  <div className="text-xs text-muted-foreground/80 truncate ml-5">
                                    {effectSummary}
                                  </div>
                                ) : null;
                              })()}
                            </div>
                          ))
                        ) : (
                          <div className="text-xs text-muted-foreground">No recent activities</div>
                        );
                      })()}
                    </div>
                  </CardContent>
                </Card>
              </div>
            </div>
          ) : (
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                Please select a project to view and manage disruption scenarios.
              </AlertDescription>
            </Alert>
          )}

          {/* Simulation Results */}
          {globalSelectedProjectId && (
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0">
                <CardTitle>Simulation Results</CardTitle>
                <Collapsible open={showSimulationResults} onOpenChange={setShowSimulationResults}>
                  <CollapsibleTrigger asChild>
                    <Button variant="ghost" size="sm" className="h-auto p-2">
                      {showSimulationResults ? 'Hide' : 'Show'}
                      {showSimulationResults ? (
                        <ChevronDown className="h-4 w-4 ml-1" />
                      ) : (
                        <ChevronRight className="h-4 w-4 ml-1" />
                      )}
                    </Button>
                  </CollapsibleTrigger>
                </Collapsible>
              </CardHeader>
              <Collapsible open={showSimulationResults} onOpenChange={setShowSimulationResults}>
                <CollapsibleContent>
                  <CardContent>
                {!hasDisplayableResults ? (
                  <div className="text-center py-8 text-muted-foreground">
                    No simulation results yet. Run a simulation to see individual results here.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Baseline Results */}
                    <div className="space-y-4">
                      <div className="flex items-center gap-2 mb-4">
                        <h3 className="text-lg font-semibold">Baseline Simulation</h3>
                        {independentBaselineSimulation?.status === 'completed' && (
                          <Badge variant="outline" className="text-green-600 border-green-600">Completed</Badge>
                        )}
                      </div>
                      {independentBaselineSimulation?.metrics ? (
                        <div className="space-y-3">
                          <div className="text-sm text-muted-foreground">
                            Job ID: {independentBaselineSimulation.id}
                          </div>
                          <div className="grid grid-cols-2 gap-3">
                            <div className="p-3 bg-muted/50 rounded-lg">
                              <div className="text-xs text-muted-foreground">Fill Rate</div>
                              <div className="text-lg font-semibold">
                                {independentBaselineSimulation.metrics.baseline?.kpi_values?.fill_rate ? 
                                  `${(independentBaselineSimulation.metrics.baseline.kpi_values.fill_rate * 100).toFixed(1)}%` : 'N/A'}
                              </div>
                            </div>
                            <div className="p-3 bg-muted/50 rounded-lg">
                              <div className="text-xs text-muted-foreground">Revenue</div>
                              <div className="text-lg font-semibold">
                                {independentBaselineSimulation.metrics.baseline?.kpi_values?.revenue ? 
                                  `$${(independentBaselineSimulation.metrics.baseline.kpi_values.revenue / 1000000).toFixed(1)}M` : 'N/A'}
                              </div>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="text-sm text-muted-foreground">No baseline simulation results available</div>
                      )}
                    </div>

                    {/* Scenario Results */}
                    <div className="space-y-4">
                      <div className="flex items-center gap-2 mb-4">
                        <h3 className="text-lg font-semibold">Scenario Simulation</h3>
                        {selectedScenarioResult?.status === 'completed' && (
                          <Badge variant="outline" className="text-blue-600 border-blue-600">Completed</Badge>
                        )}
                      </div>
                      {(selectedScenarioResult?.metrics || fallbackScenarioData?.metrics) ? (
                        <div className="space-y-3">
                          <div className="text-sm text-muted-foreground">
                            {selectedScenarioResult?.scenario_name || 'Scenario'} | Job ID: {selectedScenarioResult?.id}
                          </div>
                          <div className="grid grid-cols-2 gap-3">
                            <div className="p-3 bg-muted/50 rounded-lg">
                              <div className="text-xs text-muted-foreground">Fill Rate</div>
                              <div className="text-lg font-semibold">
                                {(() => {
                                  const fillRate = (selectedScenarioResult?.metrics as any)?.scenario?.kpi_values?.fill_rate ||
                                                 (fallbackScenarioData as any)?.metrics?.scenario?.kpi_values?.fill_rate ||
                                                 (selectedScenarioResult?.metrics as any)?.baseline?.kpi_values?.fill_rate;
                                  return fillRate ? `${(fillRate * 100).toFixed(1)}%` : 'N/A';
                                })()}
                              </div>
                            </div>
                            <div className="p-3 bg-muted/50 rounded-lg">
                              <div className="text-xs text-muted-foreground">Revenue</div>
                              <div className="text-lg font-semibold">
                                {(() => {
                                  const revenue = (selectedScenarioResult?.metrics as any)?.scenario?.kpi_values?.revenue ||
                                                (fallbackScenarioData as any)?.metrics?.scenario?.kpi_values?.revenue ||
                                                (selectedScenarioResult?.metrics as any)?.baseline?.kpi_values?.revenue;
                                  return revenue ? `$${(revenue / 1000000).toFixed(1)}M` : 'N/A';
                                })()}
                              </div>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="text-sm text-muted-foreground">No scenario simulation results available</div>
                      )}
                    </div>
                  </div>
                )}
                  </CardContent>
                </CollapsibleContent>
              </Collapsible>
            </Card>
          )}

          {/* Single Sim. Result Comparison */}
          {globalSelectedProjectId && (
            <Card className="relative">
              <CardHeader className="flex flex-row items-center justify-between space-y-0">
                <CardTitle>Single Sim. Result Comparison</CardTitle>
                <div className="flex items-center gap-2">
                  {independentBaselineSimulation?.status === 'completed' && (selectedScenarioResult?.status === 'completed' || fallbackScenarioData) && (
                    <Collapsible open={isDebugInfoExpanded} onOpenChange={setIsDebugInfoExpanded}>
                      <CollapsibleTrigger asChild>
                        <Button variant="ghost" size="sm" className="h-auto p-1 text-xs text-muted-foreground hover:text-foreground">
                          <Info className="h-3 w-3 mr-1" />
                          Debug Info
                          {isDebugInfoExpanded ? (
                            <ChevronDown className="h-3 w-3 ml-1" />
                          ) : (
                            <ChevronRight className="h-3 w-3 ml-1" />
                          )}
                        </Button>
                      </CollapsibleTrigger>
                    </Collapsible>
                  )}
                  <Collapsible open={showSingleComparison} onOpenChange={setShowSingleComparison}>
                    <CollapsibleTrigger asChild>
                      <Button variant="ghost" size="sm" className="h-auto p-2">
                        {showSingleComparison ? 'Hide' : 'Show'}
                        {showSingleComparison ? (
                          <ChevronDown className="h-4 w-4 ml-1" />
                        ) : (
                          <ChevronRight className="h-4 w-4 ml-1" />
                        )}
                      </Button>
                    </CollapsibleTrigger>
                  </Collapsible>
                </div>
              </CardHeader>
              {/* Debug Info Dropdown positioned outside header */}
              {independentBaselineSimulation?.status === 'completed' && (selectedScenarioResult?.status === 'completed' || fallbackScenarioData) && (
                <Collapsible open={isDebugInfoExpanded} onOpenChange={setIsDebugInfoExpanded}>
                  <CollapsibleContent className="absolute right-6 top-16 z-10 bg-background border rounded-md shadow-md">
                    <div className="text-xs text-muted-foreground/70 space-y-0.5 bg-muted/30 rounded-md p-3 min-w-[280px]">
                      <div>Baseline Job: {independentBaselineSimulation?.id}</div>
                      <div>Selected Job: {selectedScenarioResult?.id}</div>
                      <div className="text-xs text-muted-foreground/50">(Result: {selectedScenarioResult?.simulation_id})</div>
                      <div>Data Available: {independentBaselineSimulation?.metrics && selectedScenarioResult?.metrics ? 'Both' : 'Partial'}</div>
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              )}
              <Collapsible open={showSingleComparison} onOpenChange={setShowSingleComparison}>
                <CollapsibleContent>
                  <CardContent>
                    {!hasDisplayableResults ? (
                      <div className="text-center py-8 text-muted-foreground">
                        No simulation results yet. Run a simulation to see results here.
                      </div>
                    ) : (
                      <div className="space-y-6">
                        {/* Simulation Results Filter */}
                        <SimulationResultsFilter
                          scenarioJobs={scenarioJobs}
                          selectedJobId={selectedJobId}
                          filterState={filterState}
                          onSelectionChange={setSelectedJobId}
                          onFilterChange={(filters) => setFilterState(prev => ({ ...prev, ...filters }))}
                          onExport={handleExport}
                          loading={loading}
                        />

                            {/* KPI Cards - Two Row Layout */}
                            {independentBaselineSimulation?.metrics && (selectedScenarioResult?.metrics || fallbackScenarioData?.metrics) && (
                              <div className="space-y-4">
                                {/* First Row: Fill Rate and Revenue */}
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 max-w-6xl">
                                  {['fill_rate', 'revenue'].map((kpiId, index) => {
                                  // First row only has regular KPIs
                                  const isResilienceKPI = false;
                                  
                                  let baselineKPIData: any[], selectedKPIData: any[];
                                  let baselineSummary: any, selectedSummary: any;
                                  
                                  if (isResilienceKPI) {
                                    // For resilience KPIs, use fill_rate data for calculation
                                    baselineKPIData = independentBaselineSimulation.metrics?.baseline?.fill_rate || [];
                                    
                                    const primarySeries = (selectedScenarioResult?.metrics as any)?.scenario?.fill_rate;
                                    const fallbackSeries = (fallbackScenarioData as any)?.metrics?.scenario?.fill_rate;
                                    const altSeries = (selectedScenarioResult?.scenario_ids?.length > 0 && 
                                                     (selectedScenarioResult?.metrics as any)?.baseline?.fill_rate) || [];
                                    
                                    const hasPrimary = Array.isArray(primarySeries) && primarySeries.length > 0;
                                    const hasFallback = Array.isArray(fallbackSeries) && fallbackSeries.length > 0;
                                    const hasAlt = Array.isArray(altSeries) && altSeries.length > 0;
                                    
                                    selectedKPIData = hasPrimary ? primarySeries : 
                                                    (hasFallback ? fallbackSeries : 
                                                    (hasAlt ? altSeries : []));
                                    
                                    // Resilience KPIs don't have summary values - they're calculated in KPIDualCard
                                    baselineSummary = undefined;
                                    selectedSummary = undefined;
                                  } else {
                                    // Regular KPI handling
                                    baselineKPIData = independentBaselineSimulation.metrics?.baseline?.[kpiId] || [];
                                    
                                    const primarySeries = (selectedScenarioResult?.metrics as any)?.scenario?.[kpiId];
                                    const fallbackSeries = (fallbackScenarioData as any)?.metrics?.scenario?.[kpiId];
                                    const altSeries = (selectedScenarioResult?.scenario_ids?.length > 0 && 
                                                     (selectedScenarioResult?.metrics as any)?.baseline?.[kpiId]) || [];
                                    
                                    const hasPrimary = Array.isArray(primarySeries) && primarySeries.length > 0;
                                    const hasFallback = Array.isArray(fallbackSeries) && fallbackSeries.length > 0;
                                    const hasAlt = Array.isArray(altSeries) && altSeries.length > 0;
                                    
                                    selectedKPIData = hasPrimary ? primarySeries : 
                                                    (hasFallback ? fallbackSeries : 
                                                    (hasAlt ? altSeries : []));

                                    baselineSummary = (independentBaselineSimulation.metrics as any)?.baseline?.kpi_values?.[kpiId];
                                    const selectedSummaryPrimary = (selectedScenarioResult as any)?.metrics?.scenario?.kpi_values?.[kpiId];
                                    const selectedSummaryFallback = (fallbackScenarioData as any)?.metrics?.scenario?.kpi_values?.[kpiId];
                                    
                                    // For scenario-only jobs, check if scenario data is stored in baseline (same logic as time series)
                                    const selectedSummaryAlt = selectedScenarioResult?.scenario_ids && selectedScenarioResult.scenario_ids.length > 0 && 
                                      (!hasPrimary && !hasFallback && hasAlt)
                                      ? (selectedScenarioResult?.metrics as any)?.baseline?.kpi_values?.[kpiId] : undefined;
                                    
                                    selectedSummary = selectedSummaryPrimary !== undefined ? selectedSummaryPrimary : 
                                                    (selectedSummaryFallback !== undefined ? selectedSummaryFallback : selectedSummaryAlt);
                                  }
                                  
                                  // Data availability check - different logic for resilience vs regular KPIs
                                  if (isResilienceKPI) {
                                    // For resilience KPIs, we need fill_rate data from both baseline and scenario
                                    if (baselineKPIData.length === 0 || selectedKPIData.length === 0) {
                                      return null;
                                    }
                                  } else {
                                    // For regular KPIs, use the original logic
                                    if ((baselineKPIData.length === 0 && selectedKPIData.length === 0) && (baselineSummary === undefined && selectedSummary === undefined)) {
                                      return null;
                                    }
                                  }

                                  return (
                                    <div key={kpiId} className={kpiId === 'revenue' ? 'md:col-start-2' : ''}>
                                      <KPIDualCard
                                      key={kpiId}
                                      kpiId={kpiId}
                                      baselineData={baselineKPIData}
                                      selectedData={selectedKPIData}
                                      baselineSummary={baselineSummary}
                                      selectedSummary={selectedSummary}
                                      baselineLabel="Baseline"
                                       selectedLabel={selectedScenarioResult.scenario_name || 'Scenario'}
                                     />
                                    </div>
                                   );
                                })}
                                </div>
                                
                                {/* Second Row: Resilience KPIs */}
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 max-w-6xl">
                                  {['time_to_survive', 'time_to_adapt', 'time_to_recover'].map((kpiId) => {
                                    // Get baseline data for resilience calculations
                                    let baselineKPIData = independentBaselineSimulation.metrics?.baseline?.['fill_rate'] || [];
                                    
                                    // If no time series data, try to construct from kpi_values
                                    if (baselineKPIData.length === 0) {
                                      const baselineFillRate = independentBaselineSimulation.metrics?.baseline?.kpi_values?.fill_rate;
                                      if (typeof baselineFillRate === 'number') {
                                        // Create a simple time series with the single value
                                        baselineKPIData = [{ week: 0, value: baselineFillRate }];
                                      }
                                    }
                                    
                                    const primarySeries = (selectedScenarioResult?.metrics as any)?.scenario?.['fill_rate'];
                                    const fallbackSeries = (fallbackScenarioData as any)?.metrics?.scenario?.['fill_rate'];
                                    const altSeries = (selectedScenarioResult?.scenario_ids?.length > 0 && 
                                                     (selectedScenarioResult?.metrics as any)?.enhanced?.scenario?.['fill_rate']);
                                    // For scenario-only jobs, data might be in metrics.baseline
                                    const baselinePathSeries = (selectedScenarioResult?.metrics as any)?.baseline?.['fill_rate'];
                                    
                                    const hasPrimary = Array.isArray(primarySeries) && primarySeries.length > 0;
                                    const hasFallback = Array.isArray(fallbackSeries) && fallbackSeries.length > 0;
                                    const hasAlt = Array.isArray(altSeries) && altSeries.length > 0;
                                    const hasBaselinePath = Array.isArray(baselinePathSeries) && baselinePathSeries.length > 0;
                                    
                                    let selectedKPIData = hasPrimary ? primarySeries : 
                                                         (hasFallback ? fallbackSeries : 
                                                         (hasAlt ? altSeries : 
                                                         (hasBaselinePath ? baselinePathSeries : [])));

                                    // If no scenario time series, try kpi_values from multiple paths
                                    if (selectedKPIData.length === 0) {
                                      const scenarioFillRate = (selectedScenarioResult?.metrics as any)?.scenario?.kpi_values?.fill_rate ||
                                                              (fallbackScenarioData as any)?.metrics?.scenario?.kpi_values?.fill_rate ||
                                                              (selectedScenarioResult?.metrics as any)?.baseline?.kpi_values?.fill_rate;
                                      if (typeof scenarioFillRate === 'number') {
                                        selectedKPIData = [{ week: 0, value: scenarioFillRate }];
                                      }
                                    }

                                    if (baselineKPIData.length === 0 || selectedKPIData.length === 0) {
                                      return null;
                                    }

                                    return (
                                      <SimpleResilienceKPICard
                                        key={kpiId}
                                        kpiId={kpiId}
                                        baselineData={baselineKPIData}
                                        selectedData={selectedKPIData}
                                      />
                                    );
                                  })}
                                </div>
                              </div>
                            )}

                            {/* Simulation Results Comparison Chart */}
                            {independentBaselineSimulation?.status === 'completed' && (selectedScenarioResult?.status === 'completed' || fallbackScenarioData) && (
                              <div className="space-y-6">
                                {independentBaselineSimulation?.metrics && (selectedScenarioResult?.metrics || fallbackScenarioData?.metrics) && (
                              <SimulationResultsComparisonChart
                                baselineData={independentBaselineSimulation.metrics.baseline}
                                selectedData={(() => {
                                  const primary = (selectedScenarioResult?.metrics?.scenario as any) || {};
                                  const fallback = (fallbackScenarioData as any)?.metrics?.scenario || {};
                                  
                                  // Check if scenario data might be in baseline for scenario-only jobs
                                  const altFromBaseline = (selectedScenarioResult?.scenario_ids?.length > 0 && 
                                                           (selectedScenarioResult?.metrics?.baseline as any)) || {};
                                  
                                  const primaryHasSeries = Object.entries(primary).some(([key, val]: any) => key !== 'kpi_values' && Array.isArray(val) && val.length > 0);
                                  const fallbackHasSeries = Object.entries(fallback).some(([key, val]: any) => key !== 'kpi_values' && Array.isArray(val) && val.length > 0);
                                  const altHasSeries = Object.entries(altFromBaseline).some(([key, val]: any) => key !== 'kpi_values' && Array.isArray(val) && val.length > 0);
                                  
                                  console.debug('Comparison Chart Data Build - Job:', selectedJobId, {
                                    primaryHasSeries,
                                    fallbackHasSeries,
                                    altHasSeries,
                                    primaryKeys: Object.keys(primary),
                                    fallbackKeys: Object.keys(fallback),
                                    altKeys: Object.keys(altFromBaseline),
                                    scenarioIds: selectedScenarioResult?.scenario_ids
                                  });
                                  
                                  if (primaryHasSeries) {
                                    console.debug('Using primary scenario data for comparison chart');
                                    return primary;
                                  }
                                  if (fallbackHasSeries) {
                                    console.debug('Using fallback scenario data for comparison chart');
                                    return fallback;
                                  }
                                  if (altHasSeries) {
                                    console.debug('Using baseline-stored scenario data for comparison chart');
                                    return altFromBaseline;
                                  }
                                  
                                  // Build synthetic data from summaries
                                  const summaries = (primary as any).kpi_values || (fallback as any).kpi_values || {};
                                  const period = (selectedScenarioResult as any)?.metrics?.simulation_period 
                                    || (independentBaselineSimulation as any)?.metrics?.simulation_period 
                                    || { start_week: 0, end_week: 24 };
                                  const synthetic: Record<string, any[]> = {};
                                  
                                  // Also merge missing KPIs from fallback if available
                                  const mergedData = { ...primary };
                                  Object.entries(fallback).forEach(([key, val]) => {
                                    if (key !== 'kpi_values' && Array.isArray(val) && val.length > 0 && (!mergedData[key] || !Array.isArray(mergedData[key]) || mergedData[key].length === 0)) {
                                      mergedData[key] = val;
                                    }
                                  });
                                  
                                  // Add synthetic series from summaries
                                  Object.entries(summaries).forEach(([k, v]) => {
                                    if (typeof v === 'number' && !Number.isNaN(v) && (!mergedData[k] || !Array.isArray(mergedData[k]) || mergedData[k].length === 0)) {
                                      synthetic[k] = [{ week: (period as any).end_week || 24, day: (period as any).end_week || 24, value: Number(v) }];
                                    }
                                  });
                                  
                                  const finalData = { ...mergedData, ...synthetic };
                                  console.debug('Built synthetic/merged data for comparison chart:', Object.keys(finalData));
                                  return finalData;
                                })()}
                                baselineLabel="Baseline"
                                selectedLabel={selectedScenarioResult.scenario_name || 'Scenario'}
                                simulationPeriod={independentBaselineSimulation.metrics.simulation_period}
                              />
                                )}
                              </div>
                            )}

                      </div>
                    )}
                  </CardContent>
                </CollapsibleContent>
              </Collapsible>
            </Card>
          )}

          {/* Multi Sim. Result Comparison */}
          {globalSelectedProjectId && (
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0">
                <CardTitle>Multi Sim. Result Comparison</CardTitle>
                <Collapsible open={showMultiComparison} onOpenChange={setShowMultiComparison}>
                  <CollapsibleTrigger asChild>
                    <Button variant="ghost" size="sm" className="h-auto p-2">
                      {showMultiComparison ? 'Hide' : 'Show'}
                      {showMultiComparison ? (
                        <ChevronDown className="h-4 w-4 ml-1" />
                      ) : (
                        <ChevronRight className="h-4 w-4 ml-1" />
                      )}
                    </Button>
                  </CollapsibleTrigger>
                </Collapsible>
              </CardHeader>
              <Collapsible open={showMultiComparison} onOpenChange={setShowMultiComparison}>
                <CollapsibleContent>
                  <CardContent>
                {!hasDisplayableResults || scenarioJobs.length < 2 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <div className="mb-2">Multi-scenario comparison requires at least 2 completed simulations.</div>
                    <div className="text-sm">Run multiple scenarios to compare them here.</div>
                  </div>
                ) : (
                  <div className="space-y-6">
                    {/* Multi-Scenario Selection */}
                    <div className="space-y-4">
                      <div className="flex items-center gap-2">
                        <h3 className="text-lg font-semibold">Select Multiple Scenarios to Compare</h3>
                        <Badge variant="outline">{scenarioJobs.filter(job => job.status === 'completed').length} available</Badge>
                      </div>
                      
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                        {scenarioJobs.filter(job => job.status === 'completed').map((job) => (
                          <div key={job.id} className="flex items-center space-x-2 p-3 border rounded-lg">
                            <input 
                              type="checkbox" 
                              id={`multi-${job.id}`}
                              className="rounded"
                              defaultChecked={false}
                            />
                            <label htmlFor={`multi-${job.id}`} className="text-sm font-medium cursor-pointer flex-1">
                              Scenario {job.id.slice(0, 8)}
                            </label>
                            <Badge variant="secondary" className="text-xs">
                              {job.completed_at ? new Date(job.completed_at).toLocaleDateString() : 'N/A'}
                            </Badge>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Multi-Comparison Placeholder */}
                    <div className="space-y-4">
                      <div className="p-8 border-2 border-dashed border-muted-foreground/30 rounded-lg text-center">
                        <div className="text-muted-foreground mb-2">Multi-Scenario Comparison Chart</div>
                        <div className="text-sm text-muted-foreground">
                          Select scenarios above to view overlay comparison charts
                        </div>
                      </div>
                      
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="p-4 border rounded-lg">
                          <div className="text-sm font-medium mb-2">Best Performing</div>
                          <div className="text-xs text-muted-foreground">TBD based on selection</div>
                        </div>
                        <div className="p-4 border rounded-lg">
                          <div className="text-sm font-medium mb-2">Most Resilient</div>
                          <div className="text-xs text-muted-foreground">TBD based on selection</div>
                        </div>
                        <div className="p-4 border rounded-lg">
                          <div className="text-sm font-medium mb-2">Fastest Recovery</div>
                          <div className="text-xs text-muted-foreground">TBD based on selection</div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
                  </CardContent>
                </CollapsibleContent>
              </Collapsible>
            </Card>
          )}
        </div>
      
      {/* Job Monitor Section */}
      {globalSelectedProjectId && (
        <div className="mt-6">
          <SimulationJobMonitor 
            projectId={globalSelectedProjectId}
            onJobComplete={() => fetchScenarioJobs()}
            className="mb-6"
          />
        </div>
      )}
      
      {/* Small utility buttons at the end - not important functions */}
      <div className="text-center py-4 space-x-2">
        <Button 
          variant="ghost" 
          size="sm" 
          className="text-xs text-muted-foreground hover:text-foreground"
          onClick={() => {
            console.log('Debug Info:', {
              projects,
              selectedProject: projects.find(p => p.id === globalSelectedProjectId),
              scenarios: scenarios.length,
              simulations: simulations.length,
              selectedScenarios,
            });
            toast.success('Debug info logged to console');
          }}
        >
          Debug Info
        </Button>
      </div>
      </div>

      <DisruptionDialog
        open={disruptionDialogOpen}
        onOpenChange={setDisruptionDialogOpen}
        nodeId={null}
        projectId={globalSelectedProjectId}
        plantName={projects.find(p => p.id === globalSelectedProjectId)?.plant_name || 'Unknown Plant'}
        connectedEdges={[]}
        onSuccess={fetchScenarios}
      />
    </PageLayout>
  );
}

