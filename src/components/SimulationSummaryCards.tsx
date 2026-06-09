import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { 
  TrendingUp, 
  TrendingDown, 
  Clock, 
  CheckCircle, 
  AlertTriangle,
  BarChart3
} from 'lucide-react';
import { SimulationResult, BaselineSimulation } from '@/types/simulation';
import { format } from 'date-fns';

interface SimulationSummaryCardsProps {
  latestSimulation?: SimulationResult | null;
  baselineSimulation?: BaselineSimulation | null;
  totalSimulations: number;
  loading?: boolean;
}

export function SimulationSummaryCards({
  latestSimulation,
  baselineSimulation,
  totalSimulations,
  loading = false
}: SimulationSummaryCardsProps) {
  const getPerformanceMetric = (simulation: SimulationResult | BaselineSimulation | null) => {
    if (!simulation?.metrics?.available_kpis?.length) return null;
    
    // Get the first available KPI as a representative metric
    const firstKpi = simulation.metrics.available_kpis[0];
    const baselineData = simulation.metrics.baseline[firstKpi];
    const scenarioData = simulation.metrics.scenario[firstKpi];
    
    if (!baselineData?.length || !scenarioData?.length) return null;
    
    const baselineValue = baselineData[baselineData.length - 1]?.value || 0;
    const scenarioValue = scenarioData[scenarioData.length - 1]?.value || 0;
    const change = ((scenarioValue - baselineValue) / baselineValue) * 100;
    
    return {
      kpi: firstKpi,
      baselineValue,
      scenarioValue,
      change,
      isPositive: change >= 0
    };
  };

  const performanceMetric = getPerformanceMetric(latestSimulation);

  if (loading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        {[1, 2, 3].map((i) => (
          <Card key={i}>
            <CardHeader className="pb-2">
              <Skeleton className="h-4 w-24" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-8 w-16 mb-2" />
              <Skeleton className="h-3 w-32" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <BarChart3 className="h-4 w-4" />
            Total Simulations
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{totalSimulations}</div>
          <p className="text-xs text-muted-foreground">
            Simulation runs completed
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Clock className="h-4 w-4" />
            Latest Status
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 mb-2">
            {latestSimulation?.status === 'completed' && (
              <CheckCircle className="h-4 w-4 text-green-500" />
            )}
            {latestSimulation?.status === 'running' && (
              <Clock className="h-4 w-4 text-amber-500" />
            )}
            {latestSimulation?.status === 'failed' && (
              <AlertTriangle className="h-4 w-4 text-red-500" />
            )}
            <Badge 
              variant={latestSimulation?.status === 'completed' ? 'default' : 'outline'}
              className="capitalize"
            >
              {latestSimulation?.status || 'No simulations'}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            {latestSimulation?.completed_at 
              ? `Completed ${format(new Date(latestSimulation.completed_at), 'MMM dd, HH:mm')}`
              : latestSimulation?.started_at
              ? `Started ${format(new Date(latestSimulation.started_at), 'MMM dd, HH:mm')}`
              : 'No recent activity'
            }
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            {performanceMetric?.isPositive ? (
              <TrendingUp className="h-4 w-4 text-green-500" />
            ) : (
              <TrendingDown className="h-4 w-4 text-red-500" />
            )}
            Performance Impact
          </CardTitle>
        </CardHeader>
        <CardContent>
          {performanceMetric ? (
            <>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-2xl font-bold">
                  {performanceMetric.change > 0 ? '+' : ''}
                  {performanceMetric.change.toFixed(1)}%
                </span>
                <Badge 
                  variant={performanceMetric.isPositive ? 'default' : 'destructive'}
                  className="text-xs"
                >
                  {performanceMetric.kpi.replace('_', ' ')}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                vs baseline scenario
              </p>
            </>
          ) : (
            <>
              <div className="text-2xl font-bold text-muted-foreground">--</div>
              <p className="text-xs text-muted-foreground">
                No performance data
              </p>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}