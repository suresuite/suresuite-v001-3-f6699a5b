// api: the public, versioned HTTP gateway (/v1) — API Phases 0-2 / G15.
//
// Design: docs/design/public-api-and-access-control.md. Every request runs the
// same pipeline (§4): CORS → authenticate (API key, §5) → resolve principal →
// authorize (scope + tenancy, §6) → rate-limit + compute quotas (§7) →
// validate (Zod, §7.4) → delegate to the EXACT operations the UI uses →
// audit (§11). The gateway adds identity, authorization, quotas, and audit —
// it never adds a privileged path the UI does not already have (§0 law).
//
// Security posture (§10):
// - Identity comes ONLY from the verified `Authorization: Bearer sk_…` key;
//   nothing in the body is trusted about who is calling. The browser app's
//   set_current_user_context path is unreachable from here.
// - Auth / authorization / quota failures FAIL CLOSED (401/403/404/429/503).
//   Only the internal data-completeness gate keeps its own block/warn
//   semantics (and records gate_skipped) — that is not a security control.
// - Tenancy is checked at this edge AND re-checked in the DB
//   (api_can_access_project, SECURITY DEFINER, service-role-only) so a
//   gateway bug is not automatically a data-crossing bug (§6.3, R1).
// - Cross-org lookups return 404 (not 403): no existence oracle on project
//   or run ids.
// - Secrets: constant-time hash comparison, hashing even on prefix miss
//   (no timing oracle); `Authorization` never logged; 401 storms are
//   throttled by IP.

import { createClient } from "npm:@supabase/supabase-js@2";
import { z } from "npm:zod@3";
import { cleanEnv } from "../_shared/env.ts";
import registry from "../_shared/registry.generated.json" with { type: "json" };
import {
  dispatchExperimentCancel,
  dispatchExperimentRun,
  enqueueEnvelope,
  ReuseAvailable,
  ValidationRejection,
} from "../_shared/dispatch.ts";

const SUPABASE_URL = cleanEnv("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = cleanEnv("SUPABASE_SERVICE_ROLE_KEY")!;
const UPSTASH_URL = cleanEnv("UPSTASH_REDIS_REST_URL")!;
const UPSTASH_TOKEN = cleanEnv("UPSTASH_REDIS_REST_TOKEN")!;

// The gateway is the only API-path holder of the service role (§3.2, R1).
const svc = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// §10.1: credentialed API traffic must not pair `*` with credentials — and it
// doesn't: Access-Control-Allow-Credentials is never set, so browsers never
// attach ambient credentials (cookies). The API key is an explicit header a
// cross-site attacker cannot forge onto a victim's request. Server-to-server
// callers ignore CORS entirely.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, content-type, idempotency-key, x-request-id",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Expose-Headers":
    "x-request-id, x-ratelimit-limit, x-ratelimit-remaining, x-ratelimit-reset, retry-after, idempotency-replayed",
};

const MAX_BODY_BYTES = 512 * 1024; // §7.4 body cap (no bulk endpoints yet)
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000; // §7.3

// Default limits per key env; an api_rate_limits row (scope key > org)
// overrides them without a deploy (§7.1-7.2, tier values = Q4 product knob).
const DEFAULT_LIMITS = {
  live: { rpm: 120, rpd: 5000, max_concurrent_runs: 5 },
  test: { rpm: 30, rpd: 300, max_concurrent_runs: 1 },
} as const;
const IP_401_LIMIT_PER_MIN = 30; // §10.1 key-guessing throttle

// ── Error envelope ───────────────────────────────────────────────────────────

class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
    public extraHeaders?: Record<string, string>,
  ) {
    super(message);
  }
}

const notFoundProject = () =>
  new ApiError(404, "project_not_found", "project not found");

// ── Crypto helpers ───────────────────────────────────────────────────────────

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Constant-time comparison of equal-length hex strings. */
function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ── Upstash (rate limiting + worker queue) ───────────────────────────────────

async function upstash(args: (string | number)[]): Promise<unknown> {
  const res = await fetch(UPSTASH_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${UPSTASH_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(args),
  });
  if (!res.ok) throw new Error(`upstash ${res.status}: ${await res.text()}`);
  return res.json();
}

async function upstashPipeline(cmds: (string | number)[][]): Promise<unknown[]> {
  const res = await fetch(`${UPSTASH_URL}/pipeline`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${UPSTASH_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(cmds),
  });
  if (!res.ok) throw new Error(`upstash pipeline ${res.status}: ${await res.text()}`);
  const rows = (await res.json()) as Array<{ result?: unknown; error?: string }>;
  return rows.map((r) => {
    if (r.error) throw new Error(`upstash pipeline: ${r.error}`);
    return r.result;
  });
}

// ── Step 2-3: authenticate → principal (§5.3) ────────────────────────────────

interface Principal {
  keyId: string;
  keyPrefix: string;
  orgId: string;
  scopes: string[];
  projectIds: string[] | null;
  env: "live" | "test";
}

const KEY_RE = /^sk_(live|test)_([0-9a-f]{8})_([0-9a-f]{16,128})$/;

