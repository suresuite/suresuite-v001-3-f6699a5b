import React from 'react';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DEFAULT_KPI_CONFIGS, KPIDataPoint } from '@/types/simulation';

interface KPICardProps {
  kpiId: string;
  baselineData: KPIDataPoint[];
  scenarioData: KPIDataPoint[];
  baselineSummary?: number;
  scenarioSummary?: number;
  showBaseline?: boolean;
}

export function KPICard({ kpiId, baselineData, scenarioData, baselineSummary, scenarioSummary, showBaseline = true }: KPICardProps) {
  const config = DEFAULT_KPI_CONFIGS[kpiId];
  
  // Handle case where we might not have both datasets
  if (!baselineData?.length && !scenarioData?.length) {
    return null;
  }

  // Use available data - prioritize scenario data if available, otherwise use baseline
  const displayData = scenarioData?.length ? scenarioData : baselineData;
  const hasComparison = baselineData?.length > 0 && scenarioData?.length > 0;
  
  // Get the latest values - use summary if available, otherwise use time series
  const baselineLatest = baselineSummary !== undefined ? baselineSummary : (baselineData?.[baselineData.length - 1]?.value || 0);
  const scenarioLatest = scenarioSummary !== undefined ? scenarioSummary : (displayData?.[displayData.length - 1]?.value || 0);
  
  // Calculate change only if we have both datasets
  const change = hasComparison ? scenarioLatest - baselineLatest : 0;
  const changePercent = hasComparison && baselineLatest !== 0 ? (change / baselineLatest) * 100 : 0;
  
  const formatValue = (value: number): string => {
    if (config.format === 'percentage') {
      // Convert decimal to percentage (0.955 -> 95.5%)
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
    if (!showBaseline || !hasComparison) {
      // When baseline is hidden or no comparison data, just show neutral
      return <Minus className="h-3 w-3 text-muted-foreground" />;
    }
    
    if (Math.abs(changePercent) < 0.1) {
      return <Minus className="h-3 w-3 text-muted-foreground" />;
    }
    
    // For negative impact KPIs (backlog, resilience_cost), inverse the trend logic
    const isNegativeImpactKPI = ['backlog', 'resilience_cost'].includes(kpiId);
    const isImproving = isNegativeImpactKPI ? change < 0 : change > 0;
    
    return isImproving ? (
      <TrendingUp className="h-3 w-3 text-green-600" />
    ) : (
      <TrendingDown className="h-3 w-3 text-red-600" />
    );
  };

  const getTrendColor = () => {
    if (!showBaseline || !hasComparison || Math.abs(changePercent) < 0.1) return 'text-muted-foreground';
    
    const isNegativeImpactKPI = ['backlog', 'resilience_cost'].includes(kpiId);
    const isImproving = isNegativeImpactKPI ? change < 0 : change > 0;
    
    return isImproving ? 'text-green-600' : 'text-red-600';
  };

  const getChangeMagnitude = () => {
    if (!hasComparison || Math.abs(changePercent) < 0.1) return 'none';
    if (Math.abs(changePercent) < 5) return 'minor';
    if (Math.abs(changePercent) < 15) return 'moderate';
    return 'significant';
  };

  const getChangeBackgroundColor = () => {
    const magnitude = getChangeMagnitude();
    if (magnitude === 'none') return '';
    
    const isNegativeImpactKPI = ['backlog', 'resilience_cost'].includes(kpiId);
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
    <Card className={`relative overflow-hidden transition-all duration-200 ${getChangeBackgroundColor()}`}>
      <div 
        className="absolute left-0 top-0 bottom-0 w-1"
        style={{ backgroundColor: config.color }}
      />
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            {config.name}
          </CardTitle>
          {/* Prominent change indicator */}
          {showBaseline && hasComparison && getChangeMagnitude() !== 'none' && (
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
        {/* Current value with change info */}
        <div className="space-y-1">
          <div className="text-2xl font-bold">
            {formatValue(scenarioLatest)}
          </div>
          {showBaseline && hasComparison && (
            <div className="text-sm">
              <span className="text-muted-foreground">vs baseline: </span>
              <span className={`font-semibold ${getTrendColor()}`}>
                {change >= 0 ? '+' : ''}{formatValue(change)}
              </span>
            </div>
          )}
        </div>
        
        {/* Baseline comparison details */}
        {showBaseline && hasComparison ? (
          <div className="space-y-1 text-xs text-muted-foreground border-t pt-2">
            <div className="flex justify-between">
              <span>Baseline:</span>
              <span className="font-medium">{formatValue(baselineLatest)}</span>
            </div>
            <div className="flex justify-between">
              <span>Scenario:</span>
              <span className="font-medium">{formatValue(scenarioLatest)}</span>
            </div>
          </div>
        ) : !showBaseline ? (
          <div className="text-xs text-muted-foreground border-t pt-2">
            <div className="flex justify-between">
              <span>Current Value:</span>
              <span className="font-medium">{formatValue(scenarioLatest)}</span>
            </div>
          </div>
        ) : null}

        {/* Enhanced sparkline with trend colors */}
        <div className="h-8 flex items-end space-x-0.5">
          {displayData?.slice(-10).map((point, index) => {
            const maxValue = Math.max(...displayData.slice(-10).map(p => p.value));
            const minValue = Math.min(...displayData.slice(-10).map(p => p.value));
            const range = maxValue - minValue || 1;
            const height = ((point.value - minValue) / range) * 24 + 4;
            
            // Color the bars based on trend
            const isLastFew = index >= displayData.slice(-10).length - 3;
            const barColor = showBaseline && hasComparison && isLastFew ?
              (getTrendColor() === 'text-green-600' ? 'bg-green-400/60' :
               getTrendColor() === 'text-red-600' ? 'bg-red-400/60' : 'bg-primary/20') :
              'bg-primary/20';
            
            return (
              <div
                key={index}
                className={`flex-1 rounded-sm transition-colors ${barColor}`}
                style={{ height: `${height}px` }}
              />
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}