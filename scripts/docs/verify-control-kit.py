"""Execute the manual's synthetic CSVs locally; no database or network access.
Run from the repository root: PYTHONPATH=scsim:sim-worker python scripts/docs/verify-control-kit.py
"""
import csv
import json
from pathlib import Path
from sim_worker.datamap import build_project_data
from sim_worker.scsim_bridge import compute_run_from_project

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / 'public/examples/control-kit'

def rows(name):
    with (DATA / name).open(newline='') as f:
        return list(csv.DictReader(f))

def verify():
    inputs = {key: rows(name + '.csv') for key, name in {
        'suppliers': 'suppliers', 'materials': 'materials', 'products': 'products',
        'customers': 'customers', 'inbound': 'inbound_logistic',
        'outbound': 'outbound_logistic', 'bom': 'bom_single_level',
    }.items()}
    report = {'verification_scope': 'Local worker mapper and scsim; CSV parsing and promotion are separate checks. No production run.', 'runs': {}}
    for name, disrupted, days in [('baseline', False, 7), ('outage', True, 7), ('buffer', True, 28)]:
        scenario = {'name': name, 'horizon_days': 364, 'warmup_mode': 'manual',
                    'warmup_days': 28, 'replications': 2, 'seed': 42, 'crn': True,
                    'disruption_schedule': ([{'target': 'supplier:S-BOARD', 'start_day': 84,
                      'duration_days': 28, 'magnitude_pct': 100}] if disrupted else [])}
        policies = {'default': {'inventory': {'type': 'min_max', 'safety_stock_method': 'fixed_days',
                                              'safety_stock_days': 7},
                                 'fulfillment': {'backorder_allowed': False}}}
        policies['node:S-BOARD::M-BOARD'] = {'inventory': {'safety_stock_days': days}}
        policies['node:S-CASE::M-CASE'] = {'inventory': {'safety_stock_days': 7}}
        out = compute_run_from_project(build_project_data(**inputs, policies=policies,
                                          scenario=scenario, project_model='Make-To-Order'))
        assert out['n_reps'] == 2, out['n_reps']
        assert len(out['replications']) == 2
        report['runs'][name] = {k: v for k, v in out.items()
            if k.startswith(('mean_', 'ci_')) or k in ('engine_version', 'engine_build', 'n_reps', 'below_replication_floor', 'mapping_warnings', 'warmup_detected_at')}
    return report

if __name__ == '__main__':
    print(json.dumps(verify(), indent=2, allow_nan=False))
