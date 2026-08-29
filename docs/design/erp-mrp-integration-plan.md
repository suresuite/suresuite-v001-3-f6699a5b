# SureSuite ↔ External MRP/ERP Integration — Plan

| | |
|---|---|
| **Status** | Draft v0.1 — proposal, not yet adopted |
| **Date** | 2026-08-29 |
| **Altitude** | Data ingestion architecture: replacing manual Excel upload with a governed, credentialed pull/push connection to an external MRP/ERP system |
| **Authority** | Governed by `docs/design/next-gen-platform-design.md`. Proposes a **new gap (G18)** — see §7 for the blueprint edit to apply on adoption. Builds on `docs/design/public-api-and-access-control.md` (G15) for the credential/authz machinery, and on `docs/data-simulation-mapping.md` for the data contract the import must fill. |
| **Non-goals** | Naming a specific vendor/product to integrate with, finished code, SQL DDL, dated schedule |

---

## 1. Problem

Today, `materials` / `products` / `suppliers` / `inbound_logistics` / `outbound_logistics` / `bom_*` are populated by uploading spreadsheets through `/project-manager` (`src/pages/DataManager.tsx`). That path is manual, has no source-system identity, and cannot refresh on a schedule. The request is to add a **direct, credentialed connection to an external MRP/ERP system** (SAP, Oracle, NetSuite, Odoo, Fishbowl, an in-house system, etc.) as a **second, complementary way** for item master, BOM/routing, and logistics data to reach SureSuite — automatically, alongside Excel upload, not instead of it.

**Excel upload is not deprecated.** It stays the default for organizations without an ERP, for one-off overrides, for offline/demo work, and as a manual correction path even for orgs that do have a live ERP connector. The two paths write into the same tables through the same reconciliation logic (§2.1), so a project can be populated by upload, by connector, or by both — whichever a given org needs at a given time.

This is a data-governance problem before it is a data-plumbing problem: the moment SureSuite pulls from a live ERP, it inherits that system's trust boundary — wrong scope, a leaked credential, or a bad field mapping can corrupt planning data or leak the customer's production data.

## 2. Design principles (extends the blueprint, doesn't replace it)

