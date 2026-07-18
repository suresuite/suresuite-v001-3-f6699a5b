# SureSuite Public API (v1) — Reference & Quickstart

The public API lets external systems — scripts, notebooks, CI jobs, partner
services — drive SureSuite programmatically: manage input data, configure
policies, dispatch simulation runs, and retrieve results.

- **Design doc:** `docs/design/public-api-and-access-control.md` (G15)
- **Gateway:** `supabase/functions/api` (single entry point; every request is
  authenticated, scope- and tenancy-checked, rate-limited, validated, audited)
- **Key management UI:** the **Developer API** page (`/developer`) in the app

## Base URL

```
https://<project-ref>.supabase.co/functions/v1/api/v1
```

## Authentication

Every request carries an API key created on the Developer API page:

```
Authorization: Bearer sk_live_<keyid8>_<secret>
```

- Keys are org-scoped, carry explicit **scopes**, and can be restricted to
  specific projects. The secret is shown **once** at creation and stored only
  as a SHA-256 hash — rotate the key if you lose it.
- `sk_test_` keys are for integration work: much stricter rate limits and a
  single concurrent run.
- Rotation (`72 h` overlap) and revocation are instant, one click in the UI,
  and fully audited.

Identity comes only from the key. Nothing in the request body influences who
you are or what you may touch.

## Scopes

| Scope | Grants |
|---|---|
| `read:data` / `write:data` | read projects & dataset versions / freeze dataset versions |
| `read:policies` / `write:policies` | read catalog & configs / edit policies, snapshot versions |
| `read:runs` / `write:runs` | read runs & results / dispatch, cancel, extend runs |
| `admin:keys` | list/revoke keys over the API (usually humans use the UI instead) |

Missing scope ⇒ `403 missing_scope`. A key can never reach a project outside
its organization (or outside its project restriction) — those ids read as
`404`, deliberately indistinguishable from nonexistent ones.

## Rate limits & compute quotas

- Per-key request limits (defaults: live `120/min`, `5000/day`; test `30/min`,
  `300/day`). State is returned in `X-RateLimit-Limit / -Remaining / -Reset`;
  over-limit responses are `429` with `Retry-After`.
- Compute quotas on `POST …/runs`: max concurrent queued/running runs per org
  (default 5 live / 1 test) and an optional per-org replication ceiling under
  the global 200 clamp. A super admin can tier any org/key via the
  `api_rate_limits` table.
- Auth, authorization, and quota checks **fail closed**: if a backend needed
  for a security decision is unavailable, the request is denied (`503`).

## Idempotency

`POST …/runs` accepts an `Idempotency-Key` header. Retrying the same key within
24 h returns the **same** `run_id` (marked `Idempotency-Replayed: true`) instead
of dispatching a duplicate — safe retries, no double compute.

## Errors

All errors use one envelope; `X-Request-Id` is echoed on every response for
support/audit correlation:

```json
{ "error": { "code": "missing_scope", "message": "this key does not have the write:runs scope" } }
```

Notable codes: `invalid_key`, `expired_key`, `revoked_key` (401) ·
`missing_scope` (403) · `project_not_found`, `run_not_found`, `route_not_found`
(404) · `validation_failed` (422, includes the data-gate findings) ·
`rate_limited`, `daily_quota_exceeded`, `concurrent_runs_exceeded` (429) ·
`payload_too_large` (413).

## Endpoints

