// Chainable Supabase query-builder stub for ToolContext in offline eval runs.
// Every filter/modifier returns the builder; awaiting it resolves the seeded
// rows for the table. Filtering fidelity is deliberately NOT simulated — the
// golden harness only needs identical inputs to yield identical outputs across
// refactors, and both sides of the comparison run through this same stub.

interface QueryResult { data: unknown[] | null; error: { message: string } | null }

function builder(rows: unknown[]): PromiseLike<QueryResult> & Record<string, unknown> {
  const b: Record<string, unknown> = {};
  const chain = () => b;
  for (const m of ["select", "eq", "neq", "in", "is", "not", "order", "limit", "range", "ilike", "gte", "lte", "maybeSingle", "single"]) {
    b[m] = chain;
  }
  (b as Record<string, unknown>).then = (
    resolve: (r: QueryResult) => unknown,
    reject?: (e: unknown) => unknown,
  ) => Promise.resolve({ data: rows, error: null }).then(resolve, reject);
  return b as PromiseLike<QueryResult> & Record<string, unknown>;
}

export function stubSupabaseTables(tables: Record<string, unknown[]>) {
  return {
    from(table: string) { return builder(tables[table] ?? []); },
    rpc(_fn: string, _args?: Record<string, unknown>) {
      return Promise.resolve({ data: null, error: null });
    },
  };
}
