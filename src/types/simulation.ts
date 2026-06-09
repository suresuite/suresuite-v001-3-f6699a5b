export interface KPIDataPoint {
  week?: number;
  day?: number;
  value: number;
}

export interface KPIData {
  [key: string]: KPIDataPoint[];
}

export interface AuditSummary {
  orders_placed: number;
  production_events: number;
  total_units_produced: number;
  disruptions_recorded: number;
  inventory_changes: number;
  material_consumption_events: number;
  total_materials_consumed: number;
}

export interface ExternalApiMetadata {
  response_type: string;
  note: string;
  generated_at: string;
}

export interface SimulationSummary {
  simulation_engine_version: string;
  weeks_simulated: number;
  orders_placed: number;
  productions_completed: number;
  avg_fill_rate: number;
}

export interface SimulationMetrics {
  baseline: KPIData;
  scenario: KPIData;
  simulation_period: {
    start_day: number;
    end_day: number;
  };
  available_kpis: string[];
  // Enhanced fields from external API
  audit_summary?: AuditSummary;
  simulation_version?: string;
  kpi_calculation_version?: string;
  production_validation_enabled?: boolean;
  revenue_validation_enabled?: boolean;
  external_api_metadata?: ExternalApiMetadata;
  summary?: SimulationSummary;
  raw_result_data?: any;
  // Legacy fields for backward compatibility
  total_disrupted_nodes?: number;
  impact_severity?: number;
  recovery_time?: number;
}

export interface BaselineSimulation {
  id: string;
  status: string;
  started_at?: string;
  completed_at?: string;
  metrics?: SimulationMetrics;
  job_type: 'baseline';
}

export interface ScenarioJob {
  id: string;
  status: string;
  started_at?: string;
  completed_at?: string;
  scenario_ids: string[];
  config?: any;
  simulation_result_id?: string;
  job_type: 'scenarios' | 'baseline' | 'baseline_scenario' | 'scenario_only';
}

export interface SimulationResult {
  id: string;
  simulation_id?: string; // For individual scenario results
  scenario_id?: string; // For individual scenario results
  status: string;
  started_at?: string;
  completed_at?: string;
  scenario_ids: string[];
  metrics?: SimulationMetrics;
  scenario_names?: string[];
  scenario_name?: string; // For individual scenario results
  scenario_description?: string; // For individual scenario results
  scenario_effects?: Array<{
    effect_type: string;
    magnitude: number;
    unit: string;
  }>;
}

export type SimulationSelectionMode = 'none' | 'latest' | 'specific';

export interface SimulationFilterState {
  status: string[];
  dateRange: { from: Date | null; to: Date | null };
  simulationType: 'all' | 'baseline' | 'scenario';
}

export interface KPIConfig {
  id: string;
  name: string;
  unit: string;
  format: 'percentage' | 'currency' | 'number';
  color: string;
  description: string;
  category: 'financial' | 'operational' | 'risk';
}

export const DEFAULT_KPI_CONFIGS: Record<string, KPIConfig> = {
  fill_rate: {
    id: 'fill_rate',
    name: 'Fill Rate',
    unit: '%',
    format: 'percentage',
    color: 'hsl(var(--chart-1))',
    description: 'Percentage of demand fulfilled',
    category: 'operational'
  },
  revenue: {
    id: 'revenue',
    name: 'Revenue',
    unit: '$',
    format: 'currency',
    color: 'hsl(var(--chart-2))',
    description: 'Total revenue generated',
    category: 'financial'
  },
  profit: {
    id: 'profit',
    name: 'Profit',
    unit: '$',
    format: 'currency',
    color: 'hsl(var(--chart-3))',
    description: 'Net profit after costs',
    category: 'financial'
  },
  delivery_on_time: {
    id: 'delivery_on_time',
    name: 'On-Time Delivery',
    unit: '%',
    format: 'percentage',
    color: 'hsl(var(--chart-4))',
    description: 'Percentage of on-time deliveries',
    category: 'operational'
  },
  backlog: {
    id: 'backlog',
    name: 'Backlog',
    unit: 'units',
    format: 'number',
    color: 'hsl(var(--chart-5))',
    description: 'Number of unfulfilled orders',
    category: 'operational'
  },
  resilience_cost: {
    id: 'resilience_cost',
    name: 'Resilience Cost',
    unit: '$',
    format: 'currency',
    color: 'hsl(var(--destructive))',
    description: 'Cost of disruption mitigation',
    category: 'risk'
  },
  time_to_survive: {
    id: 'time_to_survive',
    name: 'Time-To-Survive',
    unit: 'weeks',
    format: 'number',
    color: 'hsl(220 70% 50%)',
    description: 'Weeks until performance drops below critical threshold (disruption-adjusted)',
    category: 'risk'
  },
  time_to_recover: {
    id: 'time_to_recover',
    name: 'Time-To-Recover',
    unit: 'weeks',
    format: 'number',
    color: 'hsl(280 65% 60%)',
    description: 'Weeks to restore performance after disruption (disruption-adjusted)',
    category: 'risk'
  },
  time_to_adapt: {
    id: 'time_to_adapt',
    name: 'Time-To-Adapt',
    unit: 'weeks',
    format: 'number',
    color: 'hsl(320 70% 55%)',
    description: 'Weeks to implement adaptive measures (disruption-adjusted)',
    category: 'risk'
  }
};

export const KPI_PRESETS = {
  all: Object.keys(DEFAULT_KPI_CONFIGS),
  financial: ['revenue', 'profit'],
  operational: ['fill_rate', 'delivery_on_time', 'backlog'],
  risk: ['resilience_cost', 'fill_rate', 'time_to_survive', 'time_to_recover', 'time_to_adapt'],
  resilience: ['time_to_survive', 'time_to_recover', 'time_to_adapt']
};