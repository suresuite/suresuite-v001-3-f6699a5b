import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Checkbox } from '@/components/ui/checkbox';
import { Clock, CheckCircle, XCircle, Filter, Download, CalendarIcon } from 'lucide-react';
import { format } from 'date-fns';
import { SimulationResult, SimulationFilterState, ScenarioJob } from '@/types/simulation';


interface SimulationResultsFilterProps {
  scenarioJobs: ScenarioJob[];
  selectedJobId: string | null;
  filterState: SimulationFilterState;
  onSelectionChange: (jobId: string | null) => void;
  onFilterChange: (filters: Partial<SimulationFilterState>) => void;
  onExport: () => void;
  loading?: boolean;
}

export function SimulationResultsFilter({
  scenarioJobs,
  selectedJobId,
  filterState,
  onSelectionChange,
  onFilterChange,
  onExport,
  loading = false
}: SimulationResultsFilterProps) {
  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'running':
        return <Clock className="h-3 w-3 text-amber-500" />;
      case 'completed':
        return <CheckCircle className="h-3 w-3 text-green-500" />;
      case 'failed':
        return <XCircle className="h-3 w-3 text-red-500" />;
      default:
        return <Clock className="h-3 w-3 text-gray-500" />;
    }
  };

  const formatJobInfo = (job: ScenarioJob) => {
    // Use job config to describe scenarios and effects
    if (job.config?.scenario_details) {
      const scenarios = job.config.scenario_details.slice(0, 2);
      const descriptions = scenarios.map((scenario: any) => {
        const name = scenario.scenario_name || 'Unknown Scenario';
        const effects = scenario.effects || [];
        
        if (effects.length === 0) return name;
        
        const effectText = effects.slice(0, 1).map((effect: any) => {
          if (effect.effect_type === 'capacity_reduction') {
            return `${effect.magnitude}% capacity reduction`;
          } else if (effect.effect_type === 'time_delay') {
            return `${effect.magnitude} ${effect.unit} delay`;
          }
          return `${effect.magnitude} ${effect.unit} ${effect.effect_type}`;
        }).join(', ');
        
        return `${name}: ${effectText}`;
      });
      
      if (job.config.scenario_details.length > 2) {
        return `${descriptions.join(', ')} +${job.config.scenario_details.length - 2} more`;
      }
      
      return descriptions.join(', ');
    }

    // Show job type and scenario count with meaningful description
    const jobTypeLabel = job.job_type === 'baseline' ? 'Baseline' : 
                        job.job_type === 'scenarios' ? 'Scenarios' :
                        job.job_type === 'baseline_scenario' ? 'Baseline + Scenarios' : 'Simulation';
    
    if (job.scenario_ids.length > 0) {
      return `${jobTypeLabel} (${job.scenario_ids.length} scenario${job.scenario_ids.length !== 1 ? 's' : ''})`;
    }

    // Show formatted simulation result ID if available  
    if (job.simulation_result_id) {
      return `${jobTypeLabel} - ${formatResultId(job.simulation_result_id)}`;
    }

    // Fallback
    return jobTypeLabel;
  };

  const formatResultId = (id: string) => {
    if (id.length <= 12) return id;
    return `${id.slice(0, 6)}...${id.slice(-6)}`;
  };

  const getStatusBadgeVariant = (status: string) => {
    switch (status) {
      case 'running':
        return 'secondary';
      case 'failed':
        return 'destructive';
      default:
        return 'outline';
    }
  };

  const shouldShowStatusBadge = (status: string) => {
    return status === 'running' || status === 'failed';
  };

  const selectedJob = selectedJobId 
    ? scenarioJobs.find(j => j.id === selectedJobId)
    : null;

  const filteredJobs = React.useMemo(() => {
    return scenarioJobs.filter(job => {
      // Status filter
      if (filterState.status.length > 0 && !filterState.status.includes(job.status)) {
        return false;
      }
      
      // Date range filter  
      if (filterState.dateRange.from && job.started_at) {
        const jobDate = new Date(job.started_at);
        if (jobDate < filterState.dateRange.from) return false;
      }
      
      if (filterState.dateRange.to && job.started_at) {
        const jobDate = new Date(job.started_at);
        if (jobDate > filterState.dateRange.to) return false;
      }
      
      return true;
    });
  }, [scenarioJobs, filterState]);

  const handleSelectionChange = (value: string) => {
    if (value === 'none') {
      onSelectionChange(null);
    } else {
      onSelectionChange(value);
    }
  };

  return (
    <Card className="overflow-hidden">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CardTitle className="text-base font-semibold">Scenario Selection</CardTitle>
            <Badge variant="outline">{scenarioJobs.length}</Badge>
          </div>
          <div className="flex items-center gap-2">
            <Popover>
              <PopoverTrigger asChild>
                <Button 
                  variant="outline" 
                  size="sm" 
                  className={`h-8 w-8 p-0 ${filterState.status.length > 0 || filterState.dateRange.from ? 'bg-primary/10 border-primary/20' : ''}`}
                >
                  <Filter className="h-3 w-3" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-80" align="end">
                <div className="space-y-4">
                  <div>
                    <label className="text-sm font-medium mb-3 block">Filter by Status</label>
                    <div className="grid grid-cols-2 gap-2">
                      {['running', 'failed'].map(status => (
                        <label key={status} className="flex items-center space-x-2 cursor-pointer p-2 rounded-lg hover:bg-muted/50">
                          <Checkbox 
                            checked={filterState.status.includes(status)}
                            onCheckedChange={(checked) => {
                              const newStatus = checked 
                                ? [...filterState.status, status]
                                : filterState.status.filter(s => s !== status);
                              onFilterChange({ status: newStatus });
                            }}
                          />
                          <div className="flex items-center gap-2">
                            {getStatusIcon(status)}
                            <span className="text-sm capitalize font-medium">{status}</span>
                          </div>
                        </label>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="text-sm font-medium mb-3 block">Date Range</label>
                    <div className="space-y-2">
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button variant="outline" size="sm" className="w-full justify-start text-left font-normal">
                            <CalendarIcon className="mr-2 h-4 w-4" />
                            {filterState.dateRange.from ? (
                              filterState.dateRange.to ? (
                                <>
                                  {format(filterState.dateRange.from, "LLL dd, y")} -{" "}
                                  {format(filterState.dateRange.to, "LLL dd, y")}
                                </>
                              ) : (
                                format(filterState.dateRange.from, "LLL dd, y")
                              )
                            ) : (
                              <span>Pick a date range</span>
                            )}
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="start">
                          <div className="p-3">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => onFilterChange({ 
                                dateRange: { from: null, to: null } 
                              })}
                              className="w-full"
                            >
                              Clear dates
                            </Button>
                          </div>
                        </PopoverContent>
                      </Popover>
                    </div>
                  </div>
                </div>
              </PopoverContent>
            </Popover>
            <Button 
              variant="outline" 
              size="sm" 
              onClick={onExport} 
              disabled={loading || filteredJobs.length === 0}
              className="gap-1"
            >
              <Download className="h-3 w-3" />
              Export
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <Select 
          value={selectedJobId || 'none'} 
          onValueChange={handleSelectionChange}
          disabled={loading}
        >
          <SelectTrigger className="w-full min-h-[3rem] px-4 py-3">
            <SelectValue>
              {selectedJob ? (
                <div className="flex items-center gap-3">
                  {shouldShowStatusBadge(selectedJob.status) && (
                    <Badge variant={getStatusBadgeVariant(selectedJob.status)} className="capitalize">
                      {selectedJob.status}
                    </Badge>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-foreground mb-1 line-clamp-1">
                      {formatJobInfo(selectedJob)}
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span>
                        {selectedJob.started_at 
                          ? format(new Date(selectedJob.started_at), 'MMM dd, HH:mm')
                          : 'Unknown time'
                        }
                      </span>
                      {selectedJob.scenario_ids.length > 0 && (
                        <>
                          <span>•</span>
                          <span>{selectedJob.scenario_ids.length} scenario{selectedJob.scenario_ids.length !== 1 ? 's' : ''}</span>
                        </>
                      )}
                      {selectedJob.simulation_result_id && (
                        <>
                          <span>•</span>
                          <span className="font-mono text-xs">
                            ID: {formatResultId(selectedJob.simulation_result_id)}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                <span className="text-muted-foreground">Select a simulation result to view</span>
              )}
            </SelectValue>
          </SelectTrigger>
          <SelectContent className="z-50 max-h-[400px] bg-background/95 backdrop-blur-sm border shadow-lg">
            <SelectItem 
              value="none" 
              className="text-muted-foreground mx-2 mb-3 rounded-md hover:bg-muted/50 focus:bg-muted/50 data-[state=checked]:bg-muted/80"
            >
              <div className="px-3 py-2">
                No selection
              </div>
            </SelectItem>
            {filteredJobs.map((job, index) => (
              <SelectItem 
                key={job.id} 
                value={job.id} 
                className={`mx-2 rounded-md hover:bg-muted/50 focus:bg-muted/50 data-[state=checked]:bg-primary/15 data-[state=checked]:border data-[state=checked]:border-primary/30 transition-all duration-200 ${index < filteredJobs.length - 1 ? 'mb-3' : ''}`}
              >
                <div className="w-full px-4 py-3">
                  <div className="flex items-start gap-3">
                    {shouldShowStatusBadge(job.status) && (
                      <Badge variant={getStatusBadgeVariant(job.status)} className="capitalize shrink-0">
                        {job.status}
                      </Badge>
                    )}
                    <div className="flex-1 min-w-0 space-y-1">
                      <div className="text-sm font-medium text-foreground leading-tight">
                        {formatJobInfo(job)}
                      </div>
                      
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span>
                          {job.started_at 
                            ? format(new Date(job.started_at), 'MMM dd, HH:mm')
                            : 'Unknown time'
                          }
                        </span>
                        {job.scenario_ids.length > 0 && (
                          <>
                            <span>•</span>
                            <span>{job.scenario_ids.length} scenario{job.scenario_ids.length !== 1 ? 's' : ''}</span>
                          </>
                        )}
                        {job.simulation_result_id && (
                          <>
                            <span>•</span>
                            <span className="font-mono text-xs">
                              ID: {formatResultId(job.simulation_result_id)}
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </CardContent>
    </Card>
  );
}