0. **This is an additional source, not a replacement.** The ERP connector and the Excel upload path coexist permanently; adopting this plan never removes or disables `/project-manager`'s upload flow.
1. **The import is a new *source*, not a new *pipeline*.** It must land in the same tables, through the same `ensure_item_masters()` reconciliation and the same `MappingWarning` mechanism that spreadsheet upload already uses (`docs/data-simulation-mapping.md` §1–§2). Two ingestion paths writing divergent shapes into `ProjectData` is exactly the "two code paths disagreed" failure the mapping doc was written to kill — do not reintroduce it.
2. **Every field that lands must be attributable**: which external system, which external record ID, when fetched, by which credential. Add `source_system`, `external_id`, `synced_at` provenance columns (or a side `external_source_links` table) rather than overwriting masters silently — mirrors the `dataset_version` provenance pattern already adopted in G15 §8.4.
3. **Read-only first.** SureSuite should default to *pulling* from the ERP (items, BOM, routings, supplier terms, lead times). Writing simulation-derived decisions *back* to the ERP (e.g., recommended reorder points) is a separate, later, explicitly-scoped capability — don't couple the two in v1.
4. **Credentials never live in application code or the frontend.** Use the same secret-storage discipline the platform already applies to its own API keys (G15 §5–§6: hashed/opaque tokens, scoped, rotatable, revocable, audit-logged) — extended to *outbound* credentials (the ERP's API key/OAuth token), stored server-side (Supabase Edge Function secrets / Vault), never exposed to the browser.
5. **Least privilege on both sides.** Request read-only, item-master-scoped API access from the ERP (not a full admin/integration user). On the SureSuite side, gate which projects/orgs a given ERP connection may write into — identical tenancy model to `organizations`/`organization_members`.
6. **Human-in-the-loop for the first sync.** The first import from any newly connected ERP should land in a staging/preview state (diff against current masters) before it overwrites live project data — same "trust but verify" posture this session's own operating rules apply to external content.

## 3. Target architecture

```
External MRP/ERP  ──(read-only API/OAuth, scoped credential)──►  connector (Supabase Edge Function)
                                                                        │
                                                                        ├─► staging tables (raw external shape + provenance)
                                                                        │
                                                                        ├─► field-mapping layer (per-ERP adapter → ProjectData shape,
                                                                        │     reusing datamap.py's normalization: units→weeks, price
                                                                        │     fallback rules from docs/data-simulation-mapping.md)
                                                                        │
                                                                        └─► materials / products / suppliers / inbound_logistics /
                                                                              outbound_logistics / bom_* (same tables Excel upload writes)
```

- **Connector** = one Edge Function per ERP family (or one generic function + per-vendor adapter config), following the existing `supabase/functions/*` pattern — not a new runtime.
- **Adapter** = a small, pure mapping module (vendor field names → SureSuite's canonical schema), analogous to `sim-worker/sim_worker/datamap.py` but for *inbound* ERP data instead of the simulation `ProjectData`.
- **Scheduling** = a periodic sync (cron-triggered Edge Function invocation) or webhook-driven, per ERP capability; either way every sync run is logged (what changed, from which credential, at what time) using the same audit pattern as `admin_audit_logs`.
- **Conflict/diff surface** = reuse the review pattern of `/project-manager`'s existing upload preview, extended to show "changed since last sync" rather than "new upload."

## 4. Data governance & access-control checklist

Before connecting to any real external system, confirm:

- [ ] **Legal/contractual basis** — does the org have the right to extract this data from the ERP (contract terms, data-processing agreement, IP ownership of BOM/pricing data)?
- [ ] **Least-privilege credential** — a scoped, read-only, revocable API key/OAuth client created specifically for this integration (not a shared admin login).
- [ ] **Data classification** — item cost/pricing and supplier terms are commercially sensitive; treat at the same sensitivity tier as the platform's own pricing data; restrict which SureSuite roles can view raw synced values vs. derived simulation outputs.
- [ ] **PII check** — MRP/ERP exports occasionally carry named contacts (supplier reps, planner names) in free-text fields; strip or mask fields not needed for simulation.
- [ ] **Storage location & residency** — confirm the target Supabase project's region satisfies any data-residency terms the ERP's data owner requires.
- [ ] **Retention & deletion** — define how long staged/raw external records are kept, and an on-request purge path (org offboarding, credential revocation).
- [ ] **Credential lifecycle** — rotation schedule, revocation on offboarding, no credential embedded in exported notebooks or client bundles (same rule G15 §10 sets for SureSuite's own API keys).
- [ ] **Audit trail** — every sync logged with source, credential id, record counts, and diff summary; surfaced to org admins.
- [ ] **Rate/quota respect** — the connector must respect the ERP's own rate limits (avoid being throttled/banned by the source system) — mirrors the quota discipline G15 already built for SureSuite's *own* API.
- [ ] **Fallback safety** — if a sync fails partway, never leave `materials`/`products` in a half-written state; stage-then-swap, matching the "worker = sole writer, idempotent by run_id" discipline already used for simulation results.

## 5. Phased rollout

| Phase | Scope | Exit criteria |
|---|---|---|
| **0 — Discovery** | Identify the target ERP/MRP product(s), confirm what API/export surface it actually offers (REST API, OData, flat-file SFTP drop, or none), and what access the organization can legally/technically obtain. Use the Claude Code prompt in §6 to research the target system's own repository/API docs if it is open-source or has a public SDK/GitHub. | A one-page findings doc: available integration surface, auth method, rate limits, data shape for items/BOM/logistics |
| **1 — Read-only single-connector pilot** | Build one adapter for the confirmed target system; land data in staging tables; manual review-and-approve before it reaches `materials`/`products`/etc. | A design partner org can review a diff and approve a sync into a real project |
| **2 — Scheduled sync + audit** | Cron/webhook-triggered syncs, audit log, alerting on failures or large diffs | Syncs run unattended; anomalous diffs (e.g. >X% of items changed) block auto-apply and require review |
| **3 — Multi-ERP adapters** | Generalize the adapter interface once ≥2 real ERPs are connected | Adding a third ERP = one adapter file, no changes to staging/governance layer (same "one plugin file" property the policy registry already guarantees — §1 pillar 1 of the blueprint) |
| **4 (later, separate approval)** | Write-back of simulation-derived recommendations into the ERP | Explicit scope, explicit approval — not assumed by this plan |

## 6. Next step: research prompt for the target ERP/MRP system

Use this prompt (with a Claude session that has GitHub access, via `add_repo` or the GitHub MCP tools) once the target system is identified and its repository is known or discoverable. It is written to be pasted as-is, with the bracketed placeholders filled in.

> I want to integrate SureSuite (a supply-chain simulation platform) with **[ERP/MRP system name]** so item master, BOM, and logistics data can be imported automatically instead of via Excel upload. Please investigate that system's GitHub repository — **[owner/repo, or "search for it if not given"]** — and its public docs, and report back on:
>
> 1. **Integration surface**: does it expose a REST/GraphQL API, an OData feed, a webhook system, a file-drop/SFTP export, or none of the above? Link the specific docs/source files that define it.
> 2. **Authentication**: what auth methods does it support for external API clients (API key, OAuth2 client-credentials, per-user token)? Can a read-only, least-privilege scope be created, or is access all-or-nothing?
> 3. **Rate limits and quotas**: any documented or code-visible rate limiting on its API.
> 4. **Data shapes relevant to us**: how does it model items/materials, bill of materials (BOM), suppliers, purchase/sales orders, and lead times? Note field names and units (this will map to SureSuite's canonical schema described in `docs/data-simulation-mapping.md`).
> 5. **Change/delta detection**: does it support incremental sync (updated-since timestamps, webhooks, change-data-capture) or only full exports?
> 6. **Licensing/ToS constraints**: is programmatic API access permitted under its license/terms for a third-party integration like this? Flag anything requiring a paid partner agreement.
> 7. **Known integration examples**: does the repo or its ecosystem already have connectors/SDKs (Python/JS/Node) we could reuse instead of writing a raw HTTP client?
>
> Do not write integration code yet — this is a research and feasibility pass. Summarize findings and flag any blockers (auth model that can't be scoped read-only, no incremental sync, restrictive licensing) before we design the SureSuite-side connector.

## 6a. Phase 0 findings — `suresuite/orbit-mrp` ("virtual-mrp")

Investigated directly (repo cloned read-only, same `suresuite` GitHub org). This is a Lovable-built React/Vite app ("virtual-mrp") on its own Supabase project — an MRP tool, not a third-party vendor product — which makes this integration materially easier than a generic external ERP.

1. **Integration surface — MCP over HTTP, plus plain REST fallback.** The app *is* an MCP server (`docs/agent-access.md`): one endpoint at `https://<app>/mcp`. It also exposes the same tools as plain HTTP routes (`/.mcp/list-tools`, `/.mcp/invoke-tool/<tool>`) for scripting — no separate API to design against.
2. **Authentication — OAuth 2.1, no static API keys.** Its own Supabase project acts as the OAuth 2.1 authorization server (dynamic client registration; discovery via `/.well-known/oauth-protected-resource`). A connecting client authenticates as a real app user and inherits that user's company scope and role — **RLS applies to agent calls exactly as it does to the UI**, so read-only, least-privilege access is achieved by connecting as a user whose role is read-only, not by a separate credential tier.
3. **Rate limits** — none documented in the repo; whatever Supabase-project-level limits apply.
4. **Data shapes relevant to us** — confirmed against `migration/00*.sql` and `docs/agent-access.md`:
   - `products` (id, company_id, name, sku, **type**: `finished_good`/`subassembly`/`raw_material`, unit_of_measure, lead_time_days, moq, unit_cost, supplier_name/number/country, cycle_time_seconds) — maps directly to SureSuite's `materials`/`products`/`suppliers`.
   - `bom_versions` + `bom_lines` (component_product_id, quantity_per_unit, scrap_factor) — a versioned, active-flagged BOM, multi-level via component chaining — maps to `bom_single_level`/`bom_multi_level`.
   - `machines`, `processes`, `production_paths`, `operations` — routing/capacity detail SureSuite's schema doesn't yet fully consume (relevant to `inbound_logistics`/plant capacity policies, not a 1:1 field match — needs its own mapping work in Phase 1).
   - `demand_plan`, `mps_plan`, `mrp_plan`, `purchase_orders`, `production_orders`, `inventory_transactions` — MRP *outputs*, useful context but not inputs SureSuite's simulation needs; out of scope for a v1 read.
5. **Change/delta detection** — no explicit updated-since filter documented on `list_products`/`get_bom`; `list_snapshots` exposes monthly rolling snapshots with status, which is the natural cursor for "what changed" at the planning-run level. Full-list-and-diff is the safe default until confirmed otherwise.
6. **Licensing/ToS** — none; this is a sibling `suresuite`-org repo, not a third-party product, so there is no external ToS constraint. Access is an internal authorization decision (who gets a read-only role in that Supabase project), not a legal one.
7. **Existing SDKs** — `@lovable.dev/mcp-js` is already a dependency; any generic MCP client (including Claude Code itself, via `claude mcp add --transport http`) works without a bespoke HTTP client.

**Blockers/flags found, not architecture — must be resolved before any live connection:**
- **`.env` is committed to the repository** with the Supabase project ref, URL, and publishable key. The publishable/anon key is designed to be public (client-side), but a committed `.env` is still bad practice (rotates awkwardly, encourages committing the service-role key by habit later) — flag to the orbit-mrp maintainers to `.gitignore` it and rely on `.env.example`.
- **`migration/*.sql` contains what looks like a real customer data dump** ("Imported from TRONICO" — real supplier names, part numbers, unit costs). That data must **not** be pulled into a SureSuite dev/staging project as sample data without confirming it's authorized test data or already anonymized — treat it as production-sensitive per §4's data-classification checkbox.
- No `LICENSE` file — expected for an internal sibling repo, but confirms there's no external redistribution question to resolve.

**Net read:** connecting to `orbit-mrp` is a same-org OAuth/MCP integration, not a generic third-party ERP integration — Phase 1 (single read-only connector pilot) can likely skip building a bespoke adapter and instead have the SureSuite-side connector (Edge Function) act as an **MCP client** calling `list_products`/`get_bom`/`get_purchase_orders`, authenticated as a dedicated read-only orbit-mrp user created for this integration.

## 7. Blueprint edit on adoption

If this plan is adopted, add to `docs/design/next-gen-platform-design.md` §2.3 Gap catalog:

> **G18** | **No inbound ERP/MRP data connector.** Item masters, BOM, and logistics data can only be entered via manual Excel upload (`/project-manager`); no complementary path exists for a live external ERP to feed `materials`/`products`/`inbound_logistics`/`outbound_logistics` directly, and no governance layer exists for external-system credentials. | `src/pages/DataManager.tsx` (upload-only), no `external_source_links`/staging tables | Organizations with an existing ERP must re-key data by hand and cannot keep SureSuite's masters in sync; `docs/design/erp-mrp-integration-plan.md` defines the fix (staged connector, provenance columns, credential governance modeled on G15) |
