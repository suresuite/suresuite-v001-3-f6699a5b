// Stateful supabase-like stub for the Stage 1 deterministic tier
// (ai-agents.md §7.4 tier 1). Unlike stub_supabase.ts (which returns seeded
// rows verbatim for the golden-transcript replays), this stub implements
// filter fidelity for eq/in and maybeSingle plus an in-memory proposal fabric
// and item-master write RPCs, so the draft/apply machinery can be driven
// end-to-end offline: idempotency, scope gates, reducer recomputation, the
// full-row merge, and the post-apply findings delta.

export type Row = Record<string, unknown>;

interface Filter {
  kind: "eq" | "in" | "gte" | "lte";
  col: string;
  value: unknown;
}

interface QueryResult {
  data: unknown;
  error: { message: string } | null;
}

class QueryBuilder implements PromiseLike<QueryResult> {
  private filters: Filter[] = [];
  private orderCol: string | null = null;
  private orderAsc = true;
  private limitN: number | null = null;
  private wantSingle = false;
  // Stage 4: write fidelity for the dispatch path — .insert({...}).select()
  // .single() and .update({...}).eq(...) as dispatch.ts drives them.
  private mode: "select" | "insert" | "update" = "select";
  private insertRows: Row[] = [];
  private updatePatch: Row | null = null;

  constructor(private rows: Row[]) {}

  select(_cols?: string) { return this; }
  insert(payload: Row | Row[]) {
    this.mode = "insert";
    this.insertRows = Array.isArray(payload) ? payload : [payload];
    return this;
  }
  update(patch: Row) {
    this.mode = "update";
    this.updatePatch = patch;
    return this;
  }
  eq(col: string, value: unknown) { this.filters.push({ kind: "eq", col, value }); return this; }
  in(col: string, value: unknown[]) { this.filters.push({ kind: "in", col, value }); return this; }
  gte(col: string, value: unknown) { this.filters.push({ kind: "gte", col, value }); return this; }
  lte(col: string, value: unknown) { this.filters.push({ kind: "lte", col, value }); return this; }
  order(col: string, opts?: { ascending?: boolean }) {
    this.orderCol = col;
    this.orderAsc = opts?.ascending !== false;
    return this;
  }
  limit(n: number) { this.limitN = n; return this; }
  maybeSingle() { this.wantSingle = true; return this; }
  /** supabase-js .single(): here identical to maybeSingle (callers assert). */
  single() { this.wantSingle = true; return this; }

  private run(): QueryResult {
    if (this.mode === "insert") {
      const inserted: Row[] = [];
      for (const r of this.insertRows) {
        const row: Row = { id: nextUuid(), created_at: new Date().toISOString(), ...r };
        this.rows.push(row);
        inserted.push(row);
      }
      if (this.wantSingle || this.insertRows.length === 1) {
        return { data: inserted[0] ? structuredClone(inserted[0]) : null, error: null };
      }
      return { data: structuredClone(inserted), error: null };
    }
    if (this.mode === "update") {
      const touched = this.rows.filter((r) =>
        this.filters.every((f) => {
          const v = r[f.col];
          switch (f.kind) {
            case "eq": return String(v) === String(f.value);
            case "in": return (f.value as unknown[]).map(String).includes(String(v));
            case "gte": return Number(v) >= Number(f.value);
            case "lte": return Number(v) <= Number(f.value);
          }
        })
      );
      for (const r of touched) Object.assign(r, this.updatePatch ?? {});
      return { data: structuredClone(touched), error: null };
    }
    let out = this.rows.filter((r) =>
      this.filters.every((f) => {
        const v = r[f.col];
        switch (f.kind) {
          case "eq": return String(v) === String(f.value);
          case "in": return (f.value as unknown[]).map(String).includes(String(v));
          case "gte": return Number(v) >= Number(f.value);
          case "lte": return Number(v) <= Number(f.value);
        }
      })
    );
    if (this.orderCol) {
      const col = this.orderCol;
      out = [...out].sort((a, b) => {
        const d = Number(a[col]) - Number(b[col]);
        return this.orderAsc ? d : -d;
      });
    }
    if (this.limitN != null) out = out.slice(0, this.limitN);
    // Clone like the wire would: callers must never hold references into the
    // store (the apply path's `before` snapshot depends on this).
    if (this.wantSingle) return { data: out[0] ? structuredClone(out[0]) : null, error: null };
    return { data: structuredClone(out), error: null };
  }

  then<T1 = QueryResult, T2 = never>(
    resolve?: ((r: QueryResult) => T1 | PromiseLike<T1>) | null,
    reject?: ((e: unknown) => T2 | PromiseLike<T2>) | null,
  ): PromiseLike<T1 | T2> {
    return Promise.resolve(this.run()).then(resolve, reject);
  }
}