async function throttle401(ip: string): Promise<void> {
  // Best-effort: the throttle blunts key-guessing; its own failure must not
  // turn a 401 into a 500.
  try {
    const minute = Math.floor(Date.now() / 60_000);
    const key = `api:401:${ip}:${minute}`;
    const [count] = await upstashPipeline([["INCR", key], ["EXPIRE", key, 120]]);
    if (Number(count) > IP_401_LIMIT_PER_MIN) {
      throw new ApiError(429, "too_many_failed_auths",
        "too many failed authentication attempts from this address", undefined,
        { "Retry-After": "60" });
    }
  } catch (e) {
    if (e instanceof ApiError) throw e;
    console.error("401 throttle unavailable", e);
  }
}

async function authenticate(req: Request, ip: string): Promise<Principal> {
  const header = req.headers.get("Authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  const m = token.match(KEY_RE);
  const fail = async (code: string, message: string): Promise<never> => {
    await throttle401(ip);
    throw new ApiError(401, code, message);
  };
  if (!m) return fail("invalid_key", "missing or malformed API key (expected `Authorization: Bearer sk_…`)");

  const [, env, prefix, secret] = m;
  // Hash before any lookup-dependent branch: a prefix miss and a hash
  // mismatch cost the same (§5.3 anti-timing-oracle).
  const presentedHash = await sha256Hex(secret);

  const { data: row, error } = await svc
    .from("api_keys")
    .select("id,key_prefix,secret_hash,org_id,scopes,project_ids,env,status,expires_at,revoked_at")
    .eq("key_prefix", prefix)
    .maybeSingle();
  if (error) throw new ApiError(503, "auth_unavailable", "authentication backend unavailable"); // fail closed
  if (!row || !timingSafeEqualHex(presentedHash, String(row.secret_hash)) || row.env !== env) {
    return fail("invalid_key", "invalid API key");
  }
  if (row.status !== "active" || row.revoked_at) return fail("revoked_key", "this API key has been revoked");
  if (row.expires_at && new Date(String(row.expires_at)).getTime() < Date.now()) {
    return fail("expired_key", "this API key has expired");
  }

  const { data: org } = await svc
    .from("organizations")
    .select("id,status")
    .eq("id", row.org_id)
    .maybeSingle();
  if (!org || org.status !== "active") return fail("org_suspended", "the key's organization is not active");

  // §5.3 step 4: stamp last_used_at asynchronously; never block the request.
  // (PostgREST builders resolve with {error} rather than rejecting.)
  const touched = svc
    .from("api_keys")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", row.id)
    .then(({ error: e }) => {
      if (e) console.error("last_used_at stamp failed", e);
    });
  // deno-lint-ignore no-explicit-any
  (globalThis as any).EdgeRuntime?.waitUntil?.(touched);

  return {
    keyId: String(row.id),
    keyPrefix: String(row.key_prefix),
    orgId: String(row.org_id),
    scopes: (row.scopes as string[]) ?? [],
    projectIds: (row.project_ids as string[] | null) ?? null,
    env: env as "live" | "test",
  };
}

// ── Step 4: authorize (§6) ───────────────────────────────────────────────────

function requireScope(p: Principal, scope: string): void {
  if (!p.scopes.includes(scope)) {
    throw new ApiError(403, "missing_scope", `this key does not have the ${scope} scope`);
  }
}

/** Edge tenancy check + DB re-check (§6.2-6.3). Cross-org ⇒ 404, no oracle. */
async function authorizeProject(p: Principal, projectId: string): Promise<void> {
  if (p.projectIds && !p.projectIds.includes(projectId)) throw notFoundProject();
  const { data, error } = await svc.rpc("api_can_access_project", {
    p_org_id: p.orgId,
    p_project_id: projectId,
  });
  if (error) throw new ApiError(503, "authz_unavailable", "authorization backend unavailable"); // fail closed
  if (data !== true) throw notFoundProject();
}

// ── Step 5: rate limits + quotas (§7) ────────────────────────────────────────

interface Limits {
  rpm: number;
  rpd: number;
  max_concurrent_runs: number;
  max_replications: number | null;
}

async function loadLimits(p: Principal): Promise<Limits> {
  const defaults = DEFAULT_LIMITS[p.env];
  let rows: Array<Record<string, unknown>> = [];
  try {
    const { data } = await svc
      .from("api_rate_limits")
      .select("scope,scope_id,rpm,rpd,max_concurrent_runs,max_replications")
      .in("scope_id", [p.keyId, p.orgId]);
    rows = (data ?? []) as Array<Record<string, unknown>>;
  } catch (e) {
    console.error("api_rate_limits read failed (defaults apply)", e);
  }
  const keyRow = rows.find((r) => r.scope === "key" && r.scope_id === p.keyId);
  const orgRow = rows.find((r) => r.scope === "org" && r.scope_id === p.orgId);
  const pick = (field: keyof typeof defaults) =>
    Number(keyRow?.[field] ?? orgRow?.[field] ?? defaults[field]);
  return {
    rpm: pick("rpm"),
    rpd: pick("rpd"),
    max_concurrent_runs: pick("max_concurrent_runs"),
    max_replications: (keyRow?.max_replications ?? orgRow?.max_replications) != null
      ? Number(keyRow?.max_replications ?? orgRow?.max_replications)
      : null,
  };
}

async function rateLimit(p: Principal, limits: Limits): Promise<Record<string, string>> {
  const now = Date.now();
  const minute = Math.floor(now / 60_000);
  const day = new Date(now).toISOString().slice(0, 10);
  const mKey = `api:rl:${p.keyId}:m:${minute}`;
  const dKey = `api:rl:${p.keyId}:d:${day}`;
  let mCount: number, dCount: number;
  try {
    const [m, , d] = await upstashPipeline([
      ["INCR", mKey],
      ["EXPIRE", mKey, 120],
      ["INCR", dKey],
      ["EXPIRE", dKey, 90_000],
    ]);
    mCount = Number(m);
    dCount = Number(d);
  } catch (e) {
    // Quota enforcement fails CLOSED (§3.4): an unavailable limiter must not
    // become unmetered compute.
    console.error("rate limiter unavailable", e);
    throw new ApiError(503, "rate_limiter_unavailable", "rate limiter unavailable, request denied");
  }
  const resetSec = 60 - Math.floor((now % 60_000) / 1000);
  const headers = {
    "X-RateLimit-Limit": String(limits.rpm),
    "X-RateLimit-Remaining": String(Math.max(0, limits.rpm - mCount)),
    "X-RateLimit-Reset": String(resetSec),
  };
  if (mCount > limits.rpm) {
    throw new ApiError(429, "rate_limited", "per-minute rate limit exceeded", undefined, {
      ...headers,
      "Retry-After": String(resetSec),
    });
  }
  if (dCount > limits.rpd) {
    throw new ApiError(429, "daily_quota_exceeded", "daily request quota exceeded", undefined, {
      ...headers,
      "Retry-After": "3600",
    });
  }
  return headers;
}

// ── Request context threaded through handlers ───────────────────────────────

interface Ctx {
  principal: Principal;
  limits: Limits;
  params: string[];
  url: URL;
  req: Request;
  body: unknown;
  /** set by handlers for the audit row */
  auditProjectId?: string;
}

interface HandlerResult {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
}

type Handler = (ctx: Ctx) => Promise<HandlerResult>;

interface Route {
  method: string;
  pattern: RegExp;
  scope: string;
  handler: Handler;
}

const UUID = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";

// ── Shared helpers for handlers ──────────────────────────────────────────────

function parsePage(url: URL): { limit: number; cursor: string | null } {
  const rawLimit = Number(url.searchParams.get("limit") ?? 20);
  const limit = Math.max(1, Math.min(100, Number.isFinite(rawLimit) ? Math.floor(rawLimit) : 20));
  return { limit, cursor: url.searchParams.get("cursor") };
}

function parseBody<T>(schema: z.ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body ?? {});
  if (!parsed.success) {
    throw new ApiError(400, "invalid_request", "request body failed validation",
      parsed.error.flatten());
  }
  return parsed.data;
}

