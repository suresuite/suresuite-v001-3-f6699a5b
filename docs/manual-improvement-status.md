# Manual improvement: onboarding batch

Initial source commit: `32aa35b8f4f525ce9c75c49685d0866803840af3` (2026-10-04). Refreshed against `9accfc898cdee27e3d6f6d7c9d77bf69a64c396e` after 19 upstream commits arrived; those changes are preserved. The model planning-period instruction, registry checklist and exact engine-build output were updated, and checks rerun. This report records a completed, reviewable first batch; the manual-wide request remains partially complete. Implementation evidence and unresolved data-layer claims are owned by [PLAN §4.9](PLAN.md#49-documentation-onboarding-review--2026-10-04), with its §16 drift entry.

## What changed and why

| Before | Implemented |
|---|---|
| Getting started described features without a connected downloadable exercise | A synthetic control-kit project, seven CSVs, ID and unit explanations, explicit upload/promotion checkpoints, baseline policy, validation evidence, and A/B/C experiment instructions |
| Upload guidance blurred file parsing, accepted inputs and readiness | Separate preview, staged review, promotion, findings, natural-key re-upload behavior, network-table exceptions, and recovery instructions |
| Data lifecycle implied more uniformity than the code provides | Diagram and worked example separate raw/staged/accepted/derived/frozen state, identity versus validity, and field-specific resolution |
| Figure slots could publish internal author briefs | Unfilled slots stay internal; published missing assets fail; four diagrams explain this batch |
| Entry choices omitted an explicit API developer path | Four reader questions lead to analyst, manager/researcher, API developer and engineer starting pages; target pages beyond this batch remain to be deepened |

Changed implementation paths:

- `src/components/docs/bodies/{YourFirstProject,UploadingData,HowYourDataFlows}.tsx`
- `src/components/docs/{DocsHome,DocFigure}.tsx`, `figureManifest.ts`
- `src/assets/manual/{flow,control-kit-chain,first-project-checkpoints,upload-review-promote}.svg`
- `src/components/docs/__tests__/{controlKit.test.tsx,figures.test.ts}`
- `public/examples/control-kit/`: seven CSVs, README and actual verification JSON
- `scripts/docs/`: local sample runner, isolated preview and reproducible browser capture
- `docs/manual-evidence/`, this report, and append-only additions to `docs/PLAN.md`

## Worked example and execution boundary

[Downloadable inputs and notes](../public/examples/control-kit/README.md) connect two suppliers, two materials, one product and one customer. The actual local worker/engine path completed two deterministic replications each for baseline A, board outage B and larger preventive board buffer C. Fill rates were 1.0000 / 0.9744 / 1.0000; lost-sales values 0 / 600 / 0; average material inventory values 1300.0000 / 1246.1538 / 1848.7179. One illustrative currency is used throughout. See [raw output and warnings](../public/examples/control-kit/verification.json).

These are executed local model results, not persisted application run records. The 52-week horizon uses a 39-week analysis window and a 4-week manual warm-up. The run explicitly flags two replications as below its floor; zero-width intervals arise from deterministic inputs. The tutorial asks users to retain their validated model's replication recommendation, rather than presenting the quick fixture as an adequate validation protocol. No real observations or commercial relationships are asserted.

## Rendered evidence

The preview mounts the actual three production body components and app stylesheet in an isolated local router. It labels itself as a local documentation preview. This verifies those bodies, figures and responsive styling; it does not certify the signed-in app shell or access behavior. All 12 combinations (three pages × desktop/mobile × light/dark) completed without horizontal overflow or browser page errors; [machine-readable checks](manual-evidence/render-checks.json).

Selected actual captures:

- [First project, desktop light](manual-evidence/first-project-desktop-light-viewport.png)
- [First project, mobile dark](manual-evidence/first-project-mobile-dark-viewport.png)
- [Worked example and downloads](manual-evidence/control-kit-example.png)
- [Upload guide, mobile dark](manual-evidence/uploading-data-mobile-dark.png)
- [Data lifecycle, desktop light](manual-evidence/how-your-data-flows-desktop-light.png)

Reproduce with `node scripts/docs/capture-manual.cjs` after installing Playwright and Chromium. Set `MANUAL_CHROME_EXECUTABLE` for an existing browser. The harness blocks external requests. It regenerates all captures; only the selected evidence above is committed.

## Verification

Final results are recorded below. No generated references were hand-edited.

| Check | Result |
|---|---|
| `npm test -- src/components/docs/__tests__` | PASS: 10 suites, 364 tests, including 13 sample/render regressions |
| `npm run typecheck` | PASS against repository baseline: 15 held existing errors across 8 files, no new errors |
| `npm run check:docs` | PASS |
| `npm run contract:generate -- --check` | PASS: generated contract/manual outputs match source |
| `PYTHONPATH=scsim python scsim/scripts/gen_docs.py --check` | PASS |
| `npm run build` | PASS; existing large-chunk advisory remains |
| ESLint on changed TS/TSX and capture script | PASS: zero errors; one fast-refresh warning in standalone preview entry |
| `PYTHONPATH=scsim:sim-worker python scripts/docs/verify-control-kit.py` | PASS: six local replications; raw results saved |
| Browser rendering | PASS: 12 combinations, no overflow/page errors; selected captures visually inspected |

Earlier check failures were resolved: an unlocked install introduced extra type errors (fixed by restoring the original lockfile and running npm ci); incomplete local source reconstruction initially omitted migration/generator inputs (restored from the inspected commit); an old figure test expected unfinished placeholders (updated to enforce the new publishing contract). Standard browser download failed, so captures used a local Chromium installation. These failures do not remain as implementation regressions.

Not run: full application test suite, full-repository lint, full migration/contract rehearsal against a database, live authenticated upload/promotion, validated-model adoption, queue dispatch, persisted runs, comparison UI, deployed API authentication or authorization. No deployment, production simulation, project mutation or permission change was made. This local checkout was reconstructed from the inspected repository source; remote changes must be based on that real commit/tree, not the local reconstruction history.

## Unresolved product concerns

- **Promotion review wording:** the UI promises protection against changes since review more strongly than the inspected promotion implementation supports. The guide explains re-comparison. See PLAN §4.9 for exact sources and boundary; product text was not changed.
- **Caller identity binding:** the ingest handler accepts an asserted user ID and checks the actor's project role downstream. Platform JWT verification is enabled, but source inspection did not establish binding between that assertion and an authenticated application session. Treat this as a separate security-review concern, not a demonstrated deployed exploit. No authentication fix is included.
- **Broader stale prose:** untouched policy, network, results and permission pages have not been certified by this batch. In particular, do not infer universal policy precedence or deployed authorization from these three rewrites.

## Continuation sequence

1. Trace and rewrite firm, product and process network views with the same kit: node/edge semantics, units/weight/color, disconnected data, BOM depth versus company tiers, and engine inclusion. Add meaningful diagrams to each and render at both sizes/themes.
2. Trace supported policy fields individually through UI save state, defaults/overrides, mapper and engine. Deepen policy types/stages, missing values, effective values and versions; label stored-but-unused controls. Extend the executed fixture where useful.
3. Deepen experiment setup, states/cancellation/reuse, controlled comparisons, seeds/warm-up/replications, KPI windows and Resilience Index normalization. Add a source-verified result interpretation worked example without implying precision proves validity.
4. Separate account/organization/project roles and source versus deployment enforcement; review the concern above independently. Verify an API first request and response against an isolated environment, then improve engineer setup and remaining reader paths.
5. Finish remaining pages by task priority, update each checklist row only after source review/content/visual/render checks, and perform an authenticated end-to-end synthetic walkthrough when test access exists.

## Page-level checklist

“Complete” means rewritten, source-reviewed and locally rendered in this batch. “Remaining” means preserved, not certified or rewritten by this batch. The list is derived from the current body registry, not an earlier page count.

| Page | Status | Body |
|---|---|---|
| `what-suresuite-is` | Remaining | `WhatSureSuiteIs.tsx` |
| `how-suresuite-is-designed` | Remaining | `HowItIsDesigned.tsx` |
| `data-model` | Remaining | `DataModelAtAGlance.tsx` |
| `how-your-data-flows` | Complete | `HowYourDataFlows.tsx` |
| `what-happens-to-your-data` | Remaining | `WhatHappensToYourData.tsx` |
| `system-boundary` | Remaining | `SystemBoundary.tsx` |
| `known-limits` | Remaining | `KnownLimits.tsx` |
| `your-first-project` | Complete | `YourFirstProject.tsx` |
| `projects` | Remaining | `Projects.tsx` |
| `uploading-data` | Complete | `UploadingData.tsx` |
| `inbound-logistics` | Remaining | `InboundLogistics.tsx` |
| `outbound-logistics` | Remaining | `OutboundLogistics.tsx` |
| `demand-forecasts` | Remaining | `DemandForecasts.tsx` |
| `bom-single-level` | Remaining | `BomSingleLevel.tsx` |
| `bom-multi-level` | Remaining | `BomMultiLevel.tsx` |
| `materials` | Remaining | `Materials.tsx` |
| `products` | Remaining | `Products.tsx` |
| `suppliers` | Remaining | `Suppliers.tsx` |
| `node-list` | Remaining | `NodeList.tsx` |
| `deep-tier-nodes` | Remaining | `DeepTierNodes.tsx` |
| `deep-tier-edges` | Remaining | `DeepTierEdges.tsx` |
| `multi-tier-suppliers` | Remaining | `MultiTierSuppliers.tsx` |
| `units-and-time-periods` | Remaining | `UnitsAndTimePeriods.tsx` |
| `supply-chain-data` | Remaining | `SupplyChainData.tsx` |
| `multi-tier-data` | Remaining | `MultiTierData.tsx` |
| `network-summary` | Remaining | `NetworkSummary.tsx` |
| `dataset-versions` | Remaining | `DatasetVersions.tsx` |
| `how-policies-work` | Remaining | `HowPoliciesWork.tsx` |
| `how-planning-works` | Remaining | `HowPlanningWorks.tsx` |
| `supplier-stage` | Remaining | `SupplierStage.tsx` |
| `plant-stage` | Remaining | `PlantStage.tsx` |
| `customer-stage` | Remaining | `CustomerStage.tsx` |
| `policy-types` | Remaining | `PolicyTypes.tsx` |
| `policy-catalog` | Remaining | `PolicyCatalog.tsx` |
| `where-a-number-came-from` | Remaining | `WhereANumberCameFrom.tsx` |
| `when-a-value-is-missing` | Remaining | `WhenAValueIsMissing.tsx` |
| `policy-versions-and-presets` | Remaining | `PolicyVersionsAndPresets.tsx` |
| `verify-your-inputs` | Remaining | `VerifyYourInputs.tsx` |
| `data-trust-report` | Remaining | `DataTrustReport.tsx` |
| `model-validation` | Remaining | `ModelValidation.tsx` |
| `simulation-lab` | Remaining | `SimulationLab.tsx` |
| `scenarios` | Remaining | `Scenarios.tsx` |
| `disruptions` | Remaining | `Disruptions.tsx` |
| `recovery-playbooks` | Remaining | `RecoveryPlaybooks.tsx` |
| `experiments-and-comparison` | Remaining | `ExperimentsAndComparison.tsx` |
| `seeds-replications-confidence` | Remaining | `SeedsReplicationsConfidence.tsx` |
| `stress-tests` | Remaining | `StressTests.tsx` |
| `product-level-network` | Remaining | `ProductLevelNetwork.tsx` |
| `process-level-network` | Remaining | `ProcessLevelNetwork.tsx` |
| `firm-level-network` | Remaining | `FirmLevelNetwork.tsx` |
| `interactive-network-space` | Remaining | `InteractiveNetworkSpace.tsx` |
| `network-science-metrics` | Remaining | `NetworkScienceMetrics.tsx` |
| `ai-assistant` | Remaining | `AiAssistant.tsx` |
| `plans-and-proposals` | Remaining | `PlansAndProposals.tsx` |
| `project-memory` | Remaining | `ProjectMemory.tsx` |
| `models-budgets-limits` | Remaining | `ModelsBudgetsLimits.tsx` |
| `connecting-erp` | Remaining | `ConnectingErp.tsx` |
| `reviewing-a-sync` | Remaining | `ReviewingASync.tsx` |
| `csv-vs-connector` | Remaining | `CsvVsConnector.tsx` |
| `reading-your-results` | Remaining | `ReadingYourResults.tsx` |
| `kpis-and-resilience-index` | Remaining | `KpisAndResilienceIndex.tsx` |
| `per-item-time-series` | Remaining | `PerItemTimeSeries.tsx` |
| `performance-and-caching` | Remaining | `PerformanceAndCaching.tsx` |
| `reports-and-files` | Remaining | `ReportsAndFiles.tsx` |
| `verifiable-exports` | Remaining | `VerifiableExports.tsx` |
| `reproducibility-record` | Remaining | `ReproducibilityRecord.tsx` |
| `exporting-and-deleting` | Remaining | `ExportingAndDeleting.tsx` |
| `organizations-and-members` | Remaining | `OrganizationsAndMembers.tsx` |
| `roles-and-capabilities` | Remaining | `RolesAndCapabilities.tsx` |
| `project-access` | Remaining | `ProjectAccess.tsx` |
| `who-can-see-your-data` | Remaining | `WhoCanSeeYourData.tsx` |
| `audit-log` | Remaining | `AuditLog.tsx` |
| `admin-screens` | Remaining | `AdminScreens.tsx` |
| `account-and-password` | Remaining | `AccountAndPassword.tsx` |
| `getting-an-api-key` | Remaining | `GettingAnApiKey.tsx` |
| `endpoints-and-schemas` | Remaining | `EndpointsAndSchemas.tsx` |
| `rate-limits-and-idempotency` | Remaining | `RateLimitsAndIdempotency.tsx` |
| `request-log` | Remaining | `RequestLog.tsx` |
| `all-tables` | Remaining | `AllTables.tsx` |
| `units-and-conventions` | Remaining | `UnitsAndConventions.tsx` |
| `glossary` | Remaining | `Glossary.tsx` |
| `field-index` | Remaining | `FieldIndex.tsx` |
| `questions` | Remaining | `QuestionsAndAnswers.tsx` |
| `engine-versions` | Remaining | `EngineVersions.tsx` |

Current registry: **84 page bodies; 3 complete in this batch, 81 remaining**. The home entry cards and shared figure renderer were improved separately; this does not mark their destination pages complete.
