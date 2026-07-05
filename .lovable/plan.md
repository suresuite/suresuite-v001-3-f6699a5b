# Super Admin Dashboard — Phased Plan

Delivered in **3 phases**. Each phase ships a working slice; nothing existing is removed or broken.

---

## Phase 1 — Foundation: Role, Orgs, Usage Logging, Global Dashboard

Goal: Super Admin can log in, see platform-wide metrics, manage users, and every AI call is tracked and budget-enforceable.

### 1.1 Database (migration)

New enum value + tables:

- `app_role` → add `'super_admin'`.
- `organizations` — name, slug, owner_user_id, status (`active|suspended`), settings jsonb, timestamps.
- `organization_members` — org_id, user_id, org_role (`owner|admin|member`), joined_at. Unique(org_id, user_id).
- `ai_providers` — code (`openai|google|anthropic|deepseek|...`), display_name, enabled, config jsonb.
- `ai_models` — provider_id, code (`openai/gpt-5.5`, …), display_name, input_cost_per_1k, output_cost_per_1k, max_context, enabled, deprecated_at. Seeded from current allowlist.
- `user_ai_permissions` — user_id, allowed_model_ids uuid[], default_model_id, fallback_model_id, temperature, max_context_override.
- `ai_budgets` — scope (`user|org|project`), scope_id, period (`daily|monthly`), budget_usd numeric, token_limit bigint, rpm int, rpd int. Composite unique(scope, scope_id, period).
- `ai_usage_logs` — user_id, org_id, project_id, model_id, provider_code, prompt_tokens, completion_tokens, total_tokens, cost_usd, latency_ms, status (`success|error|blocked`), error_code, request_id, created_at (indexed). Partitioned-friendly (created_at index + composite indexes on (user_id, created_at), (org_id, created_at)).
- `admin_audit_logs` — actor_user_id, action, target_type, target_id, before jsonb, after jsonb, ip inet, user_agent, created_at.

Migration also:

