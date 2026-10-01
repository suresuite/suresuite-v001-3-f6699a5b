import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";

// WP 10.1 · §4 D235 — which LEVEL an analysis kind reads is stated once, in the
// `analysis_kinds` table, because `analysis_get_or_start` reads it at run time.
// What a kind's PARAMETERS mean is stated once, in `analysis_runs.contract.yaml`.
// Both name the kinds, so this is the gate that keeps the two lists one list.

const ROOT = join(__dirname, "../../../..");

function seededKinds(): Map<string, string> {
  const dir = join(ROOT, "supabase", "migrations");
  const out = new Map<string, string>();
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) {
    const sql = readFileSync(join(dir, f), "utf8");
    const at = sql.indexOf("INSERT INTO public.analysis_kinds");
    if (at < 0) continue;
    const block = sql.slice(at, sql.indexOf(";", sql.indexOf("ON CONFLICT", at)));
    for (const m of block.matchAll(/\(\s*'([a-z_][a-z0-9_]*)'\s*,\s*'(product|process|firm|all)'/g)) {
      out.set(m[1], m[2]);
    }
  }
  return out;
}

describe("analysis kinds: one list, two halves", () => {
  const yaml = parse(readFileSync(join(ROOT, "supabase", "contract", "analysis_runs.contract.yaml"), "utf8"));
  const catalog = new Set(Object.keys(yaml.analysis_kinds ?? {}));
  const seeded = seededKinds();

  it("the migrations seed the kinds table", () => {
    expect(seeded.size).toBeGreaterThanOrEqual(5);
  });

  it("every kind with a declared scope has a params entry, and the other way round", () => {
    expect([...seeded.keys()].sort()).toEqual([...catalog].sort());
  });

  it("the centrality kinds read the firm level, not the composite", () => {
    expect(seeded.get("network_metrics")).toBe("firm");
    expect(seeded.get("prominence")).toBe("firm");
  });

  it("no kind declares the retired topology_digest parameter (D240)", () => {
    for (const [kind, def] of Object.entries(yaml.analysis_kinds ?? {})) {
      const params = (def as { params?: Record<string, unknown> }).params ?? {};
      expect(Object.keys(params), kind).not.toContain("topology_digest");
    }
  });
});
