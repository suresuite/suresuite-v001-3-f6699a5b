// A fetch() that cannot hang — for every outbound provider call.
//
// Nothing in the AI path had a timeout. The §21.5 wall budget is only checked
// BETWEEN LLM calls and between tool hops, so a single stalled provider
// connection could not be interrupted: it burned the whole edge-function wall
// clock, and the client — which has no timeout either — was left with
// Supabase's generic non-2xx string, or nothing at all.
//
// Lives in _shared/ rather than providers.ts so router.ts and summaries.ts,
// which are deliberately dependency-free so they stay unit-testable in
// isolation, can use it without taking on the provider module.

/** Per-call ceiling for a provider HTTP request. 25 s leaves room for two
 * calls plus the §20.5 retry inside the 60 s request wall budget. */
export const PROVIDER_TIMEOUT_MS = 25_000;

export async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs: number = PROVIDER_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (e) {
    // Surface the timeout as a plain, honest Error rather than an AbortError
    // the callers' `instanceof Error ? e.message : e` handling would render
    // as "The signal has been aborted".
    if (e instanceof DOMException && e.name === "AbortError") {
      throw new Error(`provider request timed out after ${timeoutMs} ms`);
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}
