// @ts-nocheck — schema mismatch: this file targets a supply-chain schema not yet migrated into this project. Remove once tables/RPCs are created.
import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';
import {
  Play,
  Pause,
  Square,
  Clock,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Zap,
  Database,
  Cpu,
  HardDrive,
  RefreshCw,
  Download,
  Trash2,
  ChevronDown,
  ChevronRight
} from 'lucide-react';

interface SimulationJob {
  id: string;
  project_id: string;
  status: 'pending' | 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  progress: number;
  job_type: string;
  priority: number;
  created_at: string;
  started_at?: string;
  completed_at?: string;
  estimated_duration_seconds?: number;
  error_message?: string;
  partial_results?: any;
  estimated_remaining_seconds?: number;
  scenario_ids?: string[];
  config?: {
    scenario_details?: Array<{
      scenario_id: string;
      scenario_name: string;
      description?: string;
      status: string;
      effects: Array<{
        effect_type: string;
        magnitude: number;
        unit: string;
        magnitude_source: 'ui_current' | 'database';
      }>;
      ui_magnitude_override?: number;
    }>;
  };
  performance_summary?: {
    execution_time: number;
    cache_efficiency: number;
    resource_usage: {
      memory_mb: number;
      cpu_percent: number;
    };
    service_calls: number;
    database_queries: number;
  };
}

interface QueueInfo {
  pending: number;
  queued: number;
  running: number;
}

interface SimulationJobMonitorProps {
  projectId: string;
  onJobComplete?: (jobId: string) => void;
  className?: string;
}

