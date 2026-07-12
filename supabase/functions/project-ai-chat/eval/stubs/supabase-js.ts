// Offline stand-in for https://esm.sh/@supabase/supabase-js@2.45.0, used only
// under eval/deno.json's import map (ai-agents.md §7.4 deterministic tier).
// Tests always inject their own client object into ToolContext / telemetry, so
// this stub only needs to satisfy the module surface the functions import.

// deno-lint-ignore no-explicit-any
export type SupabaseClient = {
  // deno-lint-ignore no-explicit-any
  from: (table: string) => any;
  // deno-lint-ignore no-explicit-any
  rpc: (fn: string, args?: Record<string, unknown>) => any;
  [key: string]: unknown;
};

export function createClient(_url: string, _key: string, _opts?: unknown): SupabaseClient {
  const fail = () => {
    throw new Error("eval stub supabase client: tests must inject their own client");
  };
  return {
    from: fail,
    rpc: () => Promise.resolve({ data: null, error: { message: "eval stub client" } }),
  } as SupabaseClient;
}
