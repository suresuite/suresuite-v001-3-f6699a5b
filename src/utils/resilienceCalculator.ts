import { KPIDataPoint } from '../types/simulation';

export interface ResilienceMetrics {
  time_to_survive: number;
  time_to_recover: number;
  time_to_adapt: number;
  tts_final: number;
  ttr_final: number;
  tta_final: number;
}

export interface ResilienceCalculationInput {
  baselineData: KPIDataPoint[];
  selectedData: KPIDataPoint[];
  disruptionStartWeek?: number;
}

/**
 * Calculate resilience KPIs based on fill rate comparison between baseline and disruption scenarios
 * Implements the mathematical formulas for Time-To-Survive and Time-To-Recover
 */
export function calculateResilienceKPIs(input: ResilienceCalculationInput): ResilienceMetrics {
  const { baselineData, selectedData, disruptionStartWeek = 1 } = input;

  // Ensure both datasets exist and have data
  if (!baselineData?.length || !selectedData?.length) {
    return {
      time_to_survive: 0,
      time_to_recover: 0,
      time_to_adapt: 0,
      tts_final: 0,
      ttr_final: 0,
      tta_final: 0,
    };
  }

  // Create aligned time series data
  const alignedData = alignTimeSeries(baselineData, selectedData);
  
  if (alignedData.length === 0) {
    return {
      time_to_survive: 0,
      time_to_recover: 0,
      time_to_adapt: 0,
      tts_final: 0,
      ttr_final: 0,
      tta_final: 0,
    };
  }

  // Key time points
  const t1 = disruptionStartWeek;
  const t_max = Math.max(...alignedData.map(d => d.week));
  
  // Find t2: first week where disruption performance < baseline (performance drop)
  const performanceDropThreshold = 0.01; // 1% drop threshold
  let t2: number | null = null;
  
  for (const point of alignedData) {
    if (point.week >= t1 && point.baseline > point.selected + performanceDropThreshold) {
      t2 = point.week;
      break;
    }
  }

  // Find t4: first week after t2 where performance recovers (disruption ≈ baseline)
  const recoveryThreshold = 0.02; // 2% recovery threshold
  let t4: number | null = null;
  
  if (t2 !== null) {
    for (const point of alignedData) {
      if (point.week > t2 && Math.abs(point.baseline - point.selected) <= recoveryThreshold) {
        t4 = point.week;
        break;
      }
    }
  }

  // Calculate P_Lost: integral of (baseline - disruption) over impact period
  let lostPerformance = 0;
  if (t2 !== null) {
    const endTime = t4 || t_max;
    for (const point of alignedData) {
      if (point.week >= t2 && point.week <= endTime) {
        const performanceLoss = Math.max(0, point.baseline - point.selected);
        lostPerformance += performanceLoss;
      }
    }
  }

  // Calculate Time-To-Survive (Equation 2)
  const time_to_survive = lostPerformance > 0 
    ? (t2 !== null ? t2 - t1 : 0)
    : t_max - t1;

  // Calculate Time-To-Recover (Equation 3)
  const time_to_recover = lostPerformance > 0 
    ? (t4 !== null ? t4 - t1 : t_max - t1)
    : 0;

  // Calculate Time-To-Adapt (TTR - TTS)
  const time_to_adapt = Math.max(0, time_to_recover - time_to_survive);

  // Calculate final resilience KPIs with disruption start time = 15
  const first_disruption_start_time = 15;
  const tts_final = Math.max(0, time_to_survive - first_disruption_start_time);
  const ttr_final = Math.max(0, time_to_recover - first_disruption_start_time);
  const tta_final = Math.max(0, time_to_recover - time_to_survive - 2);

  return {
    time_to_survive: Math.round(time_to_survive * 10) / 10, // Round to 1 decimal place (already in weeks)
    time_to_recover: Math.round(time_to_recover * 10) / 10, // Round to 1 decimal place (already in weeks)
    time_to_adapt: Math.round(time_to_adapt * 10) / 10, // Round to 1 decimal place (already in weeks)
    tts_final: Math.round(tts_final * 10) / 10, // Final TTS adjusted for disruption start time
    ttr_final: Math.round(ttr_final * 10) / 10, // Final TTR adjusted for disruption start time
    tta_final: Math.round(tta_final * 10) / 10, // Final TTA calculated as TTR - TTS - 2
  };
}

/**
 * Align two time series datasets by week, handling missing data points
 */
function alignTimeSeries(
  baselineData: KPIDataPoint[], 
  selectedData: KPIDataPoint[]
): Array<{ week: number; baseline: number; selected: number }> {
  const baselineMap = new Map<number, number>();
  const selectedMap = new Map<number, number>();

  // Build maps for quick lookup
  baselineData.forEach(point => {
    const week = point.week || point.day || 0;
    if (week >= 0) {
      baselineMap.set(week, point.value);
    }
  });

  selectedData.forEach(point => {
    const week = point.week || point.day || 0;
    if (week >= 0) {
      selectedMap.set(week, point.value);
    }
  });

  // Get all weeks that exist in both datasets
  const allWeeks = Array.from(new Set([
    ...baselineMap.keys(),
    ...selectedMap.keys()
  ])).sort((a, b) => a - b);

  // Create aligned data points
  const alignedData: Array<{ week: number; baseline: number; selected: number }> = [];

  for (const week of allWeeks) {
    const baselineValue = baselineMap.get(week);
    const selectedValue = selectedMap.get(week);

    // Only include points where both datasets have values
    if (baselineValue !== undefined && selectedValue !== undefined) {
      alignedData.push({
        week,
        baseline: baselineValue,
        selected: selectedValue,
      });
    }
  }

  return alignedData;
}