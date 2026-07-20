import type { UserRole } from '@/hooks/useUserRole';
import { canAccessRoute } from '@/lib/permissions';

/**
 * Canonical capability catalog — kept in lock-step with the DB `capabilities`
 * table seeded in supabase/migrations/20260711000002_unified_access_control.sql.
 *
 * Two kinds:
 *  - page    → one entry per gateable route in ROUTE_PERMISSIONS
 *  - feature → cross-page abilities (AI, simulation, data editing, export…)
 *
 * The server is the source of truth: `get_my_capabilities` resolves the merged
 * role → org → user set. This file only carries the labels the UI needs and a
 * role-based fallback used when that fetch fails.
 */

export type CapabilityKind = 'page' | 'feature';

export interface CapabilityMeta {
  key: string;
  kind: CapabilityKind;
  label: string;
  description?: string;
}

export const PAGE_CAPABILITIES: CapabilityMeta[] = [
  { key: '/', kind: 'page', label: 'Getting Started' },
  { key: '/project-manager', kind: 'page', label: 'Project Manager' },
  { key: '/network/product-level', kind: 'page', label: 'Product-Level Network' },
  { key: '/network/process-level', kind: 'page', label: 'Process-Level Network' },
  { key: '/network/firm-level', kind: 'page', label: 'Firm-Level Network' },
  { key: '/network/interactive-space', kind: 'page', label: 'Interactive Network Space' },
  { key: '/policies', kind: 'page', label: 'Policies' },
  { key: '/simulation-lab', kind: 'page', label: 'Simulation Lab' },
  { key: '/project-intelligence', kind: 'page', label: 'Project Intelligence' },
  { key: '/developer', kind: 'page', label: 'Developer API' },
  { key: '/profile', kind: 'page', label: 'My Profile' },
  { key: '/admin', kind: 'page', label: 'Super Admin' },
];

export type FeatureKey =
  | 'ai_chat'
  | 'simulation_lab'
  | 'project_intelligence'
  | 'data_editing'
  | 'export'
  // AI-agent capability keys (ai-agents.md §13.1; seeded in
  // 20260715000003_agent_capabilities.sql):
  | 'agent_proposals'
  | 'agent_apply'
  | 'agent_data_steward'
  | 'agent_policy_configurator'
  | 'agent_vv_analyst'
  | 'agent_experiment_designer'
  | 'agent_explainer'
  // workstream M0 (ai-agents.md §14.7; seeded in 20260717000001_chat_store.sql):
  | 'chat_history_sync'
  // workstream M2 (ai-agents.md §14.4/§14.7; seeded in 20260717000003_project_memory.sql):
  | 'project_memory'
  // v1.2 Phase 3 (ai-agents.md §16.1/§13.3; seeded in
  // 20260723000001_reports_and_file_workspace.sql):
  | 'reports'
  | 'agent_report_builder'
  // v1.5 Phase 4a (ai-agents.md §18.1/§13.1; seeded in
  // 20260726193000_cost_estimator.sql):
  | 'agent_cost_estimator';

export const FEATURE_CAPABILITIES: CapabilityMeta[] = [
  { key: 'ai_chat', kind: 'feature', label: 'AI Assistant' },
  { key: 'simulation_lab', kind: 'feature', label: 'Run Simulations' },
  { key: 'project_intelligence', kind: 'feature', label: 'Project Intelligence' },
  { key: 'data_editing', kind: 'feature', label: 'Data Editing' },
  { key: 'export', kind: 'feature', label: 'Export' },
  { key: 'agent_proposals', kind: 'feature', label: 'Agent Proposals' },
  { key: 'agent_apply', kind: 'feature', label: 'Agent Apply' },
  { key: 'agent_data_steward', kind: 'feature', label: 'Data Steward Agent' },
  { key: 'agent_policy_configurator', kind: 'feature', label: 'Policy Configurator Agent' },
  { key: 'agent_vv_analyst', kind: 'feature', label: 'V&V Analyst Agent' },
  { key: 'agent_experiment_designer', kind: 'feature', label: 'Experiment Designer Agent' },
  { key: 'agent_explainer', kind: 'feature', label: 'Explainer Agent' },
  { key: 'chat_history_sync', kind: 'feature', label: 'Chat History Sync' },
  { key: 'project_memory', kind: 'feature', label: 'Project Memory' },
  { key: 'reports', kind: 'feature', label: 'Decision Reports' },
  { key: 'agent_report_builder', kind: 'feature', label: 'Report Builder Agent' },
  { key: 'agent_cost_estimator', kind: 'feature', label: 'Cost Estimator Agent' },
];

