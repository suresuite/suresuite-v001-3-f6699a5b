// Env-var hygiene for edge functions.
//
// Secrets pasted into the GitHub or Supabase dashboards sometimes arrive
// wrapped in literal quotes (`"https://…"`). The quotes ride along into
// Deno.env, fetch() rejects the quoted URL as invalid, and every dispatch
// 500s with `enqueue to worker queue failed: TypeError: Invalid URL`.
// Reading secrets through cleanEnv() makes a quoted paste work anyway.
// The sim-worker applies the same tolerance in sim_worker/__main__.py.

/** Strip surrounding whitespace and one pair of matching wrapping quotes
 * (single or double). Pure — exported for tests. */
export function stripWrappingQuotes(raw: string): string {
  const trimmed = raw.trim();
  const m = trimmed.match(/^(["'])([\s\S]*)\1$/);
  return (m ? m[2] : trimmed).trim();
}

/** Deno.env.get with quote/whitespace tolerance. Returns undefined for
 * unset or blank values so `??` fallback chains behave. */
export function cleanEnv(name: string): string | undefined {
  const raw = Deno.env.get(name);
  if (raw === undefined) return undefined;
  const cleaned = stripWrappingQuotes(raw);
  return cleaned === "" ? undefined : cleaned;
}
