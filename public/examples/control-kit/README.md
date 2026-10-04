# Control-kit tutorial inputs

Use these seven CSVs in a **new disposable project**, following `/docs/your-first-project`.
All entities and values are synthetic; these are not observations of real commercial relationships.

| File | Upload dataset | Rows |
|---|---|---:|
| suppliers.csv | Suppliers Master | 2 |
| materials.csv | Materials Master | 2 |
| products.csv | Products Master | 1 |
| customers.csv | Customers Master | 1 |
| bom_single_level.csv | BOM Single Level | 2 |
| inbound_logistic.csv | Inbound Logistics | 2 |
| outbound_logistic.csv | Outbound Logistics | 1 |

Create plant KIT-PLANT, Curated data, Make-To-Order, Single Level BOM, deep tier off.
P-KIT requires 1 M-BOARD and 2 M-CASE. C-SHOP requests 10 kits/week.
Plant capacity is 15 kits/week; supplier capacities are 20 boards/week and 40 housing halves/week.
Opening stock is 30 boards and 60 halves. Inbound lead time is one week.
Prices are 20 per board, 5 per half, and 60 per kit in one illustrative currency.
The annual holding-cost fraction 0.2 means 20%. Reliability 1 and deterministic demand/lead times are teaching assumptions.

## Controlled comparison

Use min-max inventory with fixed-days safety stock and no absolute s/S overrides.
A: 7 safety-stock days on both supplier material rows, no event.
B: same policy; supplier S-BOARD outage at day 84, 28 days, magnitude 100%.
C: same event; change only S-BOARD/M-BOARD safety-stock days to 28, leaving S-CASE/M-CASE at 7.
Save each intended policy version and retain the run identities.
Common settings: horizon 364 days, manual warm-up 28 days, seed 42, CRN enabled, 2 replications, no backorders.
Use the supplier-row values explicitly; pre-existing project overrides or different defaults can change outcomes.

## Verification boundary

Initial review: 32aa35b8f4f525ce9c75c49685d0866803840af3. Refreshed and rerun on
9accfc898cdee27e3d6f6d7c9d77bf69a64c396e (2026-10-04); verification.json also records the exact engine build.
The accompanying verifier executes these CSV rows through the local worker mapper and scsim 0.6.1.
`verification.json` contains the actual output, including conversion notes and the below-replication-floor flag.
The CSV contract test separately uses the app's parser and generated ingestion rules and checks cross-file identifiers.

Local result (two deterministic replications per case):

| Case | Fill rate | Lost-sales value | Average material inventory value |
|---|---:|---:|---:|
| A baseline | 1.0000 | 0 | 1300.0000 |
| B outage | 0.9744 | 600 | 1246.1538 |
| C buffer | 1.0000 | 0 | 1848.7179 |

These are local engine results, not completed production run records or promises about the live application.
The mapper uses a **39-week analysis window** for this 52-week horizon; manual warm-up is 4 weeks.
The reported confidence half-widths are zero because the inputs are deterministic.
Two replications are below the engine's replication floor and do not support a real decision.
This deliberately simple comparison illustrates service protection at the cost of more inventory.

Database promotion, server authorization, live dispatch, persistence, and end-to-end UI comparison have **not** been executed.
No production project was created or changed. The local verifier bypasses the database and is not a database-ingestion test.
To rerun from a repository checkout:

    PYTHONPATH=scsim:sim-worker python scripts/docs/verify-control-kit.py
    npm test -- src/components/docs/__tests__/controlKit.test.tsx

Changing inputs, defaults, engine version, scope or the analysis window can change these results.