/** Load a run row and tenancy-check its project. 404 on any miss (no oracle). */
async function loadAuthorizedRun(ctx: Ctx, runId: string): Promise<Record<string, unknown>> {
  const { data, error } = await svc
    .from("simulation_runs")
    .select(
      "id,scenario_id,project_id,status,started_at,ended_at,created_at,updated_at," +
        "rep_count_target,rep_count_done,aggregate_kpis,ci_half_widths,warmup_detected_at," +
        "policy_version_id,policy_hash,dataset_version_id,graph_hash,scenario_hash," +
        "model_validation_id,gate_skipped,error_message,code_version",
    )
    .eq("id", runId)
    .maybeSingle();
  if (error) throw new ApiError(503, "read_failed", "run read failed");
  const run = data as unknown as Record<string, unknown> | null;
  if (!run) throw new ApiError(404, "run_not_found", "run not found");
  try {
    await authorizeProject(ctx.principal, String(run.project_id));
  } catch (e) {
    // Cross-tenant run ids read as nonexistent (no oracle); backend
    // unavailability keeps its fail-closed 503.
    if (e instanceof ApiError && e.status === 404) {
      throw new ApiError(404, "run_not_found", "run not found");
    }
    throw e;
  }
  ctx.auditProjectId = String(run.project_id);
  return run;
}

// ── Request schemas (§7.4: strict, unknown fields rejected) ──────────────────

const RunCreateSchema = z.object({
  scenario_id: z.string().uuid(),
  policy_version_id: z.string().uuid(),
  acknowledge_warnings: z.boolean().optional().default(false),
  /** Recompute even when identical completed results exist (§9.2 reuse check
   *  answers 409 reuse_available otherwise — reuse is always a caller choice). */
  force_rerun: z.boolean().optional().default(false),
}).strict();

const AddRepsSchema = z.object({ n: z.number().int().min(1).max(100) }).strict();

const LabelSchema = z.object({ label: z.string().max(200).optional() }).strict();

const DisruptionSchema = z.object({
  target: z.string().max(200),
  target_type: z.string().max(50).optional(),
  start_day: z.number().int().min(0),
  duration_days: z.number().int().min(1),
  magnitude_pct: z.number().min(0).max(100),
}).strict();

const ScenarioCreateSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional().default(""),
  horizon_days: z.number().int().min(1).max(3650).optional().default(90),
  warmup_days: z.number().int().min(0).max(365).optional().default(14),
  replications: z.number().int().min(1).max(200).optional().default(10),
  seed: z.number().int().optional().default(42),
  crn: z.boolean().optional().default(true),
  disruption_schedule: z.array(DisruptionSchema).max(50).optional().default([]),
  recovery_overrides: z.record(z.unknown()).optional().default({}),
  primary_kpi: z.string().max(50).optional().default("fill_rate"),
}).strict();

// Policy families come from the policy_defaults schema (the same seven the
// snapshot/restore RPCs move). Param-level validation generated from the
// registry export lands with the OpenAPI spec (R2); family membership and
// object shape are enforced today.
const POLICY_FAMILIES = [
  "sourcing", "inventory", "transport", "fulfillment", "production", "recovery", "demand",
] as const;

const PoliciesPutSchema = z.object({
  defaults: z.record(z.record(z.unknown())).optional().default({}),
  fulfillment_strategy: z.string().max(100).optional(),
  overrides: z.array(
    z.object({
      scope: z.string().max(50),
      target_key: z.string().max(200),
      family: z.enum(POLICY_FAMILIES),
      patch: z.record(z.unknown()),
    }).strict(),
  ).max(500).optional(),
}).strict().superRefine((val, issueCtx) => {
  for (const family of Object.keys(val.defaults)) {
    if (!(POLICY_FAMILIES as readonly string[]).includes(family)) {
      issueCtx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["defaults", family],
        message: `unknown policy family (expected one of ${POLICY_FAMILIES.join(", ")})`,
      });
    }
  }
});

// ── Handlers (§8: each delegates to an operation the UI already uses) ────────

const PROJECT_FIELDS = "id,name,plant_name,supply_chain_model,organization,organization_id,created_at,updated_at";

const listProjects: Handler = async (ctx) => {
  const { limit, cursor } = parsePage(ctx.url);
  let q = svc
    .from("projects")
    .select(PROJECT_FIELDS)
    .eq("organization_id", ctx.principal.orgId)
    .order("created_at", { ascending: false })
    .limit(limit + 1);
  if (cursor) q = q.lt("created_at", cursor);
  if (ctx.principal.projectIds) q = q.in("id", ctx.principal.projectIds);
  const { data, error } = await q;
  if (error) throw new ApiError(503, "read_failed", "project list failed");
  const rows = data ?? [];
  const page = rows.slice(0, limit);
  return {
    status: 200,
    body: {
      data: page,
      next_cursor: rows.length > limit ? page[page.length - 1]?.created_at ?? null : null,
    },
  };
};

const getProject: Handler = async (ctx) => {
  const projectId = ctx.params[0];
  await authorizeProject(ctx.principal, projectId);
  ctx.auditProjectId = projectId;
  const { data, error } = await svc
    .from("projects")
    .select(PROJECT_FIELDS)
    .eq("id", projectId)
    .maybeSingle();
  if (error || !data) throw notFoundProject();
  return { status: 200, body: data };
};

const freezeDataset: Handler = async (ctx) => {
  const projectId = ctx.params[0];
  await authorizeProject(ctx.principal, projectId);
  ctx.auditProjectId = projectId;
  const body = parseBody(LabelSchema, ctx.body);
  const { data: dsId, error } = await svc.rpc("snapshot_dataset", {
    p_project_id: projectId,
    p_label: body.label ?? null,
    p_user_id: null,
    p_user_email: `api-key:${ctx.principal.keyPrefix}`,
  });
  if (error || !dsId) throw new ApiError(500, "snapshot_failed", "dataset snapshot failed");
  const { data: dv } = await svc
    .from("dataset_versions")
    .select("id,label,graph_hash,created_at")
    .eq("id", dsId)
    .maybeSingle();
  return { status: 201, body: dv ?? { id: dsId } };
};

const listDatasetVersions: Handler = async (ctx) => {
  const projectId = ctx.params[0];
  await authorizeProject(ctx.principal, projectId);
  ctx.auditProjectId = projectId;
  const { data, error } = await svc.rpc("list_dataset_versions", { p_project_id: projectId });
  if (error) throw new ApiError(503, "read_failed", "dataset versions read failed");
  return { status: 200, body: { data: data ?? [] } };
};

const getPolicyCatalog: Handler = async (ctx) => {
  const projectId = ctx.params[0];
  await authorizeProject(ctx.principal, projectId);
  ctx.auditProjectId = projectId;
  // The honest catalog (A3): the registry export IS the contract — same
  // artifact the forms and the validation gate consume (§6.2 doctrine).
  return {
    status: 200,
    body: {
      engine_version: (registry as Record<string, unknown>).engine_version,
      policies: (registry as Record<string, unknown>).policies,
      kpis: (registry as Record<string, unknown>).kpis,
      base_data_requirements: (registry as Record<string, unknown>).base_data_requirements,
    },
  };
};

const getPolicies: Handler = async (ctx) => {
  const projectId = ctx.params[0];
  await authorizeProject(ctx.principal, projectId);
  ctx.auditProjectId = projectId;
  const [{ data: defaults, error: dErr }, { data: overrides, error: oErr }] = await Promise.all([
    svc.from("policy_defaults").select("*").eq("project_id", projectId).maybeSingle(),
    svc.from("policy_overrides").select("scope,target_key,family,patch,updated_at").eq("project_id", projectId),
  ]);
  if (dErr || oErr) throw new ApiError(503, "read_failed", "policy read failed");
  return { status: 200, body: { defaults: defaults ?? null, overrides: overrides ?? [] } };
};

