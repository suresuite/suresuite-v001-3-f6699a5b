import type { UserRole } from '@/hooks/useUserRole';
import { canAccessRoute } from '@/lib/permissions';
import { normalizeProjectCreation, projectCreationFromRole, type ProjectCreationRight } from '@/lib/auth/projectCreation';

/**
 * Canonical capability catalog.
 *
 * Two kinds:
 *  - page    → one entry per gateable route in ROUTE_PERMISSIONS
 *  - feature → cross-page abilities (AI, simulation, data editing, export…)
 *
 * The server is the source of truth: `get_my_capabilities` resolves the merged
 * role → org → user set. This file carries the labels the UI needs and a
 * role-based fallback used when that fetch fails.
 *
 * THE CATALOG IS NO LONGER AUTHORED HERE (D33). It used to be a hand-kept copy
 * of rows seeded across nine migrations, and nothing checked that the two
 * agreed — a key in the database and not here is a capability no client can
 * ever be granted; the reverse is a permission screen offering a right that
 * resolves to false. `capabilities.generated.ts` is read out of those
 * migrations by `npm run contract:capabilities`, and `contract:check` fails
 * when it drifts. Add a capability by seeding it in a migration and
 * regenerating; never by editing a list.
 */

export type { CapabilityKind, CapabilityMeta, FeatureKey } from './capabilities.generated';
export { PAGE_CAPABILITIES, FEATURE_CAPABILITIES, FEATURE_KEYS } from './capabilities.generated';

import type { FeatureKey } from './capabilities.generated';
import { PAGE_CAPABILITIES } from './capabilities.generated';

/**
 * Route → capability key aliases. The app home moved from `/` to `/app` when
 * `/` became the public marketing landing, but the seeded capability key (and
 * the `capabilities` table row) is still `/`. Mapping the route here keeps
 * `/app` gated by the existing "Getting Started" grant without a migration.
 * `/` itself is the public landing page and is never gated.
 */
const PATH_ALIASES: Record<string, string> = {
  '/app': '/',
};

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
  /**
   * §4 D303 — may this account create a project, and where would it land. The server's
   * `project_creation_right`; absent from a server older than D303 (the button then reads
   * the account role, as it did before).
   */
  project_creation?: ProjectCreationRight | null;
}

/**
 * Match a pathname to a page capability key (longest prefix wins; `/admin/*`
 * folds into `/admin`). Returns null when no page capability governs the path
 * (e.g. `/help`, `/auth`) — such routes are treated as open.
 */
export function pageKeyForPath(pathname: string): string | null {
  if (pathname in PATH_ALIASES) return PATH_ALIASES[pathname];
  let best: string | null = null;
  for (const { key } of PAGE_CAPABILITIES) {
    const matches =
      key === '/' ? pathname === '/' : pathname === key || pathname.startsWith(key + '/');
    if (matches && (best === null || key.length > best.length)) best = key;
  }
  return best;
}

/**
 * Candidate landing routes, most-preferred first. `/app` is the app home; the
 * rest are the fallbacks used when it isn't granted, ending at `/profile`,
 * which is always on. Without this, a user denied the app home lands on
 * `/forbidden`, whose "return to home" sends them to `/` → `/app` →
 * `/forbidden` — a dead-end cycle with no way into the product.
 */
export const HOME_ROUTE_CANDIDATES: string[] = [
  '/app',
  '/project-manager',
  '/network/firm-level',
  '/network/product-level',
  '/network/process-level',
  '/policies',
  '/simulation-lab',
  '/project-intelligence',
  '/admin',
  '/profile',
];

/** First landing route the resolved capability set actually permits. */
export function homePathFor(caps: EffectiveCapabilities | null): string {
  if (!caps) return '/app';
  for (const path of HOME_ROUTE_CANDIDATES) {
    const key = pageKeyForPath(path);
    if (key === null || (caps.pages[key] ?? false)) return path;
  }
  return '/profile';
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
  // `Record<FeatureKey, boolean>`, not `Record<string, boolean>`, and that is
  // the point of D33: the compiler now refuses a fallback that has forgotten a
  // capability. It had forgotten two — `reports` and `agent_report_builder`
  // shipped in 20260723000001 and never reached this map, so every user with
  // Decision Reports granted silently lost them on any transient RPC failure.
  // `capabilityCatalog.test.ts` asserts the same thing at run time, because
  // this repository has no `tsc` step in CI.
  const features: Record<FeatureKey, boolean> = {
    ai_chat: true,
    // seeded FROM ai_chat by 20260930000010, so the launcher shows wherever
    // the assistant is allowed until an admin switches it off.
    ai_chat_launcher: true,
    project_intelligence: true,
    export: true,
    simulation_lab: powerRole,
    data_editing: powerRole,
    // seeded FROM data_editing by 20260915000005, so these three agree by
    // construction until a call site deliberately moves to one of the new keys.
    data_edit_inputs: powerRole,
    data_edit_policies: powerRole,
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
    agent_network_cartographer: false,
    agent_disruption_sentinel: false,
    chat_history_sync: false,
    project_memory: false,
    // 20260723000001 seeds `reports` from whatever `ai_chat` holds for the role,
    // which is `true` for every role in this fallback; `agent_report_builder` is
    // seeded false like every other per-agent key.
    reports: true,
    agent_report_builder: false,
    // 20261001000002 seeds it super_admin-only: Confidential documentation
    // sections are closed to everyone else until a super admin grants it.
    docs_confidential: isSuper,
  };
  return {
    user_id: null,
    role: r,
    is_super_admin: isSuper,
    pages,
    features,
    models: { all_allowed: true, allowed_codes: [], default_code: null, fallback_code: null },
    budgets: { ...EMPTY_BUDGETS },
    project_creation: projectCreationFromRole(r),
  };
}

/**
 * The server's answer, keyed by the user it was asked for. `caps: null` means
 * the read failed or timed out, so the role fallback governs. Keying it is
 * what keeps an answer from leaking across a sign-out and sign-in, or a switch
 * from one user to another, before the next read lands.
 */
export interface ResolvedCapabilities {
  userId: string;
  caps: EffectiveCapabilities | null;
}

/** A failed REFRESH keeps the last good set; a failed first read falls back to the role. */
export function settleCapabilities(
  prev: ResolvedCapabilities | null,
  userId: string,
  caps: EffectiveCapabilities | null,
): ResolvedCapabilities {
  if (caps) return { userId, caps };
  if (prev && prev.userId === userId && prev.caps) return prev;
  return { userId, caps: null };
}

/**
 * True once this user's set has been read, or the read has failed or timed out.
 * Until then the role fallback is a GUESS — it knows nothing of organization
 * or user overrides — so nothing should gate on it.
 */
export function capabilitiesReady(
  resolved: ResolvedCapabilities | null,
  userId: string | null,
): boolean {
  return userId === null || resolved?.userId === userId;
}

/** The server's set for this user, or null (not read yet, failed, or another user's). */
export function serverCapabilitiesFor(
  resolved: ResolvedCapabilities | null,
  userId: string | null,
): EffectiveCapabilities | null {
  return userId !== null && resolved?.userId === userId ? resolved.caps : null;
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
    project_creation: normalizeProjectCreation(o.project_creation),
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