/** `/profile` is a system page — always reachable, never deniable. */
export const ALWAYS_ON_PAGES = new Set<string>(['/profile']);

/**
 * Chat client model id (ModelPicker / MODEL_REGISTRY) → `ai_models.code`.
 * The resolver returns allowed model *codes*; the chat UI speaks in client ids.
 */
export const CHAT_MODEL_CODES: Record<string, string> = {
  'gemini-2.5-flash': 'google/gemini-2.5-flash',
  'gpt-5': 'openai/gpt-5',
  'gpt-5-mini': 'openai/gpt-5-mini',
  'deepseek-chat': 'deepseek/deepseek-chat',
};

export interface EffectiveModels {
  all_allowed: boolean;
  allowed_codes: string[];
  default_code: string | null;
  fallback_code: string | null;
}

export interface EffectiveBudgets {
  monthly_usd: number | null;
  daily_usd: number | null;
  token_limit: number | null;
  rpm: number | null;
  rpd: number | null;
  mtd_cost_usd: number;
  mtd_requests: number;
  mtd_tokens: number;
  today_cost_usd: number;
  today_requests: number;
}

export interface EffectiveCapabilities {
  user_id: string | null;
  role: string | null;
  is_super_admin: boolean;
  pages: Record<string, boolean>;
  features: Record<string, boolean>;
  models: EffectiveModels;
  budgets: EffectiveBudgets;
}

/**
 * Match a pathname to a page capability key (longest prefix wins; `/admin/*`
 * folds into `/admin`). Returns null when no page capability governs the path
 * (e.g. `/help`, `/auth`) — such routes are treated as open.
 */
export function pageKeyForPath(pathname: string): string | null {
  let best: string | null = null;
  for (const { key } of PAGE_CAPABILITIES) {
    const matches =
      key === '/' ? pathname === '/' : pathname === key || pathname.startsWith(key + '/');
    if (matches && (best === null || key.length > best.length)) best = key;
  }
  return best;
}

const EMPTY_BUDGETS: EffectiveBudgets = {
  monthly_usd: null,
  daily_usd: null,
  token_limit: null,
  rpm: null,
  rpd: null,
  mtd_cost_usd: 0,
  mtd_requests: 0,
  mtd_tokens: 0,
  today_cost_usd: 0,
  today_requests: 0,
};

/**
 * Role-based fallback used when the capability fetch fails. Pages mirror
 * ROUTE_PERMISSIONS; features mirror the role_capabilities seed. Models/budgets
 * are left permissive (all_allowed, no budget) so a transient RPC failure never
 * wrongly blocks a legitimate AI call — real limits require the loaded set.
 */
export function roleFallbackCapabilities(
  role: UserRole | null | undefined,
): EffectiveCapabilities {
  const r = (role as UserRole) ?? 'user';
  const isSuper = r === 'super_admin';
  const pages: Record<string, boolean> = {};
  for (const { key } of PAGE_CAPABILITIES) {
    pages[key] = ALWAYS_ON_PAGES.has(key) ? true : canAccessRoute(key, r);
  }
  const powerRole = isSuper || r === 'admin' || r === 'modeler';
  const features: Record<string, boolean> = {
    ai_chat: true,
    project_intelligence: true,
    export: true,
    simulation_lab: powerRole,
    data_editing: powerRole,
    // Mirrors the 20260715000003 / 20260717000001 role seeds (ai-agents.md
    // §13.1, §14.7): proposals follow ai_chat; apply is power-role; per-agent
    // keys and chat_history_sync are off until their stages GA.
    agent_proposals: true,
    agent_apply: powerRole,
    agent_data_steward: false,
    agent_policy_configurator: false,
    agent_vv_analyst: false,
    agent_experiment_designer: false,
    agent_explainer: false,
    agent_cost_estimator: false,
    chat_history_sync: false,
    project_memory: false,
  };
  return {
    user_id: null,
    role: r,
    is_super_admin: isSuper,
    pages,
    features,
    models: { all_allowed: true, allowed_codes: [], default_code: null, fallback_code: null },
    budgets: { ...EMPTY_BUDGETS },
  };
}