export type RpcHandler = (args: Record<string, unknown>) => unknown;

export interface StubDb {
  tables: Record<string, Row[]>;
  // deno-lint-ignore no-explicit-any
  from(table: string): any;
  rpc(fn: string, args?: Record<string, unknown>): Promise<QueryResult>;
}

export function makeStubDb(
  tables: Record<string, Row[]>,
  rpcs: Record<string, RpcHandler> = {},
): StubDb {
  return {
    tables,
    from(table: string) {
      // Materialize missing tables so inserts land in the store, not in a
      // detached array (the Stage 4 dispatch path inserts simulation_runs).
      if (!tables[table]) tables[table] = [];
      return new QueryBuilder(tables[table]);
    },
    rpc(fn: string, args: Record<string, unknown> = {}) {
      const handler = rpcs[fn];
      if (!handler) return Promise.resolve({ data: null, error: { message: `no stub rpc: ${fn}` } });
      try {
        return Promise.resolve({ data: handler(args), error: null });
      } catch (e) {
        return Promise.resolve({ data: null, error: { message: e instanceof Error ? e.message : String(e) } });
      }
    },
  };
}

let idCounter = 0;
const nextUuid = () => {
  idCounter += 1;
  return `00000000-0000-4000-8000-${String(idCounter).padStart(12, "0")}`;
};

/** djb2 over a canonical JSON — an opaque, state-derived stand-in for the SQL
 * current_policy_hash, so out-of-band mutations drift the hash (pc-08). */
function stubHash(value: unknown): string {
  const sort = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sort);
    if (v && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(v as Record<string, unknown>).sort()) {
        out[k] = sort((v as Record<string, unknown>)[k]);
      }
      return out;
    }
    return v;
  };
  const s = JSON.stringify(sort(value));
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return `stub-${h.toString(16)}`;
}

/** In-memory mirror of the proposal fabric + item-master write RPCs + the
 * Stage 2/3 policy/validation RPCs + the M2 memory RPCs — the SQL originals
 * are pinned separately against scratch Postgres (db_rpc_test.ts /
 * db_stage23_test.ts); this mirror lets the tool/apply orchestration run
 * without a database. */