| Method & path | Scope | Returns |
|---|---|---|
| `GET /projects` | read:data | org's projects (cursor-paginated: `?limit=&cursor=`) |
| `GET /projects/{id}` | read:data | one project |
| `POST /projects/{id}/datasets:freeze` | write:data | `201` dataset version + `graph_hash` (deduped server-side) |
| `GET /projects/{id}/dataset-versions` | read:data | provenance history |
| `GET /projects/{id}/policy-catalog` | read:policies | engine policy catalog (registry export — the same contract the UI forms use) |
| `GET /projects/{id}/policies` | read:policies | policy defaults + per-node overrides |
| `PUT /projects/{id}/policies` | write:policies | update defaults (`{"defaults":{"inventory":{…}},"overrides":[…]}`) via the same RPCs the UI uses |
| `POST /projects/{id}/policy-versions` | write:policies | `201` immutable snapshot + `policy_hash` |
| `GET /projects/{id}/policy-versions` | read:policies | snapshot history |
| `GET /projects/{id}/scenarios` | read:runs | scenarios (paginated) |
| `POST /projects/{id}/scenarios` | write:runs | `201` new scenario (horizon, replications, seed, disruptions…) |
| `POST /projects/{id}/runs` | write:runs | `202 {run_id, status, policy_hash, graph_hash}`; body `{"scenario_id","policy_version_id","acknowledge_warnings"?}` |
| `GET /runs/{id}` | read:runs | status, aggregate KPIs, CI half-widths, provenance hashes, `gate_skipped` |
| `GET /runs/{id}/replications` | read:runs | per-replication KPI rows (`?include=time_series` for weekly series; cursor = rep index) |
| `POST /runs/{id}:cancel` | write:runs | `202` cancel |
| `POST /runs/{id}:add-reps` | write:runs | `202` extend an in-flight run (`{"n": 10}`) |
| `GET /runs/{id}/validation` | read:runs | credibility badge: `validated` / `stale` / `unvalidated` + the model-validation card |
| `GET /keys` | admin:keys | org's keys (never the secret) |
| `POST /keys/{id}:revoke` | admin:keys | kill switch over the API |

Runs are **asynchronous**: dispatch returns `202` immediately; poll
`GET /runs/{id}` with backoff until `status ∈ {succeeded, failed, cancelled}`.
(Webhooks and scoped realtime tokens are the planned push options — design doc §9.)

## Quickstart

```bash
export SURESUITE_API_KEY="sk_test_…"   # from the /developer page
BASE="https://<project-ref>.supabase.co/functions/v1/api/v1"

# list projects
curl -s "$BASE/projects" -H "Authorization: Bearer $SURESUITE_API_KEY"

# snapshot the current policy configuration
curl -s -X POST "$BASE/projects/$PROJECT/policy-versions" \
  -H "Authorization: Bearer $SURESUITE_API_KEY" \
  -H "Content-Type: application/json" -d '{"label":"api quickstart"}'

# dispatch a run (idempotent)
curl -s -X POST "$BASE/projects/$PROJECT/runs" \
  -H "Authorization: Bearer $SURESUITE_API_KEY" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: quickstart-1" \
  -d "{\"scenario_id\":\"$SCENARIO\",\"policy_version_id\":\"$VERSION\"}"

# poll
curl -s "$BASE/runs/$RUN_ID" -H "Authorization: Bearer $SURESUITE_API_KEY"
```

A Python end-to-end example (snapshot → dispatch → poll → replications) is on
the Developer API page's Quickstart tab.

### Jupyter notebook

`public/notebooks/suresuite_api_quickstart.ipynb` is a runnable walkthrough of
**every v1 use case** — auth, projects, dataset freezing, the policy catalog,
policy editing & snapshots, scenarios, run dispatch/polling, per-replication
analysis with pandas/matplotlib, credibility status, and A/B + disruption
experiments. Get it from the `/developer` page's **Notebook** tab, which also:

- lists the projects your account can access and, per project, every id the
  notebook needs (scenario / policy-version / dataset-version ids, base URL)
  with a copy-paste CONFIG cell;
- downloads the notebook with that CONFIG cell pre-filled; and
- links **Open in Google Colab** (store the key in Colab's Secrets panel as
  `SURESUITE_API_KEY` — never in a cell).

## Security model (summary)

See the design doc §10 for the full STRIDE analysis. In brief: hashed
show-once keys; identity never taken from the request body; tenancy checked at
the edge **and** re-verified in the database (`api_can_access_project`);
service role held only by the gateway; per-key rate limits + per-org compute
quotas; append-only `api_request_logs` for every request and
`admin_audit_logs` for every key lifecycle event; auth/authz/quota failures
fail closed; 401 storms are throttled by IP.
