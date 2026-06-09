import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DEFAULT_KPI_CONFIGS, KPIDataPoint } from '@/types/simulation';
import { calculateResilienceKPIs } from '@/utils/resilienceCalculator';

interface SimpleResilienceKPICardProps {
  kpiId: string;
  baselineData: KPIDataPoint[];
  selectedData: KPIDataPoint[];
}

export function SimpleResilienceKPICard({ 
  kpiId, 
  baselineData, 
  selectedData
}: SimpleResilienceKPICardProps) {
  const config = DEFAULT_KPI_CONFIGS[kpiId];
  
  // Check if we have the necessary fill_rate data
  if (!baselineData?.length || !selectedData?.length) {
    return null;
  }

  // Calculate resilience metrics based on fill rate comparison
  const resilienceMetrics = calculateResilienceKPIs({
    baselineData,
    selectedData,
    disruptionStartWeek: 1
  });
  
  // Map original KPI IDs to their final calculated values
  const kpiMapping: Record<string, keyof typeof resilienceMetrics> = {
    'time_to_survive': 'tts_final',
    'time_to_recover': 'ttr_final', 
    'time_to_adapt': 'tta_final'
  };
  
  const actualKpiKey = kpiMapping[kpiId] || kpiId as keyof typeof resilienceMetrics;
  const value = resilienceMetrics[actualKpiKey];
  
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

  return (
    <Card className="w-full max-w-sm relative overflow-hidden transition-all duration-200 bg-gradient-to-br from-primary/5 to-secondary/5 border-primary/20">
      <div 
        className="absolute left-0 top-0 bottom-0 w-1"
        style={{ backgroundColor: config.color }}
      />
      <CardHeader className="pb-2 p-4">
        <CardTitle className="text-sm font-medium text-foreground">
          {config.name}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-4 pt-0">
        <div className="text-xl font-bold text-foreground">
          {formatValue(value)}
        </div>
        <div className="text-xs text-muted-foreground mt-1 leading-relaxed">
          {config.description}
        </div>
      </CardContent>
    </Card>
  );
}