export function makeAgentRpcs(tables: Record<string, Row[]>, opts?: { graphHash?: string }): Record<string, RpcHandler> {
  if (!tables.proposals) tables.proposals = [];

  const FAMILIES = ["sourcing", "inventory", "transport", "fulfillment", "production", "recovery", "demand"];

  const policyHash = (): string => {
    const d = (tables.policy_defaults ?? [])[0] ?? {};
    const overrides = (tables.policy_overrides ?? [])
      .map(({ scope, target_key, family, patch }) => ({ scope, target_key, family, patch }))
      .sort((a, b) =>
        String(a.scope).localeCompare(String(b.scope)) ||
        String(a.target_key).localeCompare(String(b.target_key)) ||
        String(a.family).localeCompare(String(b.family)));
    const defaults: Record<string, unknown> = {};
    for (const f of FAMILIES) defaults[f] = d[f] ?? null;
    return stubHash({
      defaults,
      fulfillment_strategy: d.fulfillment_strategy ?? "make_to_stock",
      overrides,
    });
  };

  const upsert = (table: string, idCol: string, enums: Record<string, string[]>) => (args: Record<string, unknown>) => {
    const rows = (args.p_rows ?? []) as Row[];
    for (const r of rows) {
      for (const [field, allowed] of Object.entries(enums)) {
        const v = r[field];
        if (v != null && v !== "" && !allowed.includes(String(v).toLowerCase())) {
          throw new Error(`invalid ${field} "${v}" — engine accepts: ${allowed.join(", ")}`);
        }
      }
    }
    const store = tables[table] ?? (tables[table] = []);
    for (const r of rows) {
      const id = String(r[idCol] ?? "");
      if (!id) continue;
      const existing = store.find((row) => String(row[idCol] ?? "") === id);
      if (existing) Object.assign(existing, r);
      else store.push({ ...r });
    }
    return rows.length;
  };

  return {
    current_graph_hash: () => opts?.graphHash ?? "graph-hash-1",
    get_project_dataset_counts: () => ({ total_records: 0 }),
    create_agent_proposal: (args) => {
      const live = tables.proposals.filter((p) =>
        String(p.project_id) === String(args.p_project_id) &&
        String(p.idempotency_key) === String(args.p_idempotency_key) &&
        ["draft", "proposed", "approved"].includes(String(p.status))
      );
      if (live.length > 0) return live[0].id;
      const liveByUser = tables.proposals.filter((p) =>
        String(p.project_id) === String(args.p_project_id) &&
        String(p.created_by ?? "") === String(args.p_user_id ?? "") &&
        ["draft", "proposed", "approved"].includes(String(p.status))
      );
      if (liveByUser.length >= 20) throw new Error("too_large: live-proposal cap (20) reached for this project");
      const id = nextUuid();
      tables.proposals.push({
        id,
        project_id: args.p_project_id,
        agent_id: args.p_agent_id,
        artifact_type: args.p_artifact_type,
        title: args.p_title,
        payload: args.p_payload,
        citations: args.p_citations,
        provenance: args.p_provenance,
        grounding: args.p_grounding,
        idempotency_key: args.p_idempotency_key,
        thread_id: args.p_thread_id ?? null,
        status: args.p_status ?? "proposed",
        apply_attempts: 0,
        apply_error: null,
        applied_result: null,
        created_by: args.p_user_id ?? null,
      });
      return id;
    },
    mark_agent_proposal_applied: (args) => {
      const p = tables.proposals.find((r) => String(r.id) === String(args.p_proposal_id));
      if (p && p.status === "approved") {
        p.status = "applied";
        p.applied_result = args.p_result;
        p.apply_error = null;
      }
      return null;
    },
    mark_agent_proposal_apply_failed: (args) => {
      const p = tables.proposals.find((r) => String(r.id) === String(args.p_proposal_id));
      if (p && p.status === "approved") {
        p.apply_attempts = Number(p.apply_attempts ?? 0) + 1;
        p.apply_error = String(args.p_error ?? "").slice(0, 500);
      }
      return null;
    },
    bulk_upsert_materials: upsert("materials", "material_id", {
      lead_time_dist: ["deterministic", "lognormal", "gamma"],
    }),
    bulk_upsert_products: upsert("products", "product_id", {
      fulfillment_mode: ["mto", "mts"],
      demand_distribution: ["triangular", "deterministic", "poisson", "negbin"],
    }),
    bulk_upsert_suppliers: upsert("suppliers", "supplier_id", {}),

    // ── Stage 2 mirrors (SQL originals: 20260609000025 / 20260612000001 /
    //    20260716000001, pinned in db_stage23_test.ts) ────────────────────────
    current_policy_hash: () => policyHash(),
    list_policy_versions: () =>
      [...(tables.policy_versions ?? [])]
        .sort((a, b) => Number(b.created_at ?? 0) - Number(a.created_at ?? 0))
        .map(({ id, label, parent_version_id, policy_hash, created_at }) => ({
          id, label, author_email: null, author_name: null,
          parent_version_id: parent_version_id ?? null,
          policy_hash: policy_hash ?? null, created_at,
        })),
    apply_policy_bundle: (args) => {
      if (args.p_expected_policy_hash != null && String(args.p_expected_policy_hash) !== policyHash()) {
        throw new Error(
          `stale_values: the policy configuration changed since this proposal was drafted`,
        );
      }
      const store = tables.policy_defaults ?? (tables.policy_defaults = []);
      if (store.length === 0) store.push({ project_id: args.p_project_id });
      const def = store[0];
      for (const [family, patch] of Object.entries((args.p_defaults ?? {}) as Record<string, Row>)) {
        if (!FAMILIES.includes(family)) throw new Error(`unknown policy family ${family}`);
        def[family] = { ...((def[family] ?? {}) as Row), ...patch };
      }
      const oStore = tables.policy_overrides ?? (tables.policy_overrides = []);
      for (const o of (args.p_overrides ?? []) as Row[]) {
        if (!FAMILIES.includes(String(o.family))) throw new Error(`unknown policy family ${o.family}`);
        const existing = oStore.find((row) =>
          String(row.scope) === String(o.scope) &&
          String(row.target_key) === String(o.target_key) &&
          String(row.family) === String(o.family));
        if (existing) existing.patch = { ...((existing.patch ?? {}) as Row), ...((o.patch ?? {}) as Row) };
        else oStore.push({ project_id: args.p_project_id, scope: o.scope, target_key: o.target_key, family: o.family, patch: o.patch ?? {} });
      }
      const vStore = tables.policy_versions ?? (tables.policy_versions = []);
      const id = nextUuid();
      const hash = policyHash();
      vStore.push({
        id,
        project_id: args.p_project_id,
        label: args.p_label ?? "agent: policy bundle",
        parent_version_id: args.p_parent_version_id ?? null,
        policy_hash: hash,
        created_at: Date.now() + vStore.length,
      });
      return { policy_version_id: id, policy_hash: hash, overrides_applied: ((args.p_overrides ?? []) as Row[]).length };
    },
    restore_policy_version: (args) => {
      const v = (tables.policy_versions ?? []).find((r) => String(r.id) === String(args.p_version_id));
      if (!v) throw new Error(`Version ${args.p_version_id} not found`);
      return null; // mirror records the call; full restore is pinned in SQL tests
    },

    // ── Stage 4 mirrors ──────────────────────────────────────────────────────
    // snapshot_dataset (20260703000001): deduped server-side — an unchanged
    // dataset reuses its latest version. The mirror returns the newest seeded
    // dataset_versions row (or none, matching a pre-migration database).
    snapshot_dataset: () => {
      const versions = [...(tables.dataset_versions ?? [])]
        .sort((a, b) => Number(b.created_at ?? 0) - Number(a.created_at ?? 0));
      return versions[0]?.id ?? null;
    },

    // ── Stage 3 mirrors (SQL original: 20260710000001) ───────────────────────
    scenario_fingerprint_hash: (args) => `scen-${args.p_scenario_id}`,
    list_model_validations: () =>
      [...(tables.model_validations ?? [])]
        .sort((a, b) => Number(b.created_at ?? 0) - Number(a.created_at ?? 0)),
    record_model_validation: (args) => {
      const versions = tables.policy_versions ?? [];
      if (!versions.some((v) => String(v.id) === String(args.p_policy_version_id))) {
        throw new Error(`policy version ${args.p_policy_version_id} not found`);
      }
      if (!(tables.dataset_versions ?? []).some((v) => String(v.id) === String(args.p_dataset_version_id))) {
        throw new Error(`dataset version ${args.p_dataset_version_id} not found`);
      }
      if (!(tables.scenarios ?? []).some((s) => String(s.id) === String(args.p_scenario_id))) {
        throw new Error(`scenario ${args.p_scenario_id} not found`);
      }
      const store = tables.model_validations ?? (tables.model_validations = []);
      const graphHash = opts?.graphHash ?? "graph-hash-1";
      const scenarioHash = `scen-${args.p_scenario_id}`;
      const id = nextUuid();
      const prev = store.find((c) =>
        String(c.policy_version_id) === String(args.p_policy_version_id) &&
        String(c.graph_hash) === graphHash &&
        String(c.scenario_hash) === scenarioHash &&
        c.status === "active");
      if (prev) {
        prev.status = "superseded";
        prev.superseded_by = id;
      }
      store.push({
        id,
        project_id: args.p_project_id,
        policy_version_id: args.p_policy_version_id,
        policy_hash: versions.find((v) => String(v.id) === String(args.p_policy_version_id))?.policy_hash ?? "ph",
        dataset_version_id: args.p_dataset_version_id,
        graph_hash: graphHash,
        scenario_hash: scenarioHash,
        adopted_warmup_days: args.p_adopted_warmup_days,
        warmup_method: args.p_warmup_method ?? "engine",
        recommended_replications: args.p_recommended_replications,
        replication_basis: args.p_replication_basis ?? {},
        validation_tests: args.p_validation_tests ?? [],
        findings_snapshot: args.p_findings ?? [],
        verdict: args.p_verdict ?? "validated",
        basis: args.p_basis ?? "statistical",
        evidence_run_id: args.p_evidence_run_id ?? null,
        status: "active",
        superseded_by: null,
        validated_at: Date.now(),
        created_at: Date.now() + store.length,
      });
      return id;
    },
    active_model_validation: (args) =>
      (tables.model_validations ?? []).filter((c) =>
        String(c.policy_version_id) === String(args.p_policy_version_id) &&
        String(c.graph_hash) === String(args.p_graph_hash) &&
        String(c.scenario_hash) === String(args.p_scenario_hash) &&
        c.status === "active" && c.verdict === "validated"),

    // ── M2 mirrors (SQL original: 20260717000003) ────────────────────────────
    save_project_memory: (args) => {
      const content = String(args.p_content ?? "").trim();
      if (!content) throw new Error("memory content must not be empty");
      if (content.length > 500) throw new Error("too_large: memory content exceeds 500 characters");
      if (!["fact", "preference", "decision"].includes(String(args.p_kind))) {
        throw new Error("kind must be fact, preference or decision");
      }
      const store = tables.project_memory ?? (tables.project_memory = []);
      if (store.filter((m) => String(m.project_id) === String(args.p_project_id) && m.status === "active").length >= 200) {
        throw new Error("too_large: active-memory cap (200) reached for this project — archive older entries first");
      }
      const id = nextUuid();
      store.push({
        id,
        project_id: args.p_project_id,
        kind: args.p_kind,
        content,
        citations: args.p_citations ?? [],
        grounding: args.p_grounding ?? {},
        status: "active",
        created_by: args.p_user_id ?? null,
        source_thread_id: args.p_source_thread_id ?? null,
        created_at: Date.now() + store.length,
      });
      return id;
    },
    archive_project_memory: (args) => {
      const m = (tables.project_memory ?? []).find((r) => String(r.id) === String(args.p_id));
      if (m && m.status === "active") m.status = "archived";
      return null;
    },
  };
}