- Backfills `organizations` from distinct `approved_users.organization` text values; adds `organization_id uuid` FK to `approved_users` and `projects` (nullable first, backfilled, then keep text column for compatibility, don't drop yet).
- `GRANT SELECT, INSERT, UPDATE, DELETE ... TO authenticated`, `GRANT ALL TO service_role` for every new public table (per project rule).
- Enables RLS on all new tables.
- Security-definer helpers: `is_super_admin(uuid)`, `is_org_admin(uuid, uuid)`, `current_app_user_id()` (reads from `set_current_user_context` GUC used by existing auth).
- RLS policies:
  - `super_admin` → full access to every new table.
  - Users → read own `ai_usage_logs`, own `user_ai_permissions`, own budgets.
  - Org admins → read org-scoped rows.
  - `admin_audit_logs`: insert via SECURITY DEFINER RPC only; read = super_admin.

### 1.2 Edge function changes

- `project-ai-chat`:
  - Before model call: resolve user → check `user_ai_permissions.allowed_model_ids` (403 if not allowed), evaluate active budgets (block + log `status='blocked'` if exceeded), enforce rate limits via a small counter table or Redis-like check against `ai_usage_logs` count.
  - After model call: insert `ai_usage_logs` row with tokens (from provider response) and computed cost using `ai_models` rates. Never throws — logging failure is warned, not fatal.
- New shared helper `supabase/functions/_shared/ai-guard.ts` for permission + budget + logging.
- New RPC / edge function `admin-audit-log` used by frontend admin actions.

### 1.3 Frontend — Super Admin surface

- Route: `/admin` (index → global dashboard), `/admin/users`, `/admin/organizations`, `/admin/projects`, `/admin/models`, `/admin/audit`, `/admin/usage`.
- Add to `ROUTE_PERMISSIONS`: all `/admin/*` → `['super_admin']`. `RoleGuard` already handles redirect to `/forbidden`.
- Sidebar: new "Admin" section, only rendered when `user.role === 'super_admin'`.
- Reuse `PageLayout`, shadcn Table, existing chart primitives.
- Pages in Phase 1:
  - **Global Dashboard** — KPI cards (orgs, projects, users, AI requests, AI $ today/MTD), line chart AI spend by day (date-range filter), top 10 orgs/users tables. All from views over `ai_usage_logs`.
  - **User Management** — table with all `approved_users`, columns: name, email, org, role, status, MTD usage, MTD cost, budget, remaining. Row actions: edit, reset password (existing), suspend (toggle `is_active`), delete, change role, configure AI (opens drawer for `user_ai_permissions` + `ai_budgets`).
  - **Model Registry** — CRUD `ai_providers` / `ai_models` so adding a model = one row, no code change.

### 1.4 Deliverables

- 1 migration, updated `project-ai-chat`, new `admin-audit-log` fn, ~6 new admin pages, sidebar entry, seed data for providers/models matching current allowlist.

---

## Phase 2 — Organizations, Projects, Audit, Org Budget Dashboard

Goal: Full org/project management for Super Admin, org-admin dashboard for org owners, complete audit trail.

- **Organizations page** — table (name, owner, users, projects, usage, cost, status, created). Actions: view, edit, suspend/reactivate, delete (cascade guarded), view members, view projects.
- **Projects page** — cross-org project table with filters (org, owner, status, date). Actions: open, archive, delete, transfer ownership (updates `projects.owner_id` + audit).
- **Audit Log page** — filterable table over `admin_audit_logs` (actor, action, target, date). Every mutating admin action calls the audit RPC.
- **Org Budget Dashboard** — new route `/organization` for org owners/admins: org budget, spent, remaining, breakdown by project/member/model, trend chart. Uses same `ai_usage_logs` aggregations scoped by `org_id`.
- Bulk actions on user/org tables (suspend N, delete N) all audited.
- CSV export on tables (client-side, reuse existing pattern if any, otherwise `papaparse`).

---

## Phase 3 — User Budget Dashboard, Advanced Config, Polish

- **User AI Budget page** at `/profile` new tab: MTD budget, used, remaining, %, requests, tokens, cost by model, daily chart, monthly history, 80/90/100% warning banners driven by thresholds.
- **User AI config drawer** finalization: per-model toggles, per-budget-type limits with block behavior + user-facing toast when blocked, default + fallback model, max context, temperature.
- **Impersonation** (optional per spec) — Super Admin-only, generates short-lived context via `set_current_user_context` with audit entry, banner while active, hard exit button.
- **Downloadable reports** — server-side CSV/XLSX export for large ranges via edge function.
- **Dark mode QA**, responsive pass, pagination + server-side filtering on any table > 500 rows.
- Reconcile `ai_usage_logs` with AI Gateway logs weekly (edge cron) to catch drift.

---

## Technical notes / guardrails

- Existing custom auth (`authenticate_approved_user` + `set_current_user_context`) is preserved. Super Admin check flows through the same path; `useAuth` already exposes `role`.
- No changes to `src/integrations/supabase/client.ts`, `types.ts`, or `supabase/config.toml` project-level.
- Every new `public` table gets GRANTs in the same migration (project rule).
- `ai_usage_logs` grows fast: composite indexes + retention policy (default: keep 13 months, aggregate older into `ai_usage_daily` rollup) added in Phase 2.
- Adding a new model in the future = one INSERT into `ai_models` + optional provider row; no code change required.
- No existing route, page, or table is removed. `FloatingChatBubble` and current chat stay intact; the guard just adds enforcement.

## Open confirmations before build

1. Confirm the first Super Admin: which existing email should be promoted in the migration seed?
2. Confirm phase 1 scope is what you want to build first, or if you'd like me to reorder (e.g. Organizations before User Management).  
  
use account [modeler1@gmail.com](mailto:modeler1@gmail.com) as super Admin  
build Phase 1 first
  &nbsp;