const putPolicies: Handler = async (ctx) => {
  const projectId = ctx.params[0];
  await authorizeProject(ctx.principal, projectId);
  ctx.auditProjectId = projectId;
  const body = parseBody(PoliciesPutSchema, ctx.body);
  // Same write RPCs the /policies page uses (20260609000025) — no forked path.
  let strategySent = false;
  for (const [family, value] of Object.entries(body.defaults ?? {})) {
    const { error } = await svc.rpc("save_policy_defaults", {
      p_project_id: projectId,
      p_family: family,
      p_value: value,
      p_strategy: !strategySent ? body.fulfillment_strategy ?? null : null,
    });
    if (error) throw new ApiError(500, "write_failed", `saving ${family} defaults failed`);
    strategySent = true;
  }
  if (!strategySent && body.fulfillment_strategy) {
    // Strategy-only update: reuse the RPC with an untouched family payload.
    const { data: existing } = await svc
      .from("policy_defaults").select("fulfillment").eq("project_id", projectId).maybeSingle();
    const { error } = await svc.rpc("save_policy_defaults", {
      p_project_id: projectId,
      p_family: "fulfillment",
      p_value: existing?.fulfillment ?? {},
      p_strategy: body.fulfillment_strategy,
    });
    if (error) throw new ApiError(500, "write_failed", "saving fulfillment strategy failed");
  }
  if (body.overrides?.length) {
    const { error } = await svc.rpc("bulk_upsert_policy_overrides", {
      p_project_id: projectId,
      p_rows: body.overrides,
    });
    if (error) throw new ApiError(500, "write_failed", "saving policy overrides failed");
  }
  return { status: 200, body: { ok: true } };
};

const snapshotPolicyVersion: Handler = async (ctx) => {
  const projectId = ctx.params[0];
  await authorizeProject(ctx.principal, projectId);
  ctx.auditProjectId = projectId;
  const body = parseBody(LabelSchema, ctx.body);
  const { data: versionId, error } = await svc.rpc("snapshot_policy", {
    p_project_id: projectId,
    p_label: body.label ?? null,
    p_user_id: null,
    p_user_email: `api-key:${ctx.principal.keyPrefix}`,
    p_user_name: null,
    p_parent_version_id: null,
  });
  if (error || !versionId) throw new ApiError(500, "snapshot_failed", "policy snapshot failed");
  const { data: row } = await svc
    .from("policy_versions")
    .select("id,label,policy_hash,created_at")
    .eq("id", versionId)
    .maybeSingle();
  return { status: 201, body: row ?? { id: versionId } };
};

const listPolicyVersions: Handler = async (ctx) => {
  const projectId = ctx.params[0];
  await authorizeProject(ctx.principal, projectId);
  ctx.auditProjectId = projectId;
  const { data, error } = await svc.rpc("list_policy_versions", { p_project_id: projectId });
  if (error) throw new ApiError(503, "read_failed", "policy versions read failed");
  return { status: 200, body: { data: data ?? [] } };
};

const listScenarios: Handler = async (ctx) => {
  const projectId = ctx.params[0];
  await authorizeProject(ctx.principal, projectId);
  ctx.auditProjectId = projectId;
  const { limit, cursor } = parsePage(ctx.url);
  let q = svc
    .from("scenarios")
    .select("id,name,description,horizon_days,warmup_days,replications,seed,crn,disruption_schedule,recovery_overrides,primary_kpi,created_at,updated_at")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(limit + 1);
  if (cursor) q = q.lt("created_at", cursor);
  const { data, error } = await q;
  if (error) throw new ApiError(503, "read_failed", "scenario list failed");
  const rows = data ?? [];
  const page = rows.slice(0, limit);
  return {
    status: 200,
    body: {
      data: page,
      next_cursor: rows.length > limit ? page[page.length - 1]?.created_at ?? null : null,
    },
  };
};

const createScenario: Handler = async (ctx) => {
  const projectId = ctx.params[0];
  await authorizeProject(ctx.principal, projectId);
  ctx.auditProjectId = projectId;
  const body = parseBody(ScenarioCreateSchema, ctx.body);
  const { data, error } = await svc
    .from("scenarios")
    .insert({ project_id: projectId, ...body })
    .select("id,name,horizon_days,replications,seed,created_at")
    .single();
  if (error || !data) throw new ApiError(500, "write_failed", "scenario create failed");
  return { status: 201, body: data };
};

