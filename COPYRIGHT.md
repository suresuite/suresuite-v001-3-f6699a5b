# Copyright and licensing notice

**SuReSuite — Supply Chain Resilience Suite**
Copyright © 2023–2026 Phu Nguyen. All rights reserved, except where stated below.

## 1. Authorship and the PhD thesis

The complete SuReSuite software in this repository — the web application (`src/`), the
data and control plane (`supabase/`), the simulation worker (`sim-worker/`), the
simulation engine (`scsim/`) and their documentation — is part of the **PhD thesis of
Phu Nguyen**, developed at the Digital-AI Supply Chain Lab, Berlin School of Economics
and Law (HWR Berlin), under the supervision of Prof. Dr. Dr. habil. Dmitry Ivanov.

Unless a file or directory states otherwise, no licence is granted to copy, modify,
distribute or use this software, in whole or in part. Requests for access or use:
phu.nguyen@hwr-berlin.de.

## 2. Parts that will be released as open access

The following parts are results of the EU Horizon Europe project **ACCURATE** and are
intended to be released publicly as open access:

| Component | Where it lives | Scope |
|---|---|---|
| Supply chain simulation library | `scsim/` | phase-pipeline engine, entities, policy registry, disruption injector, statistics, KPIs, synergy analysis, I/O |
| Supply chain stress-test framework | `scsim/scsim/stress/` with `disruption/` and `kpi/` | ST batteries, warm-state snapshots, Resilience Index, vulnerability ranking |

The public release is published **from this repository's `scsim/` directory** — it is
the same engine the platform runs, not a separate copy. The open-access licence, the
release boundary and the steps are in
[`docs/design/open-access-release-plan.md`](docs/design/open-access-release-plan.md).
Until that release happens and a licence file is added to `scsim/`, those parts are
covered by the "all rights reserved" statement above, like the rest of the repository.
See [`scsim/NOTICE.md`](scsim/NOTICE.md).

Everything else — the web application, the Supabase schema and functions, the
simulation worker, the platform's data contract and any project data — is not part of
the open-access release.

## 3. Funding acknowledgement

The ACCURATE project is funded by the European Union, under Grant Agreement number
101138269. Views and opinions expressed are however those of the author(s) only and do
not necessarily reflect those of the European Union or the European Health and Digital
Executive Agency. Neither the European Union nor the granting authority can be held
responsible for them.

## 4. Third-party components

Third-party libraries used by this software remain under their own licences, as
declared in `package.json` / `package-lock.json`, `scsim/pyproject.toml`,
`sim-worker/pyproject.toml` and `sim-worker/requirements.txt`. Nothing in this notice
changes those licences.
