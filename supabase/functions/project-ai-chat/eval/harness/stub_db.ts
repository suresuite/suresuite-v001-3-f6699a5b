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
  private single = false;

  constructor(private rows: Row[]) {}

  select(_cols?: string) { return this; }
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
  maybeSingle() { this.single = true; return this; }

  private run(): QueryResult {
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
    if (this.single) return { data: out[0] ? structuredClone(out[0]) : null, error: null };
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
      return new QueryBuilder(tables[table] ?? []);
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

/** In-memory mirror of the proposal fabric + item-master write RPCs — the SQL
 * originals are pinned separately against scratch Postgres (db_rpc_test.ts);
 * this mirror lets the tool/apply orchestration run without a database. */
export function makeAgentRpcs(tables: Record<string, Row[]>, opts?: { graphHash?: string }): Record<string, RpcHandler> {
  if (!tables.proposals) tables.proposals = [];

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
  };
}