const createRun: Handler = async (ctx) => {
  const projectId = ctx.params[0];
  await authorizeProject(ctx.principal, projectId);
  ctx.auditProjectId = projectId;
  const body = parseBody(RunCreateSchema, ctx.body);
  const p = ctx.principal;

  // §7.3 idempotent replay: a retried submit returns the SAME run.
  const idemKey = ctx.req.headers.get("Idempotency-Key")?.slice(0, 200) ?? null;
  if (idemKey) {
    const { data: existing } = await svc
      .from("api_idempotency")
      .select("run_id,created_at")
      .eq("api_key_id", p.keyId)
      .eq("idempotency_key", idemKey)
      .maybeSingle();
    if (
      existing?.run_id &&
      Date.now() - new Date(String(existing.created_at)).getTime() < IDEMPOTENCY_TTL_MS
    ) {
      const { data: run } = await svc
        .from("simulation_runs")
        .select("id,status,policy_hash,graph_hash")
        .eq("id", existing.run_id)
        .maybeSingle();
      return {
        status: 202,
        body: {
          run_id: existing.run_id,
          status: run?.status ?? "queued",
          policy_hash: run?.policy_hash ?? null,
          graph_hash: run?.graph_hash ?? null,
        },
        headers: { "Idempotency-Replayed": "true" },
      };
    }
  }

  // §7.2 compute quota — the real DoS guard: cap concurrent queued/running
  // runs per org before any compute is enqueued. Fails closed.
  const { data: active, error: activeErr } = await svc.rpc("api_count_active_runs", {
    p_org_id: p.orgId,
  });
  if (activeErr) throw new ApiError(503, "quota_unavailable", "compute quota check unavailable");
  if (Number(active) >= ctx.limits.max_concurrent_runs) {
    throw new ApiError(429, "concurrent_runs_exceeded",
      `organization already has ${active} queued/running runs (limit ${ctx.limits.max_concurrent_runs})`,
      undefined, { "Retry-After": "60" });
  }
  // Optional per-org replication ceiling under the global clamp of 200 (§7.2).
  if (ctx.limits.max_replications != null) {
    const { data: scenario } = await svc
      .from("scenarios")
      .select("replications,project_id")
      .eq("id", body.scenario_id)
      .eq("project_id", projectId) // no reads (or error details) across projects
      .maybeSingle();
    if (scenario && Number(scenario.replications) > ctx.limits.max_replications) {
      throw new ApiError(403, "replications_exceeded",
        `scenario requests ${scenario.replications} replications (limit ${ctx.limits.max_replications})`);
    }
  }

  let result: { run_id: string };
  try {
    // The reader is the service client: this request's tenancy was already
    // verified at the edge and in the DB; the shared dispatcher re-checks
    // scenario/version ↔ project consistency itself.
    result = await dispatchExperimentRun({ reader: svc, svc, upstash }, {
      project_id: projectId,
      scenario_id: body.scenario_id,
      kind: "experiment.run",
      payload: {
        policy_version_id: body.policy_version_id,
        acknowledge_warnings: body.acknowledge_warnings,
        force_rerun: body.force_rerun,
      },
    }, null);
  } catch (e) {
    if (e instanceof ValidationRejection) {
      throw new ApiError(422, "validation_failed",
        "run rejected by the required-data manifest", {
          validation: e.gate.status,
          ack_required: e.gate.status === "ack_required",
          findings: e.gate.findings,
        });
    }
    if (e instanceof ReuseAvailable) {
      // §9.2 read-path slice: identical completed results exist. The caller
      // reads the stored run, or retries with force_rerun=true to recompute.
      throw new ApiError(409, "reuse_available",
        "identical completed run exists — read it or retry with force_rerun=true",
        { reuse_candidate: e.candidate });
    }
    throw new ApiError(500, "dispatch_failed", String((e as Error)?.message ?? e).slice(0, 300));
  }

  if (idemKey) {
    const { error: idemErr } = await svc
      .from("api_idempotency")
      .upsert({ api_key_id: p.keyId, idempotency_key: idemKey, run_id: result.run_id });
    if (idemErr) console.error("idempotency store failed", idemErr);
  }

  const { data: run } = await svc
    .from("simulation_runs")
    .select("status,policy_hash,graph_hash,gate_skipped")
    .eq("id", result.run_id)
    .maybeSingle();
  return {
    status: 202,
    body: {
      run_id: result.run_id,
      status: run?.status ?? "queued",
      policy_hash: run?.policy_hash ?? null,
      graph_hash: run?.graph_hash ?? null,
      gate_skipped: run?.gate_skipped ?? false,
    },
  };
};

const getRun: Handler = async (ctx) => {
  const run = await loadAuthorizedRun(ctx, ctx.params[0]);
  return { status: 200, body: run };
};

const getRunReplications: Handler = async (ctx) => {
  const run = await loadAuthorizedRun(ctx, ctx.params[0]);
  const { limit, cursor } = parsePage(ctx.url);
  const includeSeries = ctx.url.searchParams.get("include") === "time_series";
  const fields = "rep_index,seed_used,status,kpis,warmup_at,started_at,ended_at" +
    (includeSeries ? ",time_series" : "");
  let q = svc
    .from("run_replications")
    .select(fields)
    .eq("run_id", run.id)
    .order("rep_index", { ascending: true })
    .limit(limit + 1);
  if (cursor) {
    const afterIndex = Number(cursor);
    if (!Number.isFinite(afterIndex)) {
      throw new ApiError(400, "invalid_cursor", "cursor must be a replication index");
    }
    q = q.gt("rep_index", afterIndex);
  }
  const { data, error } = await q;
  if (error) throw new ApiError(503, "read_failed", "replications read failed");
  const rows = (data ?? []) as unknown as Array<Record<string, unknown>>;
  const page = rows.slice(0, limit);
  return {
    status: 200,
    body: {
      data: page,
      next_cursor: rows.length > limit ? String(page[page.length - 1]?.rep_index ?? "") : null,
    },
  };
};

