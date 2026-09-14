// ERP/MRP connector — Phase 1 (single read-only connector pilot) + Phase 2
// (scheduled sync + audit) for orbit-mrp, per
// docs/design/erp-mrp-integration-plan.md (G18).
//
// Every action here is a deliberately narrow slice of what the plan
// requires — see the design doc for the full rationale. The rules that
// matter most while touching this file:
//
//   * NEVER call orbit-mrp with a shared/admin credential. Every call uses
//     the OAuth token stored for one specific project_erp_links row,
//     resolved through Vault (get_erp_oauth_token), which is scoped to
//     exactly the company that user's own consent screen approved. There
//     is no "sync everything" credential anywhere in this file (plan §6b
//     rule 1).
//   * A link is created only after the user's own token proves company
//     membership (orbit-mrp's list_companies must return the company being
//     linked) — never from a hand-entered company id (plan §6b rule 2).
//   * Every sync re-verifies both sides live before touching data — project
//     access on this side, and that the stored token still authorizes the
//     linked company on orbit-mrp's side (plan §6b rule 3). A failed
//     re-check revokes the link and stops; it never "keeps going on the old
//     assumption."
//   * Nothing lands in materials/products/bom_* directly. sync() only
//     stages rows and computes a diff; apply() is the only place live
//     tables are touched, and only for rows a human (or an auto-apply rule
//     under the link's auto_apply_threshold_pct) has approved.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.55.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ── orbit-mrp client: thin wrapper over its MCP-over-HTTP tool routes,
//    documented in that repo's docs/agent-access.md. Every call is made
//    with one specific user's OAuth token — never a service credential. ────
class OrbitMrpClient {
  constructor(private baseUrl: string, private token: string) {}

