import React from 'react';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DEFAULT_KPI_CONFIGS, KPIDataPoint } from '@/types/simulation';
import { calculateResilienceKPIs } from '@/utils/resilienceCalculator';

interface KPIDualCardProps {
  kpiId: string;
  baselineData: KPIDataPoint[];
  selectedData: KPIDataPoint[];
  baselineSummary?: number;
  selectedSummary?: number;
  baselineLabel?: string;
  selectedLabel?: string;
}

export function KPIDualCard({ 
  kpiId, 
  baselineData, 
  selectedData, 
  baselineSummary, 
  selectedSummary,
  baselineLabel = 'Baseline',
  selectedLabel = 'Selected'
}: KPIDualCardProps) {
  const config = DEFAULT_KPI_CONFIGS[kpiId];
  
  // Check if this is a resilience KPI that needs special calculation
  const resilienceKPIs = ['time_to_survive', 'time_to_recover', 'time_to_adapt'];
  const isResilienceKPI = resilienceKPIs.includes(kpiId);

  // Handle case where we might not have data
  if (!isResilienceKPI && !baselineData?.length && !selectedData?.length) {
    return null;
  }

  // For resilience KPIs, we need fill_rate data instead of direct KPI data
  if (isResilienceKPI && (!baselineData?.length || !selectedData?.length)) {
    return null;
  }

  let baselineLatest: number;
  let selectedLatest: number;

  if (isResilienceKPI && baselineData?.length > 0 && selectedData?.length > 0) {
    // Calculate resilience metrics based on fill rate comparison
    const resilienceMetrics = calculateResilienceKPIs({
      baselineData,
      selectedData,
      disruptionStartWeek: 1
    });
    
    // For resilience KPIs, baseline is always 0 (no disruption scenario)
    baselineLatest = 0;
    selectedLatest = resilienceMetrics[kpiId as keyof typeof resilienceMetrics];
  } else {
    // Get the latest values - use summary if available, otherwise use time series
    baselineLatest = baselineSummary !== undefined ? baselineSummary : (baselineData?.[baselineData.length - 1]?.value || 0);
    selectedLatest = selectedSummary !== undefined ? selectedSummary : (selectedData?.[selectedData.length - 1]?.value || 0);
  }
  
  // Calculate change
  const change = selectedLatest - baselineLatest;
  const changePercent = isResilienceKPI ? 
    (selectedLatest > 0 ? 100 : 0) : // For resilience KPIs, show 100% when there's impact
    (baselineLatest !== 0 ? (change / baselineLatest) * 100 : 0);
  
  const formatValue = (value: number): string => {
    if (config.format === 'percentage') {
      return `${(value * 100).toFixed(1)}%`;
    } else if (config.format === 'currency') {
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        notation: Math.abs(value) >= 100000 ? 'compact' : 'standard',
        maximumFractionDigits: Math.abs(value) >= 100000 ? 1 : 2
      }).format(value);
    } else {
      return new Intl.NumberFormat('en-US', {
        notation: value >= 1000 ? 'compact' : 'standard'
      }).format(value);
    }
  };

  const getTrendIcon = () => {
    if (Math.abs(changePercent) < 0.1) {
      return <Minus className="h-3 w-3 text-muted-foreground" />;
    }
    
    // For negative impact KPIs, inverse the trend logic (higher values are worse)
    const isNegativeImpactKPI = ['backlog', 'resilience_cost', 'time_to_recover'].includes(kpiId);
    
    // For resilience KPIs, always show as negative trend since they represent disruption impact
    if (isResilienceKPI) {
      return selectedLatest > 0 ? (
        <TrendingDown className="h-3 w-3 text-red-600" />
      ) : (
        <Minus className="h-3 w-3 text-muted-foreground" />
      );
    }
    const isImproving = isNegativeImpactKPI ? change < 0 : change > 0;
    
    return isImproving ? (
      <TrendingUp className="h-3 w-3 text-green-600" />
    ) : (
      <TrendingDown className="h-3 w-3 text-red-600" />
    );
  };

  const getTrendColor = () => {
    // For resilience KPIs, always show red when there's impact (selectedLatest > 0)
    if (isResilienceKPI) {
      return selectedLatest > 0 ? 'text-red-600' : 'text-muted-foreground';
    }
    
    if (Math.abs(changePercent) < 0.1) return 'text-muted-foreground';
    
    const isNegativeImpactKPI = ['backlog', 'resilience_cost', 'time_to_recover'].includes(kpiId);
    const isImproving = isNegativeImpactKPI ? change < 0 : change > 0;
    
    return isImproving ? 'text-green-600' : 'text-red-600';
  };

  const getChangeMagnitude = () => {
    if (Math.abs(changePercent) < 0.1) return 'none';
    if (Math.abs(changePercent) < 5) return 'minor';
    if (Math.abs(changePercent) < 15) return 'moderate';
    return 'significant';
  };

  const getChangeBackgroundColor = () => {
    const magnitude = getChangeMagnitude();
    if (magnitude === 'none') return '';
    
    const isNegativeImpactKPI = ['backlog', 'resilience_cost', 'time_to_recover'].includes(kpiId);
    const isImproving = isNegativeImpactKPI ? change < 0 : change > 0;
    
    if (magnitude === 'significant') {
      return isImproving ? 'bg-green-100 border-green-200 dark:bg-green-900/20 dark:border-green-800/50' : 'bg-red-100 border-red-200 dark:bg-red-900/20 dark:border-red-800/50';
    }
    if (magnitude === 'moderate') {
      return isImproving ? 'bg-green-50 border-green-100 dark:bg-green-900/10 dark:border-green-800/30' : 'bg-red-50 border-red-100 dark:bg-red-900/10 dark:border-red-800/30';
    }
    return 'bg-amber-50 border-amber-100 dark:bg-amber-900/10 dark:border-amber-800/30';
  };

  return (
    <Card className={`w-full max-w-sm relative overflow-hidden transition-all duration-200 ${getChangeBackgroundColor()}`}>
      <div 
        className="absolute left-0 top-0 bottom-0 w-1"
        style={{ backgroundColor: config.color }}
      />
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            {config.name}
          </CardTitle>
          {/* Change indicator */}
          {getChangeMagnitude() !== 'none' && (
            <div className={`flex items-center space-x-1 px-2 py-1 rounded-full text-xs font-bold ${
              getChangeMagnitude() === 'significant' ? 'text-white' : ''
            } ${
              getTrendColor() === 'text-green-600' ? 
                (getChangeMagnitude() === 'significant' ? 'bg-green-600' : 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400') :
                getTrendColor() === 'text-red-600' ?
                (getChangeMagnitude() === 'significant' ? 'bg-red-600' : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400') :
                'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
            }`}>
              {getTrendIcon()}
              <span>{Math.abs(changePercent).toFixed(1)}%</span>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Current selected value with change info */}
        <div className="space-y-1">
          <div className="text-2xl font-bold">
            {formatValue(selectedLatest)}
          </div>
          <div className="text-sm">
            <span className="text-muted-foreground">vs {baselineLabel.toLowerCase()}: </span>
            <span className={`font-semibold ${getTrendColor()}`}>
              {change >= 0 ? '+' : ''}{formatValue(change)}
            </span>
          </div>
        </div>
        
        {/* Both dataset comparison details */}
        <div className="space-y-1 text-xs text-muted-foreground border-t pt-2">
          <div className="flex justify-between">
            <span>{baselineLabel}:</span>
            <span className="font-medium">{formatValue(baselineLatest)}</span>
          </div>
          <div className="flex justify-between">
            <span>{selectedLabel}:</span>
            <span className="font-medium">{formatValue(selectedLatest)}</span>
          </div>
        </div>

      </CardContent>
    </Card>
  );
}