const cancelRun: Handler = async (ctx) => {
  const run = await loadAuthorizedRun(ctx, ctx.params[0]);
  await dispatchExperimentCancel({ reader: svc, svc, upstash }, {
    project_id: String(run.project_id),
    kind: "experiment.cancel",
    payload: { run_id: String(run.id) },
  });
  return { status: 202, body: { run_id: run.id, status: "cancelled" } };
};

const addRunReps: Handler = async (ctx) => {
  const run = await loadAuthorizedRun(ctx, ctx.params[0]);
  const body = parseBody(AddRepsSchema, ctx.body);
  await enqueueEnvelope({ upstash }, String(run.project_id), {
    project_id: run.project_id,
    kind: "experiment.add_reps",
    payload: { run_id: run.id, n: body.n },
    user_id: null,
    server_ts: Date.now(),
  });
  return { status: 202, body: { run_id: run.id, added: body.n } };
};

const getRunValidation: Handler = async (ctx) => {
  const run = await loadAuthorizedRun(ctx, ctx.params[0]);
  if (!run.model_validation_id) {
    // §9.5 labels, not gates: an unvalidated run still reports honestly.
    return {
      status: 200,
      body: { status: "unvalidated", model_validation: null, gate_skipped: run.gate_skipped ?? false },
    };
  }
  const { data: card, error } = await svc
    .from("model_validations")
    .select("id,verdict,basis,status,policy_hash,graph_hash,scenario_hash,adopted_warmup_days,recommended_replications,validation_tests,validated_at,author_email")
    .eq("id", run.model_validation_id)
    .maybeSingle();
  if (error) throw new ApiError(503, "read_failed", "validation read failed");
  const fresh = card && card.status === "active" &&
    card.policy_hash === run.policy_hash &&
    card.graph_hash === run.graph_hash &&
    card.scenario_hash === run.scenario_hash;
  return {
    status: 200,
    body: {
      status: !card ? "unvalidated" : fresh ? "validated" : "stale",
      model_validation: card ?? null,
      gate_skipped: run.gate_skipped ?? false,
    },
  };
};

const listKeys: Handler = async (ctx) => {
  // secret_hash is never selected on any read path (§5.2).
  const { data, error } = await svc
    .from("api_keys")
    .select("id,key_prefix,name,scopes,project_ids,env,status,expires_at,last_used_at,created_at")
    .eq("org_id", ctx.principal.orgId)
    .order("created_at", { ascending: false });
  if (error) throw new ApiError(503, "read_failed", "key list failed");
  return { status: 200, body: { data: data ?? [] } };
};

const revokeKey: Handler = async (ctx) => {
  const keyId = ctx.params[0];
  const { data: key } = await svc
    .from("api_keys")
    .select("id,org_id,status")
    .eq("id", keyId)
    .maybeSingle();
  if (!key || key.org_id !== ctx.principal.orgId) {
    throw new ApiError(404, "key_not_found", "key not found");
  }
  const { error } = await svc
    .from("api_keys")
    .update({ status: "revoked", revoked_at: new Date().toISOString() })
    .eq("id", keyId)
    .eq("org_id", ctx.principal.orgId);
  if (error) throw new ApiError(500, "write_failed", "key revoke failed");
  const { error: auditErr } = await svc.from("admin_audit_logs").insert({
    action: "api_key.revoke",
    target_type: "api_keys",
    target_id: keyId,
    before: { status: key.status },
    after: { status: "revoked", via: "api", actor_key: ctx.principal.keyId },
  });
  if (auditErr) console.error("key revoke audit failed", auditErr);
  return { status: 200, body: { id: keyId, status: "revoked" } };
};

// Key minting stays in the key-management UI (show-once ceremony + human
// authorization); the API surface for it is deferred with OAuth tokens (§5.5).

// ── Route table (§8) ─────────────────────────────────────────────────────────

