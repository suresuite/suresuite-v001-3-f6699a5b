// Minimal, dependency-free assertions so the deterministic tier runs fully
// offline (no std/jsr fetch at test time — CI and air-gapped dev behave the same).

function stableStringify(v: unknown): string {
  return JSON.stringify(sortKeys(v), null, 2);
}

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort()) {
      out[k] = sortKeys((v as Record<string, unknown>)[k]);
    }
    return out;
  }
  return v;
}

export function assert(cond: unknown, msg = "assertion failed"): asserts cond {
  if (!cond) throw new Error(msg);
}

export function assertEquals(actual: unknown, expected: unknown, msg?: string) {
  const a = stableStringify(actual);
  const e = stableStringify(expected);
  if (a !== e) {
    const detail = firstDiff(a, e);
    throw new Error(`${msg ?? "values differ"}\n--- first divergence ---\n${detail}`);
  }
}

export function assertMatch(actual: string, re: RegExp, msg?: string) {
  if (!re.test(actual)) throw new Error(`${msg ?? "no match"}: ${re} against ${JSON.stringify(actual.slice(0, 200))}`);
}

export function assertStringIncludes(actual: string, needle: string, msg?: string) {
  if (!actual.includes(needle)) {
    throw new Error(`${msg ?? "missing substring"}: ${JSON.stringify(needle)} not in ${JSON.stringify(actual.slice(0, 400))}`);
  }
}

export async function assertRejects(fn: () => Promise<unknown>, msg?: string): Promise<Error> {
  try {
    await fn();
  } catch (e) {
    return e instanceof Error ? e : new Error(String(e));
  }
  throw new Error(msg ?? "expected rejection, but the promise resolved");
}

function firstDiff(a: string, e: string): string {
  const al = a.split("\n");
  const el = e.split("\n");
  for (let i = 0; i < Math.max(al.length, el.length); i++) {
    if (al[i] !== el[i]) {
      return `line ${i + 1}\n  actual:   ${al[i] ?? "<missing>"}\n  expected: ${el[i] ?? "<missing>"}`;
    }
  }
  return "(stringified forms equal — non-JSON difference?)";
}
