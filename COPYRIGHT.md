# Copyright and licensing notice

**SuReSuite — Supply Chain Resilience Suite**
Copyright © 2023–2026 Phu Nguyen. All rights reserved, except where stated below.

## 1. Authorship and the PhD thesis

SuReSuite is a research prototype. The complete software in this repository — the web
application (`src/`), the data and control plane (`supabase/`), the simulation worker
(`sim-worker/`), the simulation engine (`scsim/`) and their documentation — is part of
the **PhD thesis of Phu Nguyen**, pursued as a **cooperative doctorate between the
Berlin School of Economics and Law (HWR Berlin) and Technische Universität Berlin
(TU Berlin)**. The work is carried out at the Digital-AI Supply Chain Lab, HWR Berlin,
under the supervision of Prof. Dr. Dr. habil. Dmitry Ivanov.

Unless a file or directory states otherwise, no licence is granted to copy, modify,
distribute or use this software, in whole or in part. Requests for access or use:
phu.nguyen@hwr-berlin.de.

## 2. Parts that will be released as open access

The core algorithms of SuReSuite — developed in part within the EU Horizon Europe
project **ACCURATE** and in part within the PhD research described above — are intended
to be published as **open access**, so that other
researchers, consortium partners, public bodies and industry can inspect, reproduce and
reuse them:

| Component | Where it lives | Scope |
|---|---|---|
| Supply chain network analysis | methods to be extracted into the library (today inside the platform's analysis functions) | network-science metrics, node centrality and prominence, critical-node identification |
| Supply chain simulation library | `scsim/` | phase-pipeline engine, entities, policy registry, disruption injector, statistics, KPIs, synergy analysis, I/O |
| Supply chain stress-test framework | `scsim/scsim/stress/` with `disruption/` and `kpi/` | ST batteries, warm-state snapshots, Resilience Index, vulnerability ranking |
| Surrogate models for stress testing | planned (blueprint §11, gap G12) | surrogate training, uncertainty calibration, adaptive sampling against the stress batteries |

The public release is published **from this repository** — it is the same code the
platform runs, not a separate copy, so every figure the platform produces can be traced
to a public, versioned release. The release boundary and the steps are in
[`docs/design/open-access-release-plan.md`](docs/design/open-access-release-plan.md).

### Intended licensing

In line with Horizon Europe open-science practice:

- **Source code** will be released under an **OSI-approved open-source licence**
  (Apache-2.0 or EUPL-1.2; the choice is decision L1 in the release plan, taken with HWR
  Berlin, TU Berlin and the ACCURATE coordinator).
- **Publications, documentation and synthetic benchmark data** will be released under
  **Creative Commons Attribution 4.0 International (CC BY 4.0)**.
- Each release will be deposited in a trusted repository (Zenodo) with a persistent
  identifier (DOI) and citation metadata, following the FAIR principles.

Until that release happens and a licence file is added, those parts are covered by the
"all rights reserved" statement above, like the rest of the repository. See
[`scsim/NOTICE.md`](scsim/NOTICE.md).

Everything else — the web application, the Supabase schema and functions, the
simulation worker, the platform's data contract, trained models built on customer or
project networks, and any project data — is not part of the open-access release.

## 3. Funding acknowledgement

Parts of this work were carried out within the ACCURATE project; the rest was carried
out within the PhD research at HWR Berlin and TU Berlin.

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