const routes: Route[] = [
  { method: "GET", pattern: new RegExp(`^/projects$`), scope: "read:data", handler: listProjects },
  { method: "GET", pattern: new RegExp(`^/projects/(${UUID})$`), scope: "read:data", handler: getProject },
  { method: "POST", pattern: new RegExp(`^/projects/(${UUID})/datasets:freeze$`), scope: "write:data", handler: freezeDataset },
  { method: "GET", pattern: new RegExp(`^/projects/(${UUID})/dataset-versions$`), scope: "read:data", handler: listDatasetVersions },
  { method: "GET", pattern: new RegExp(`^/projects/(${UUID})/policy-catalog$`), scope: "read:policies", handler: getPolicyCatalog },
  { method: "GET", pattern: new RegExp(`^/projects/(${UUID})/policies$`), scope: "read:policies", handler: getPolicies },
  { method: "PUT", pattern: new RegExp(`^/projects/(${UUID})/policies$`), scope: "write:policies", handler: putPolicies },
  { method: "POST", pattern: new RegExp(`^/projects/(${UUID})/policy-versions$`), scope: "write:policies", handler: snapshotPolicyVersion },
  { method: "GET", pattern: new RegExp(`^/projects/(${UUID})/policy-versions$`), scope: "read:policies", handler: listPolicyVersions },
  { method: "GET", pattern: new RegExp(`^/projects/(${UUID})/scenarios$`), scope: "read:runs", handler: listScenarios },
  { method: "POST", pattern: new RegExp(`^/projects/(${UUID})/scenarios$`), scope: "write:runs", handler: createScenario },
  { method: "POST", pattern: new RegExp(`^/projects/(${UUID})/runs$`), scope: "write:runs", handler: createRun },
  { method: "GET", pattern: new RegExp(`^/runs/(${UUID})$`), scope: "read:runs", handler: getRun },
  { method: "GET", pattern: new RegExp(`^/runs/(${UUID})/replications$`), scope: "read:runs", handler: getRunReplications },
  { method: "POST", pattern: new RegExp(`^/runs/(${UUID}):cancel$`), scope: "write:runs", handler: cancelRun },
  { method: "POST", pattern: new RegExp(`^/runs/(${UUID}):add-reps$`), scope: "write:runs", handler: addRunReps },
  { method: "GET", pattern: new RegExp(`^/runs/(${UUID})/validation$`), scope: "read:runs", handler: getRunValidation },
  { method: "GET", pattern: new RegExp(`^/keys$`), scope: "admin:keys", handler: listKeys },
  { method: "POST", pattern: new RegExp(`^/keys/(${UUID}):revoke$`), scope: "admin:keys", handler: revokeKey },
];

// ── Step 8: audit + respond (§11) ────────────────────────────────────────────

function logRequest(row: {
  api_key_id: string | null;
  org_id: string | null;
  method: string;
  route: string;
  status: number;
  project_id: string | null;
  scope_used: string | null;
  latency_ms: number;
  bytes_out: number;
  request_id: string;
  error_code: string | null;
  ip: string | null;
}): void {
  const p = svc.from("api_request_logs").insert(row)
    .then(({ error: e }) => {
      if (e) console.error("api_request_logs insert failed", e);
    });
  // deno-lint-ignore no-explicit-any
  (globalThis as any).EdgeRuntime?.waitUntil?.(p);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const started = Date.now();
  const requestId = req.headers.get("X-Request-Id")?.slice(0, 100) ?? crypto.randomUUID();
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const url = new URL(req.url);
  // Function is served at /<name>; routes live under /<name>/v1/**.
  const vIdx = url.pathname.indexOf("/v1");
  const subPath = vIdx >= 0 ? url.pathname.slice(vIdx + 3) || "/" : url.pathname;

  let principal: Principal | null = null;
  let scopeUsed: string | null = null;
  let projectForAudit: string | null = null;
  let rlHeaders: Record<string, string> = {};

  const respond = (status: number, body: unknown, extra?: Record<string, string>): Response => {
    const text = JSON.stringify(body);
    logRequest({
      api_key_id: principal?.keyId ?? null,
      org_id: principal?.orgId ?? null,
      method: req.method,
      route: subPath.slice(0, 300),
      status,
      project_id: projectForAudit,
      scope_used: scopeUsed,
      latency_ms: Date.now() - started,
      bytes_out: text.length,
      request_id: requestId,
      error_code: status >= 400
        ? String((body as { error?: { code?: string } })?.error?.code ?? "")
        : null,
      ip,
    });
    return new Response(text, {
      status,
      headers: {
        ...corsHeaders,
        ...rlHeaders,
        ...extra,
        "Content-Type": "application/json",
        "X-Request-Id": requestId,
      },
    });
  };

  try {
    // [1-3] authenticate + principal
    principal = await authenticate(req, ip ?? "unknown");

    // [find route]
    const route = routes.find((r) => r.method === req.method && r.pattern.test(subPath));
    if (!route) {
      throw new ApiError(404, "route_not_found", `no such route: ${req.method} /v1${subPath}`);
    }
    scopeUsed = route.scope;

    // [4] scope (tenancy is checked inside each handler against its ids)
    requireScope(principal, route.scope);

    // [5] rate limits
    const limits = await loadLimits(principal);
    rlHeaders = await rateLimit(principal, limits);

    // [6] parse + cap body
    let body: unknown = undefined;
    if (req.method === "POST" || req.method === "PUT") {
      const text = await req.text();
      if (text.length > MAX_BODY_BYTES) {
        throw new ApiError(413, "payload_too_large", "request body exceeds 512 KB");
      }
      if (text.length > 0) {
        try {
          body = JSON.parse(text);
        } catch {
          throw new ApiError(400, "invalid_json", "request body is not valid JSON");
        }
      }
    }

    // [7] delegate
    const params = subPath.match(route.pattern)?.slice(1) ?? [];
    const ctx: Ctx = { principal, limits, params, url, req, body };
    const result = await route.handler(ctx);
    projectForAudit = ctx.auditProjectId ?? null;

    // [8] audit + respond
    return respond(result.status, result.body, result.headers);
  } catch (e) {
    if (e instanceof ApiError) {
      return respond(e.status, {
        error: { code: e.code, message: e.message, ...(e.details !== undefined ? { details: e.details } : {}) },
      }, e.extraHeaders);
    }
    console.error("api gateway error", e);
    return respond(500, {
      error: { code: "internal_error", message: "internal error (see X-Request-Id)" },
    });
  }
});