export function SimulationJobMonitor({ 
  projectId, 
  onJobComplete, 
  className = "" 
}: SimulationJobMonitorProps) {
  const { user } = useAuth();
  const [jobs, setJobs] = useState<SimulationJob[]>([]);
  const [queueInfo, setQueueInfo] = useState<QueueInfo>({ pending: 0, queued: 0, running: 0 });
  const [loading, setLoading] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [deletingJobId, setDeletingJobId] = useState<string | null>(null);
  const [downloadingJobId, setDownloadingJobId] = useState<string | null>(null);
  const [showRecentJobs, setShowRecentJobs] = useState(false);

  const fetchJobStatus = async () => {
    if (!user || !projectId) return;

    try {
      const { data, error } = await supabase.functions.invoke('simulation-status', {
        body: {
          project_id: projectId,
          user_id: user.id,
          user_email: user.email
        }
      });

      if (error) throw error;

      if (data.success) {
        setJobs(data.jobs || []);
        setQueueInfo(data.queue_info || { pending: 0, queued: 0, running: 0 });

        // Check for newly completed jobs
        data.jobs?.forEach((job: SimulationJob) => {
          if (job.status === 'completed' && onJobComplete) {
            onJobComplete(job.id);
          }
        });
      }
    } catch (error) {
      console.error('Failed to fetch job status:', error);
    }
  };

  useEffect(() => {
    fetchJobStatus();
  }, [projectId, user]);

  useEffect(() => {
    if (!autoRefresh) return;

    const interval = setInterval(() => {
      const hasActiveJobs = jobs.some(job => 
        ['pending', 'queued', 'running'].includes(job.status)
      );
      
      if (hasActiveJobs) {
        fetchJobStatus();
      }
    }, 2000); // Refresh every 2 seconds for active jobs

    return () => clearInterval(interval);
  }, [jobs, autoRefresh]);

  const cancelJob = async (jobId: string) => {
    if (!user) return;

    try {
      setLoading(true);
      const { error } = await supabase
        .from('simulation_jobs')
        .update({ status: 'cancelled' })
        .eq('id', jobId);

      if (error) throw error;

      toast.success('Job cancelled successfully');
      fetchJobStatus();
    } catch (error) {
      console.error('Failed to cancel job:', error);
      toast.error('Failed to cancel job');
    } finally {
      setLoading(false);
    }
  };

  const deleteSimulationResult = async (jobId: string) => {
    if (!user) return;

    const confirmed = window.confirm(
      'Are you sure you want to delete this simulation result? This action cannot be undone.'
    );
    
    if (!confirmed) return;

    try {
      setDeletingJobId(jobId);

      // Use a secure edge function with service role to handle deletion with proper authorization
      const { data, error } = await supabase.functions.invoke('delete-simulation-job', {
        body: {
          job_id: jobId,
          user_id: user.id,
          user_email: user.email,
        },
      });

      if (error) {
        console.error('Edge function error:', error);
        throw new Error(error.message || 'Edge function failed');
      }

      if (!data?.success) {
        console.error('Deletion failed:', data);
        throw new Error(data?.error || 'Deletion failed');
      }

      toast.success('Job and results deleted successfully');
      setJobs(prevJobs => prevJobs.filter(job => job.id !== jobId));
    } catch (error: any) {
      console.error('Failed to delete job:', error);
      toast.error(`Failed to delete job: ${error.message || 'Unknown error'}`);
    } finally {
      setDeletingJobId(null);
    }
  };

  const downloadSimulationResult = async (jobId: string) => {
    if (!user) return;

    try {
      setDownloadingJobId(jobId);
      
      // Fetch simulation result data
      const { data: simResult, error: simError } = await supabase
        .from('simulation_results')
        .select('*')
        .eq('id', jobId)
        .single();

      if (simError) throw simError;

      // Fetch performance metrics if available
      const { data: perfMetrics } = await supabase
        .from('simulation_performance_metrics')
        .select('*')
        .eq('simulation_job_id', jobId);

      // Prepare download data
      const downloadData = {
        simulation_result: simResult,
        performance_metrics: perfMetrics || [],
        exported_at: new Date().toISOString(),
        export_version: '1.0'
      };

      // Create and download file
      const blob = new Blob([JSON.stringify(downloadData, null, 2)], {
        type: 'application/json'
      });
      
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `simulation-result-${new Date().toISOString().split('T')[0]}-${jobId.slice(-8)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast.success('Simulation result downloaded successfully');
      
    } catch (error) {
      console.error('Failed to download simulation result:', error);
      toast.error('Failed to download simulation result');
    } finally {
      setDownloadingJobId(null);
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'pending':
        return <Clock className="h-4 w-4" />;
      case 'queued':
        return <Clock className="h-4 w-4 text-amber-500" />;
      case 'running':
        return <Play className="h-4 w-4 text-blue-500" />;
      case 'completed':
        return <CheckCircle className="h-4 w-4 text-green-500" />;
      case 'failed':
        return <XCircle className="h-4 w-4 text-red-500" />;
      case 'cancelled':
        return <Square className="h-4 w-4 text-gray-500" />;
      default:
        return <AlertTriangle className="h-4 w-4" />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pending':
        return 'secondary';
      case 'queued':
        return 'secondary';
      case 'running':
        return 'default';
      case 'completed':
        return 'default';
      case 'failed':
        return 'destructive';
      case 'cancelled':
        return 'secondary';
      default:
        return 'secondary';
    }
  };

  const formatDuration = (seconds?: number) => {
    if (!seconds) return 'Unknown';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}m ${secs}s`;
  };

  const formatTimeAgo = (timestamp: string) => {
    const diff = Date.now() - new Date(timestamp).getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(minutes / 60);
    
    if (hours > 0) return `${hours}h ago`;
    if (minutes > 0) return `${minutes}m ago`;
    return 'Just now';
  };

  const recentJobs = jobs.slice(0, 5); // Show last 5 jobs

  return (
    <div className={className}>
      {/* Recent Jobs */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-lg">Recent Activities</CardTitle>
          <Collapsible open={showRecentJobs} onOpenChange={setShowRecentJobs}>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm" className="h-auto p-2">
                {showRecentJobs ? 'Hide' : 'Show'}
                {showRecentJobs ? (
                  <ChevronDown className="h-4 w-4 ml-1" />
                ) : (
                  <ChevronRight className="h-4 w-4 ml-1" />
                )}
              </Button>
            </CollapsibleTrigger>
          </Collapsible>
        </CardHeader>
        <Collapsible open={showRecentJobs} onOpenChange={setShowRecentJobs}>
          <CollapsibleContent>
            <CardContent>
          {recentJobs.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No simulation jobs found for this project
            </div>
          ) : (
            <div className="space-y-4">
              {recentJobs.map((job) => (
                <div
                  key={job.id}
                  className="border rounded-lg p-4 space-y-3"
                >
                  {/* Job Header */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {getStatusIcon(job.status)}
                      <span className="font-medium">
                        {job.job_type === 'baseline' ? 'Baseline Calculation' : 
                         job.job_type === 'scenarios' ? 'Scenario Analysis' : 
                         job.job_type.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())}
                      </span>
                      <Badge variant={getStatusColor(job.status)}>
                        {job.status}
                      </Badge>
                      {job.priority > 1 && (
                        <Badge variant="outline" className="text-xs">
                          Priority {job.priority}
                        </Badge>
                      )}
                    </div>
                     <div className="flex items-center gap-2">
                       <span className="text-sm text-muted-foreground">
                         {formatTimeAgo(job.created_at)}
                       </span>
                       {job.status === 'running' && (
                         <Button
                           variant="outline"
                           size="sm"
                           onClick={() => cancelJob(job.id)}
                           disabled={loading}
                         >
                           <Square className="h-3 w-3 mr-1" />
                           Cancel
                         </Button>
                       )}
                       {job.status === 'completed' && (
                         <div className="flex items-center gap-1">
                           <Button
                             variant="outline"
                             size="sm"
                             onClick={() => downloadSimulationResult(job.id)}
                             disabled={downloadingJobId === job.id}
                             title="Download simulation result"
                           >
                             {downloadingJobId === job.id ? (
                               <RefreshCw className="h-3 w-3 animate-spin" />
                             ) : (
                               <Download className="h-3 w-3" />
                             )}
                           </Button>
                           <Button
                             variant="outline"
                             size="sm"
                             onClick={() => deleteSimulationResult(job.id)}
                             disabled={deletingJobId === job.id}
                             title="Delete simulation result"
                             className="text-destructive hover:text-destructive"
                           >
                             {deletingJobId === job.id ? (
                               <RefreshCw className="h-3 w-3 animate-spin" />
                             ) : (
                               <Trash2 className="h-3 w-3" />
                             )}
                           </Button>
                         </div>
                       )}
                     </div>
                   </div>

                   {/* Scenario Details with Magnitudes */}
                   {job.config?.scenario_details && job.config.scenario_details.length > 0 && (
                     <div className="bg-purple-50 border border-purple-200 rounded p-2">
                       <div className="text-sm text-purple-800 font-medium mb-1">Scenario Magnitudes:</div>
                       <div className="space-y-1">
                         {job.config.scenario_details.map((detail: any, idx: number) => (
                           <div key={idx} className="text-xs text-purple-700">
                             <span className="font-medium">{detail.scenario_name}:</span>{' '}
                             {detail.effects?.map((effect: any, i: number) => (
                               <span key={i} className="mr-2">
                                 {effect.effect_type}: {effect.magnitude} {effect.unit}
                                 {effect.magnitude_source === 'ui_current' && (
                                   <span className="text-green-600 ml-1">(Live UI Value)</span>
                                 )}
                               </span>
                             )) || 'No effects'}
                           </div>
                         ))}
                       </div>
                     </div>
                   )}

                   {/* Scenario IDs for reference */}
                   {job.scenario_ids?.length > 0 && (
                     <div className="flex items-center gap-2 text-xs text-muted-foreground">
                       <span>Scenarios ({job.scenario_ids.length}):</span>
                       {job.scenario_ids.slice(0, 2).map((id, idx) => (
                         <Badge key={idx} variant="outline" className="text-xs font-mono">
                           {id.slice(-8)}
                         </Badge>
                       ))}
                       {job.scenario_ids.length > 2 && (
                         <span>+{job.scenario_ids.length - 2} more</span>
                       )}
                     </div>
                   )}

                  {/* Progress Bar for Running Jobs */}
                  {job.status === 'running' && (
                    <div className="space-y-2">
                      <Progress value={job.progress} className="h-2" />
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span>{Math.round(job.progress)}% complete</span>
                        {job.estimated_remaining_seconds && (
                          <span>
                            ~{formatDuration(job.estimated_remaining_seconds)} remaining
                          </span>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Error Message */}
                  {job.status === 'failed' && job.error_message && (
                    <div className="bg-red-50 border border-red-200 rounded p-2">
                      <div className="text-sm text-red-800 font-medium">Error:</div>
                      <div className="text-sm text-red-700">{job.error_message}</div>
                    </div>
                  )}

                  {/* Partial Results for Running Jobs */}
                  {job.status === 'running' && job.partial_results && (
                    <div className="bg-blue-50 border border-blue-200 rounded p-2">
                      <div className="text-sm text-blue-800 font-medium">Progress:</div>
                      <div className="text-sm text-blue-700">
                        {Object.entries(job.partial_results).map(([key, value]) => (
                          <span key={key} className="mr-3">
                            {key}: {String(value)}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Performance Summary for Completed Jobs */}
                  {job.status === 'completed' && job.performance_summary && (
                    <TooltipProvider>
                      <div className="flex items-center gap-4 text-xs text-muted-foreground">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <div className="flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              {formatDuration(job.performance_summary.execution_time)}
                            </div>
                          </TooltipTrigger>
                          <TooltipContent>
                            Total execution time
                          </TooltipContent>
                        </Tooltip>

                        <Tooltip>
                          <TooltipTrigger asChild>
                            <div className="flex items-center gap-1">
                              <Zap className="h-3 w-3" />
                              {Math.round(job.performance_summary.cache_efficiency * 100)}%
                            </div>
                          </TooltipTrigger>
                          <TooltipContent>
                            Cache hit efficiency
                          </TooltipContent>
                        </Tooltip>

                        <Tooltip>
                          <TooltipTrigger asChild>
                            <div className="flex items-center gap-1">
                              <Database className="h-3 w-3" />
                              {job.performance_summary.database_queries}
                            </div>
                          </TooltipTrigger>
                          <TooltipContent>
                            Database queries executed
                          </TooltipContent>
                        </Tooltip>

                        {job.performance_summary.resource_usage && (
                          <>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <div className="flex items-center gap-1">
                                  <HardDrive className="h-3 w-3" />
                                  {Math.round(job.performance_summary.resource_usage.memory_mb)}MB
                                </div>
                              </TooltipTrigger>
                              <TooltipContent>
                                Peak memory usage
                              </TooltipContent>
                            </Tooltip>

                            <Tooltip>
                              <TooltipTrigger asChild>
                                <div className="flex items-center gap-1">
                                  <Cpu className="h-3 w-3" />
                                  {Math.round(job.performance_summary.resource_usage.cpu_percent)}%
                                </div>
                              </TooltipTrigger>
                              <TooltipContent>
                                Average CPU usage
                              </TooltipContent>
                            </Tooltip>
                          </>
                        )}
                      </div>
                    </TooltipProvider>
                  )}
                </div>
              ))}
            </div>
          )}
            </CardContent>
          </CollapsibleContent>
        </Collapsible>
      </Card>
    </div>
  );
}