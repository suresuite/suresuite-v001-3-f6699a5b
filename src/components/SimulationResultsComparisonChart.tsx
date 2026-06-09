import React from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DEFAULT_KPI_CONFIGS, KPIData } from '@/types/simulation';

interface SimulationResultsComparisonChartProps {
  baselineData: KPIData;
  selectedData: KPIData;
  baselineLabel?: string;
  selectedLabel?: string;
  simulationPeriod?: { start_week: number; end_week: number } | { start_day: number; end_day: number };
}

export function SimulationResultsComparisonChart({
  baselineData,
  selectedData,
  baselineLabel = 'Baseline',
  selectedLabel = 'Selected',
  simulationPeriod
}: SimulationResultsComparisonChartProps) {
  const [selectedKPI, setSelectedKPI] = React.useState<string>('fill_rate');

  // Debug: log incoming data
  React.useEffect(() => {
    const b = baselineData?.[selectedKPI] || [];
    const s = selectedData?.[selectedKPI] || [];
    console.debug('[Comparison Chart] KPI:', selectedKPI, 'baseline len:', b.length, 'selected len:', s.length);
  }, [baselineData, selectedData, selectedKPI]);

  // Prepare chart data - always show both lines
  const chartData = React.useMemo(() => {
    const selectedBaselineData = baselineData[selectedKPI] || [];
    const selectedScenarioData = selectedData[selectedKPI] || [];
    
    console.debug('[Comparison Chart] Building chart data for KPI:', selectedKPI);
    console.debug('[Comparison Chart] Baseline data length:', selectedBaselineData.length);
    console.debug('[Comparison Chart] Selected data length:', selectedScenarioData.length);
    
    if (selectedBaselineData.length === 0 && selectedScenarioData.length === 0) {
      console.debug('[Comparison Chart] No data available for either series');
      return [];
    }
    
    // Get all unique time points from both datasets
    const allTimePoints = new Set<number>();
    
    selectedBaselineData.forEach((point: any) => {
      allTimePoints.add(point.week ?? point.day ?? 0);
    });
    
    selectedScenarioData.forEach((point: any) => {
      allTimePoints.add(point.week ?? point.day ?? 0);
    });
    
    // Convert to sorted array and filter to show only week 8 onward
    const sortedTimePoints = Array.from(allTimePoints)
      .sort((a, b) => a - b)
      .filter(timePoint => timePoint >= 8);
    
    console.debug('[Comparison Chart] Time points after filtering:', sortedTimePoints.length, 'min time: 8');
    
    return sortedTimePoints.map(timePoint => {
      const dataPoint: any = { week: timePoint };
      
      const baselinePoint = selectedBaselineData.find((p: any) => 
        (p.week ?? p.day ?? 0) === timePoint
      );
      const selectedPoint = selectedScenarioData.find((p: any) => 
        (p.week ?? p.day ?? 0) === timePoint
      );
      
      dataPoint[`${selectedKPI}_baseline`] = baselinePoint?.value ?? null;
      dataPoint[`${selectedKPI}_selected`] = selectedPoint?.value ?? null;
      
      return dataPoint;
    });
  }, [baselineData, selectedData, selectedKPI]);

  const handleKPIChange = (kpiId: string) => {
    setSelectedKPI(kpiId);
  };

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      const config = DEFAULT_KPI_CONFIGS[selectedKPI];
      
      return (
        <div className="bg-background p-3 rounded-lg border shadow-lg">
          <p className="text-sm text-muted-foreground mb-2">Week {label}</p>
          <div className="space-y-1">
            {payload.map((entry: any, index: number) => {
              const isBaseline = entry.dataKey.includes('baseline');
              const dotColor = isBaseline ? 'hsl(var(--primary))' : 'hsl(var(--destructive))';
              let formattedValue = '';
              
              if (config?.format === 'percentage') {
                formattedValue = `${(entry.value * 100).toFixed(1)}%`;
              } else if (config?.format === 'currency') {
                formattedValue = new Intl.NumberFormat('en-US', { 
                  style: 'currency', 
                  currency: 'USD',
                  minimumFractionDigits: 0,
                  maximumFractionDigits: 0
                }).format(entry.value);
              } else {
                formattedValue = new Intl.NumberFormat('en-US', {
                  minimumFractionDigits: 0,
                  maximumFractionDigits: 0
                }).format(entry.value);
              }
              
              return (
                <div key={index} className="flex items-center gap-2">
                  <div 
                    className="w-2 h-2 rounded-full" 
                    style={{ backgroundColor: dotColor }}
                  />
                  <span className="text-sm text-muted-foreground">
                    {isBaseline ? baselineLabel : selectedLabel}:
                  </span>
                  <span className="text-sm font-bold">
                    {formattedValue}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      );
    }
    return null;
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Simulation Results Comparison</CardTitle>
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">KPI:</span>
            <Select value={selectedKPI} onValueChange={handleKPIChange}>
              <SelectTrigger className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(DEFAULT_KPI_CONFIGS).map(([kpiId, config]) => (
                  <SelectItem key={kpiId} value={kpiId}>
                    {config.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="flex items-center gap-4 text-sm text-muted-foreground">
          <div className="flex items-center gap-2">
            <div className="w-3 h-0.5 bg-primary rounded" />
            <span>{baselineLabel}</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-0.5 bg-destructive rounded" />
            <span>{selectedLabel}</span>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="h-96">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 20, right: 30, left: 20, bottom: 20 }}>
              <CartesianGrid strokeDasharray="1 1" stroke="hsl(var(--border))" strokeWidth={0.5} />
              <XAxis 
                dataKey="week" 
                axisLine={false}
                tickLine={false}
                tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }}
                tickMargin={8}
                label={{ value: 'Week', position: 'insideBottom', offset: -10 }}
              />
              <YAxis 
                axisLine={false}
                tickLine={false}
                tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }}
                tickFormatter={(value) => {
                  const config = DEFAULT_KPI_CONFIGS[selectedKPI];
                  if (config?.format === 'percentage') {
                    return `${(value * 100).toFixed(0)}%`;
                  } else if (value >= 1000000) {
                    return `${(value / 1000000).toFixed(0)}M`;
                  } else if (value >= 1000) {
                    return `${(value / 1000).toFixed(0)}k`;
                  }
                  return value.toString();
                }}
              />
              <Tooltip content={<CustomTooltip />} />
              
              {/* Always render both lines */}
              <Line
                type="monotone"
                dataKey={`${selectedKPI}_baseline`}
                stroke="hsl(var(--primary))"
                strokeWidth={2.5}
                dot={false}
                name={`${DEFAULT_KPI_CONFIGS[selectedKPI].name} (${baselineLabel})`}
                connectNulls={true}
              />
              <Line
                type="monotone"
                dataKey={`${selectedKPI}_selected`}
                stroke="hsl(var(--destructive))"
                strokeWidth={2.5}
                dot={false}
                name={`${DEFAULT_KPI_CONFIGS[selectedKPI].name} (${selectedLabel})`}
                connectNulls={true}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}