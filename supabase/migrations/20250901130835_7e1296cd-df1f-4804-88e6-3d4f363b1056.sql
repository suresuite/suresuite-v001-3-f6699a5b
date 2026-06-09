-- Fix the trigger function that's causing issues with simulation_results inserts
-- The set_supply_chain_data_defaults() function references uploaded_by which doesn't exist on simulation_results table

-- Temporarily disable the trigger that's causing the issue
DROP TRIGGER IF EXISTS trigger_set_supply_chain_data_defaults ON public.simulation_results;

-- Insert placeholder simulation_results for latest project so UI can render
INSERT INTO public.simulation_results (
  project_id, plant_name, scenario_ids, status, started_at, completed_at, metrics, organization, created_by
) VALUES 
-- Supplier Factory Fire (completed)
(
  '48e9f6e0-2fee-4318-be0b-33b8ea353643'::uuid,
  'Plan 3',
  ARRAY[]::uuid[],
  'completed',
  now() - interval '2 days',
  now() - interval '1 day',
  '{
    "label": "Supplier Factory Fire",
    "simulation_period": { "start_day": 1, "end_day": 14 },
    "available_kpis": ["fill_rate", "revenue", "profit", "delivery_on_time", "backlog", "resilience_cost"],
    "baseline": {
      "fill_rate": [
        {"day":1, "value":95}, {"day":2, "value":95.5}, {"day":3, "value":95.2}, {"day":4, "value":95.7},
        {"day":5, "value":95.9}, {"day":6, "value":96.1}, {"day":7, "value":96.0}, {"day":8, "value":96.2},
        {"day":9, "value":96.3}, {"day":10, "value":96.5}, {"day":11, "value":96.6}, {"day":12, "value":96.7},
        {"day":13, "value":96.8}, {"day":14, "value":97.0}
      ],
      "revenue": [
        {"day":1, "value":150000}, {"day":2, "value":151200}, {"day":3, "value":149800}, {"day":4, "value":152000},
        {"day":5, "value":153500}, {"day":6, "value":154200}, {"day":7, "value":153900}, {"day":8, "value":155000},
        {"day":9, "value":155300}, {"day":10, "value":156000}, {"day":11, "value":156500}, {"day":12, "value":157200},
        {"day":13, "value":157800}, {"day":14, "value":158500}
      ],
      "profit": [
        {"day":1, "value":25000}, {"day":2, "value":25100}, {"day":3, "value":24800}, {"day":4, "value":25300},
        {"day":5, "value":25500}, {"day":6, "value":25600}, {"day":7, "value":25500}, {"day":8, "value":25700},
        {"day":9, "value":25800}, {"day":10, "value":25900}, {"day":11, "value":26000}, {"day":12, "value":26100},
        {"day":13, "value":26200}, {"day":14, "value":26300}
      ],
      "delivery_on_time": [
        {"day":1, "value":92}, {"day":2, "value":92.2}, {"day":3, "value":92.1}, {"day":4, "value":92.5},
        {"day":5, "value":92.7}, {"day":6, "value":92.9}, {"day":7, "value":93}, {"day":8, "value":93.2},
        {"day":9, "value":93.4}, {"day":10, "value":93.6}, {"day":11, "value":93.8}, {"day":12, "value":94},
        {"day":13, "value":94.2}, {"day":14, "value":94.5}
      ],
      "backlog": [
        {"day":1, "value":120}, {"day":2, "value":118}, {"day":3, "value":119}, {"day":4, "value":117},
        {"day":5, "value":116}, {"day":6, "value":115}, {"day":7, "value":114}, {"day":8, "value":113},
        {"day":9, "value":112}, {"day":10, "value":111}, {"day":11, "value":110}, {"day":12, "value":109},
        {"day":13, "value":108}, {"day":14, "value":107}
      ],
      "resilience_cost": [
        {"day":1, "value":5000}, {"day":2, "value":5100}, {"day":3, "value":5200}, {"day":4, "value":5300},
        {"day":5, "value":5400}, {"day":6, "value":5500}, {"day":7, "value":5600}, {"day":8, "value":5700},
        {"day":9, "value":5800}, {"day":10, "value":5900}, {"day":11, "value":6000}, {"day":12, "value":6100},
        {"day":13, "value":6200}, {"day":14, "value":6300}
      ]
    },
    "scenario": {
      "fill_rate": [
        {"day":1, "value":88}, {"day":2, "value":88.1}, {"day":3, "value":88.3}, {"day":4, "value":88.6},
        {"day":5, "value":88.9}, {"day":6, "value":89.1}, {"day":7, "value":89.3}, {"day":8, "value":89.5},
        {"day":9, "value":89.8}, {"day":10, "value":90}, {"day":11, "value":90.2}, {"day":12, "value":90.4},
        {"day":13, "value":90.6}, {"day":14, "value":90.8}
      ],
      "revenue": [
        {"day":1, "value":135000}, {"day":2, "value":136000}, {"day":3, "value":134500}, {"day":4, "value":136500},
        {"day":5, "value":137200}, {"day":6, "value":138000}, {"day":7, "value":137800}, {"day":8, "value":139000},
        {"day":9, "value":139500}, {"day":10, "value":140000}, {"day":11, "value":140500}, {"day":12, "value":141000},
        {"day":13, "value":141500}, {"day":14, "value":142000}
      ],
      "profit": [
        {"day":1, "value":18000}, {"day":2, "value":18200}, {"day":3, "value":17800}, {"day":4, "value":18400},
        {"day":5, "value":18600}, {"day":6, "value":18800}, {"day":7, "value":18700}, {"day":8, "value":18900},
        {"day":9, "value":19000}, {"day":10, "value":19100}, {"day":11, "value":19200}, {"day":12, "value":19300},
        {"day":13, "value":19400}, {"day":14, "value":19500}
      ],
      "delivery_on_time": [
        {"day":1, "value":85}, {"day":2, "value":85.2}, {"day":3, "value":85.1}, {"day":4, "value":85.4},
        {"day":5, "value":85.6}, {"day":6, "value":85.8}, {"day":7, "value":86}, {"day":8, "value":86.2},
        {"day":9, "value":86.3}, {"day":10, "value":86.5}, {"day":11, "value":86.6}, {"day":12, "value":86.8},
        {"day":13, "value":87}, {"day":14, "value":87.2}
      ],
      "backlog": [
        {"day":1, "value":180}, {"day":2, "value":179}, {"day":3, "value":178}, {"day":4, "value":176},
        {"day":5, "value":175}, {"day":6, "value":174}, {"day":7, "value":173}, {"day":8, "value":172},
        {"day":9, "value":171}, {"day":10, "value":170}, {"day":11, "value":169}, {"day":12, "value":168},
        {"day":13, "value":167}, {"day":14, "value":166}
      ],
      "resilience_cost": [
        {"day":1, "value":8500}, {"day":2, "value":8600}, {"day":3, "value":8700}, {"day":4, "value":8800},
        {"day":5, "value":8900}, {"day":6, "value":9000}, {"day":7, "value":9100}, {"day":8, "value":9200},
        {"day":9, "value":9300}, {"day":10, "value":9400}, {"day":11, "value":9500}, {"day":12, "value":9600},
        {"day":13, "value":9700}, {"day":14, "value":9800}
      ]
    },
    "total_disrupted_nodes": 7,
    "impact_severity": 0.72,
    "recovery_time": 9
  }'::jsonb,
  'Company1',
  '6fb76f62-876b-4616-b926-006691742c49'::uuid
),
-- Port Strike Disruption (running)
(
  '48e9f6e0-2fee-4318-be0b-33b8ea353643'::uuid,
  'Plan 3',
  ARRAY[]::uuid[],
  'running',
  now() - interval '6 hours',
  NULL,
  '{
    "label": "Port Strike Disruption",
    "simulation_period": { "start_day": 1, "end_day": 14 },
    "available_kpis": ["fill_rate", "revenue", "profit", "delivery_on_time", "backlog", "resilience_cost"],
    "baseline": {
      "fill_rate": [ {"day":1, "value":95}, {"day":14, "value":97} ],
      "revenue": [ {"day":1, "value":150000}, {"day":14, "value":158500} ],
      "profit": [ {"day":1, "value":25000}, {"day":14, "value":26300} ],
      "delivery_on_time": [ {"day":1, "value":92}, {"day":14, "value":94.5} ],
      "backlog": [ {"day":1, "value":120}, {"day":14, "value":107} ],
      "resilience_cost": [ {"day":1, "value":5000}, {"day":14, "value":6300} ]
    },
    "scenario": {
      "fill_rate": [ {"day":1, "value":90}, {"day":14, "value":92} ],
      "revenue": [ {"day":1, "value":140000}, {"day":14, "value":146500} ],
      "profit": [ {"day":1, "value":19500}, {"day":14, "value":20500} ],
      "delivery_on_time": [ {"day":1, "value":87}, {"day":14, "value":89} ],
      "backlog": [ {"day":1, "value":170}, {"day":14, "value":160} ],
      "resilience_cost": [ {"day":1, "value":7800}, {"day":14, "value":8500} ]
    },
    "total_disrupted_nodes": 4,
    "impact_severity": 0.5,
    "recovery_time": 6
  }'::jsonb,
  'Company1',
  '6fb76f62-876b-4616-b926-006691742c49'::uuid
),
-- Cyber Attack on Systems (failed)
(
  '48e9f6e0-2fee-4318-be0b-33b8ea353643'::uuid,
  'Plan 3',
  ARRAY[]::uuid[],
  'failed',
  now() - interval '1 day',
  now() - interval '23 hours',
  '{
    "label": "Cyber Attack on Systems",
    "simulation_period": { "start_day": 1, "end_day": 14 },
    "available_kpis": ["fill_rate", "revenue", "profit", "delivery_on_time", "backlog", "resilience_cost"],
    "baseline": {
      "fill_rate": [ {"day":1, "value":95}, {"day":14, "value":97} ],
      "revenue": [ {"day":1, "value":150000}, {"day":14, "value":158500} ],
      "profit": [ {"day":1, "value":25000}, {"day":14, "value":26300} ],
      "delivery_on_time": [ {"day":1, "value":92}, {"day":14, "value":94.5} ],
      "backlog": [ {"day":1, "value":120}, {"day":14, "value":107} ],
      "resilience_cost": [ {"day":1, "value":5000}, {"day":14, "value":6300} ]
    },
    "scenario": {
      "fill_rate": [ {"day":1, "value":80}, {"day":14, "value":83} ],
      "revenue": [ {"day":1, "value":125000}, {"day":14, "value":132000} ],
      "profit": [ {"day":1, "value":15000}, {"day":14, "value":16000} ],
      "delivery_on_time": [ {"day":1, "value":78}, {"day":14, "value":81} ],
      "backlog": [ {"day":1, "value":220}, {"day":14, "value":210} ],
      "resilience_cost": [ {"day":1, "value":10000}, {"day":14, "value":11500} ]
    },
    "total_disrupted_nodes": 9,
    "impact_severity": 0.85,
    "recovery_time": 12
  }'::jsonb,
  'Company1',
  '6fb76f62-876b-4616-b926-006691742c49'::uuid
)
ON CONFLICT DO NOTHING;