/** Normalise the raw jsonb from get_my_capabilities into a typed object. */
export function normalizeCapabilities(raw: unknown): EffectiveCapabilities | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const models = (o.models ?? {}) as Record<string, unknown>;
  const budgets = (o.budgets ?? {}) as Record<string, unknown>;
  const num = (v: unknown): number => (v == null ? 0 : Number(v));
  const numOrNull = (v: unknown): number | null => (v == null ? null : Number(v));
  return {
    user_id: (o.user_id as string) ?? null,
    role: (o.role as string) ?? null,
    is_super_admin: Boolean(o.is_super_admin),
    pages: (o.pages as Record<string, boolean>) ?? {},
    features: (o.features as Record<string, boolean>) ?? {},
    models: {
      all_allowed: Boolean(models.all_allowed),
      allowed_codes: Array.isArray(models.allowed_codes) ? (models.allowed_codes as string[]) : [],
      default_code: (models.default_code as string) ?? null,
      fallback_code: (models.fallback_code as string) ?? null,
    },
    budgets: {
      monthly_usd: numOrNull(budgets.monthly_usd),
      daily_usd: numOrNull(budgets.daily_usd),
      token_limit: numOrNull(budgets.token_limit),
      rpm: numOrNull(budgets.rpm),
      rpd: numOrNull(budgets.rpd),
      mtd_cost_usd: num(budgets.mtd_cost_usd),
      mtd_requests: num(budgets.mtd_requests),
      mtd_tokens: num(budgets.mtd_tokens),
      today_cost_usd: num(budgets.today_cost_usd),
      today_requests: num(budgets.today_requests),
    },
  };
}

export interface ModelGateResult {
  ok: boolean;
  reason?: string;
}

/** Is a chat client model id callable under the resolved model set? */
export function isModelAllowed(caps: EffectiveCapabilities, clientModelId: string): ModelGateResult {
  if (caps.models.all_allowed) return { ok: true };
  const code = CHAT_MODEL_CODES[clientModelId] ?? clientModelId;
  if (caps.models.allowed_codes.includes(code)) return { ok: true };
  return {
    ok: false,
    reason: `This model isn't enabled for your account. Ask an administrator to grant access, or pick an allowed model.`,
  };
}

/** Budget / rate-limit gate evaluated against live month-to-date + today usage. */
export function checkBudget(caps: EffectiveCapabilities): ModelGateResult {
  const b = caps.budgets;
  if (b.monthly_usd != null && b.mtd_cost_usd >= b.monthly_usd) {
    return {
      ok: false,
      reason: `Monthly AI budget reached ($${b.mtd_cost_usd.toFixed(2)} of $${b.monthly_usd.toFixed(2)}). Contact an administrator to raise it.`,
    };
  }
  if (b.daily_usd != null && b.today_cost_usd >= b.daily_usd) {
    return {
      ok: false,
      reason: `Daily AI budget reached ($${b.today_cost_usd.toFixed(2)} of $${b.daily_usd.toFixed(2)}). Try again tomorrow or ask an administrator.`,
    };
  }
  if (b.rpd != null && b.today_requests >= b.rpd) {
    return {
      ok: false,
      reason: `Daily request limit reached (${b.today_requests} of ${b.rpd}). Try again tomorrow or ask an administrator.`,
    };
  }
  return { ok: true };
}