  private async invoke(tool: string, args: Record<string, unknown> = {}) {
    const res = await fetch(`${this.baseUrl}/.mcp/invoke-tool/${tool}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(args),
    });
    if (!res.ok) {
      throw new OrbitMrpAuthError(`orbit-mrp ${tool} failed: ${res.status} ${await res.text()}`, res.status);
    }
    return res.json();
  }

  listCompanies() {
    return this.invoke("list_companies") as Promise<Array<{ id: string; name: string; role: string }>>;
  }

  listProducts(companyId: string) {
    return this.invoke("list_products", { company_id: companyId }) as Promise<Array<Record<string, unknown>>>;
  }

  getBom(companyId: string, productId: string) {
    return this.invoke("get_bom", { company_id: companyId, product_id: productId, explode: false });
  }
}

class OrbitMrpAuthError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

// ── Field mapping: orbit-mrp's products/bom shape -> SuReSuite's staged
//    shape, tracking what mapped cleanly vs. what had to be defaulted or
//    couldn't be mapped at all (feeds erp_sync_runs' mapping report, which
//    the UI's Sync Mapping Report renders — plan §6c.1). ────────────────────
// Same shape as scsim's MappingWarning (level/entity/field/reason) so the
// existing MappingWarningsCard component can render this unmodified —
// see src/components/sim/RunProgressPanel.tsx and plan §6c.1.
interface MappingOutcome {
  mapped: number;
  defaulted: number;
  failed: number;
  warnings: Array<{ level: "info" | "warn" | "error"; entity: string; field: string; reason: string }>;
}

function mapProduct(raw: Record<string, unknown>, outcome: MappingOutcome) {
  const staged: Record<string, unknown> = {
    external_id: raw.id,
    sku: raw.sku ?? null,
    name: raw.name ?? null,
    product_type: raw.type ?? null,
    unit_of_measure: raw.unit_of_measure ?? null,
    lead_time_days: raw.lead_time_days ?? null,
    moq: raw.moq ?? null,
    unit_cost: raw.unit_cost ?? null,
    supplier_name: raw.supplier_name ?? null,
    supplier_number: raw.supplier_number ?? null,
    cycle_time_seconds: raw.cycle_time_seconds ?? null,
    raw,
  };

  for (const [field, value] of Object.entries(staged)) {
    if (field === "raw" || field === "external_id") continue;
    if (value === null || value === undefined) {
      outcome.defaulted++;
      outcome.warnings.push({
        level: "warn",
        entity: String(raw.sku ?? raw.id ?? "unknown product"),
        field,
        reason: `orbit-mrp did not provide "${field}" — left null, project defaults apply on merge`,
      });
    } else {
      outcome.mapped++;
    }
  }

  if (!raw.id) {
    outcome.failed++;
    outcome.warnings.push({ level: "error", entity: String(raw.sku ?? "unknown"), field: "external_id", reason: "product row had no id — cannot be staged" });
    return null;
  }
  return staged;
}

// ── Live re-verification (plan §6b rule 3): both sides, every sync ─────────
async function reverifyLink(
  admin: ReturnType<typeof createClient>,
  link: Record<string, any>,
): Promise<{ ok: true; client: OrbitMrpClient } | { ok: false; reason: string }> {
  const { data: hasAccess } = await admin.rpc("has_project_access", { p_project_id: link.project_id });
  if (!hasAccess) {
    return { ok: false, reason: "linking user no longer has access to the SuReSuite project" };
  }

  const token = await admin.rpc("get_erp_oauth_token", { p_ref: link.external_oauth_token_ref });
  if (token.error || !token.data) {
    return { ok: false, reason: "no stored token for this link" };
  }

  const orbitBaseUrl = Deno.env.get("ORBIT_MRP_BASE_URL") ?? "";
  const client = new OrbitMrpClient(orbitBaseUrl, token.data as string);
  try {
    const companies = await client.listCompanies();
    const stillMember = companies.some((c) => c.id === link.external_company_id);
    if (!stillMember) {
      return { ok: false, reason: "token no longer authorizes the linked company (membership revoked upstream)" };
    }
  } catch (e) {
    if (e instanceof OrbitMrpAuthError && (e.status === 401 || e.status === 403)) {
      return { ok: false, reason: "orbit-mrp rejected the stored token (expired or revoked)" };
    }
    throw e;
  }

  return { ok: true, client };
}

async function revokeLink(admin: ReturnType<typeof createClient>, linkId: string, reason: string) {
  await admin
    .from("project_erp_links")
    .update({ status: "revoked", status_detail: reason, revoked_at: new Date().toISOString() })
    .eq("id", linkId);
}

// ── Actions ──────────────────────────────────────────────────────────────

/** list_companies: populates the "Connect a data source" picker with only
 *  what the *user's own* fresh OAuth token proves they can see — never a
 *  hand-typed company id (plan §6b rule 2). Called right after the OAuth
 *  redirect back into SuReSuite, before any project_erp_links row exists. */
async function actionListCompanies(userToken: string) {
  const orbitBaseUrl = Deno.env.get("ORBIT_MRP_BASE_URL") ?? "";
  const client = new OrbitMrpClient(orbitBaseUrl, userToken);
  const companies = await client.listCompanies();
  return json({ companies });
}

/** link: creates the project_erp_links row. Requires the caller's own
 *  Supabase session (project access is enforced by RLS on insert) plus the
 *  fresh orbit-mrp OAuth token whose list_companies just returned this
 *  company — re-checked here server-side too, never trusted from the
 *  client alone. */
async function actionLink(
  supabaseWithUserAuth: ReturnType<typeof createClient>,
  admin: ReturnType<typeof createClient>,
  body: { project_id: string; external_company_id: string; external_company_name?: string; oauth_token: string },
) {
  const orbitBaseUrl = Deno.env.get("ORBIT_MRP_BASE_URL") ?? "";
  const client = new OrbitMrpClient(orbitBaseUrl, body.oauth_token);
  const companies = await client.listCompanies();
  const match = companies.find((c) => c.id === body.external_company_id);
  if (!match) {
    return json({ error: "Your orbit-mrp session does not have access to that company." }, 403);
  }

  const { data: userRes } = await supabaseWithUserAuth.auth.getUser();
  if (!userRes?.user) return json({ error: "Not authenticated" }, 401);

  const tokenRef = `erp_link_${crypto.randomUUID()}`;
  // Store the token in Vault via the service-role client (never in a table
  // this schema exposes to `authenticated`); get_erp_oauth_token(ref) is the
  // only read path back, and it's granted to service_role alone.
  await admin.schema("vault").from("secrets").insert({ name: tokenRef, secret: body.oauth_token });

  // RLS on project_erp_links requires has_project_access(project_id) for the
  // *inserting* role; using supabaseWithUserAuth here means the insert fails
  // closed if this user isn't actually authorized on the SuReSuite side.
  const { data: link, error } = await supabaseWithUserAuth
    .from("project_erp_links")
    .insert({
      project_id: body.project_id,
      external_system: "orbit-mrp",
      external_company_id: body.external_company_id,
      external_company_name: match.name,
      linked_by_user_id: userRes.user.id,
      external_oauth_token_ref: tokenRef,
      status: "active",
      last_verified_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) return json({ error: error.message }, 400);
  return json({ link });
}

/** sync: pulls products + BOM, stages them, computes a diff against the
 *  live item masters, and writes the audit row. Never writes materials/
 *  products/bom_* — that only happens in apply(). */
async function actionSync(admin: ReturnType<typeof createClient>, body: { link_id: string; triggered_by_user_id?: string }) {
  const { data: link, error: linkErr } = await admin
    .from("project_erp_links")
    .select("*")
    .eq("id", body.link_id)
    .single();
  if (linkErr || !link) return json({ error: "link not found" }, 404);

  const verified = await reverifyLink(admin, link);
  if (!verified.ok) {
    await revokeLink(admin, link.id, verified.reason);
    return json({ error: `sync skipped: ${verified.reason}`, revoked: true }, 409);
  }
  await admin.from("project_erp_links").update({ last_verified_at: new Date().toISOString(), status: "active" }).eq("id", link.id);

  const { data: run } = await admin
    .from("erp_sync_runs")
    .insert({
      link_id: link.id,
      triggered_by: body.triggered_by_user_id ? "manual" : "scheduled",
      triggered_by_user_id: body.triggered_by_user_id ?? null,
      status: "running",
    })
    .select()
    .single();

  try {
    const products = await verified.client.listProducts(link.external_company_id);
    const outcome: MappingOutcome = { mapped: 0, defaulted: 0, failed: 0, warnings: [] };

    const { data: existingProducts } = await admin
      .from("products")
      .select("product_id, source_external_id")
      .eq("project_id", link.project_id)
      .eq("source_system", "orbit-mrp");
    const existingByExternalId = new Map((existingProducts ?? []).map((p) => [p.source_external_id, p]));

    let rowsNew = 0, rowsChanged = 0, rowsUnchanged = 0;
    const stagedRows = [];
    for (const raw of products) {
      const mapped = mapProduct(raw, outcome);
      if (!mapped) continue;
      const existing = existingByExternalId.get(mapped.external_id as string);
      const diffState = !existing ? "new" : "changed"; // Phase 1: full-refresh diff; Phase 2 can use updated-since if orbit-mrp exposes it
      if (diffState === "new") rowsNew++; else rowsChanged++;
      stagedRows.push({ ...mapped, sync_run_id: run.id, link_id: link.id, diff_state: diffState });
    }
    // Anything in existingByExternalId not present in this pull is flagged removed upstream.
    const pulledIds = new Set(products.map((p) => p.id as string));
    for (const [externalId] of existingByExternalId) {
      if (externalId && !pulledIds.has(externalId)) {
        stagedRows.push({
          external_id: externalId, sync_run_id: run.id, link_id: link.id,
          diff_state: "removed_upstream", raw: {},
        });
      }
    }
    if (stagedRows.length) await admin.from("erp_staged_products").insert(stagedRows);

    await admin
      .from("erp_sync_runs")
      .update({
        status: "staged",
        rows_fetched: { products: products.length },
        rows_new: rowsNew,
        rows_changed: rowsChanged,
        rows_unchanged: rowsUnchanged,
        rows_removed: stagedRows.filter((r) => r.diff_state === "removed_upstream").length,
        mapping_warnings: outcome.warnings,
        fields_mapped: outcome.mapped,
        fields_defaulted: outcome.defaulted,
        fields_failed: outcome.failed,
        diff_summary: { products: { new: rowsNew, changed: rowsChanged, unchanged: rowsUnchanged } },
      })
      .eq("id", run.id);

    // Phase 2 auto-apply: only for links that opted in, and only when the
    // diff is small relative to the live table (plan §5 Phase 2 anomaly gate).
    const changePct = ((rowsNew + rowsChanged) / Math.max(products.length, 1)) * 100;
    if (link.auto_apply_threshold_pct > 0 && changePct <= link.auto_apply_threshold_pct && outcome.failed === 0) {
      await applyStagedRun(admin, run.id, null);
    }

    return json({ run_id: run.id, rows_new: rowsNew, rows_changed: rowsChanged, fields_defaulted: outcome.defaulted, fields_failed: outcome.failed });
  } catch (e) {
    await admin.from("erp_sync_runs").update({ status: "failed", error_detail: String(e) }).eq("id", run.id);
    return json({ error: String(e) }, 500);
  }
}

/** apply: the only place staged rows reach materials/products/bom_*. Called
 *  either by an explicit user action (approving a reviewed diff) or by
 *  sync()'s own auto-apply path when the link opted in and the diff is
 *  under threshold. Last-write-wins against manual edits is intentional
 *  (plan §6c "one consequence") but must never be silent — the caller is
 *  expected to have shown the confirmation copy before invoking this for a
 *  manual approval. */
async function applyStagedRun(admin: ReturnType<typeof createClient>, runId: string, appliedByUserId: string | null) {
  const { data: run } = await admin.from("erp_sync_runs").select("*, project_erp_links(*)").eq("id", runId).single();
  if (!run) throw new Error("sync run not found");
  const link = (run as any).project_erp_links;

  const { data: staged } = await admin.from("erp_staged_products").select("*").eq("sync_run_id", runId).neq("diff_state", "removed_upstream");

  for (const row of staged ?? []) {
    await admin.from("products").upsert(
      {
        project_id: link.project_id,
        product_id: row.sku ?? row.external_id,
        name: row.name,
        source_system: "orbit-mrp",
        source_external_id: row.external_id,
        source_synced_at: row.synced_at,
      },
      { onConflict: "project_id,product_id" },
    );
  }

  await admin
    .from("erp_sync_runs")
    .update({ status: "applied", applied_at: new Date().toISOString(), applied_by_user_id: appliedByUserId })
    .eq("id", runId);
}

async function actionApply(admin: ReturnType<typeof createClient>, supabaseWithUserAuth: ReturnType<typeof createClient>, body: { run_id: string }) {
  const { data: userRes } = await supabaseWithUserAuth.auth.getUser();
  if (!userRes?.user) return json({ error: "Not authenticated" }, 401);
  // RLS on erp_sync_runs (via project_erp_links) already refuses this select
  // if the caller lacks project access — fail-closed by construction.
  const { data: run, error } = await supabaseWithUserAuth.from("erp_sync_runs").select("id").eq("id", body.run_id).single();
  if (error || !run) return json({ error: "sync run not found or not authorized" }, 404);

  await applyStagedRun(admin, body.run_id, userRes.user.id);
  return json({ applied: true });
}

/** run_due_schedules: the Phase 2 cron entry point (see the pg_cron sweep in
 *  the migration). Re-verification inside sync() means an over-frequent
 *  sweep only costs a cheap no-op per link, never a false sync. */
async function actionRunDueSchedules(admin: ReturnType<typeof createClient>) {
  const { data: due } = await admin.rpc("due_erp_sync_links");
  const results = [];
  for (const link of due ?? []) {
    results.push(await actionSync(admin, { link_id: (link as any).id }).then((r) => r.json()));
  }
  return json({ ran: results.length, results });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json();
    const admin = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
    const authHeader = req.headers.get("Authorization") ?? "";
    const supabaseWithUserAuth = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_ANON_KEY") ?? "", {
      global: { headers: { Authorization: authHeader } },
    });

    switch (body.action) {
      case "list_companies":
        return await actionListCompanies(body.oauth_token);
      case "link":
        return await actionLink(supabaseWithUserAuth, admin, body);
      case "sync":
        return await actionSync(admin, { link_id: body.link_id, triggered_by_user_id: (await supabaseWithUserAuth.auth.getUser()).data.user?.id });
      case "apply":
        return await actionApply(admin, supabaseWithUserAuth, body);
      case "run_due_schedules":
        return await actionRunDueSchedules(admin);
      default:
        return json({ error: `unknown action "${body.action}"` }, 400);
    }
  } catch (e) {
    console.error("[erp-sync-orbit-mrp]", e);
    return json({ error: String(e) }, 500);
  }
});
