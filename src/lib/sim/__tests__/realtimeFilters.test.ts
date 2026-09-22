import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

// Audit F-33, as a class. A `postgres_changes` subscription with no `filter`
// wakes every open client on every row change in every project. It was
// `run_replications` in the audit; the scan found `simulation_runs` in
// ExperimentResultsPanel too. A subscription may go unfiltered only when it is
// listed here WITH its reason — a new one fails until it filters or says why.
const UNFILTERED_ALLOWED: Record<string, string> = {
  "src/hooks/useRecoveryPlaybooks.tsx::recovery_playbooks":
    "system playbooks carry project_id NULL, so a project filter would miss them; " +
    "the table changes only when a playbook is saved",
};

const ROOT = join(__dirname, "..", "..", "..", "..");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (n === "__tests__" || n === "node_modules") return [];
    return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx)$/.test(n) ? [p] : [];
  });
}

describe("every realtime subscription names the rows it wants", () => {
  const found: Array<{ key: string; filtered: boolean }> = [];
  for (const f of files(join(ROOT, "src"))) {
    const src = readFileSync(f, "utf8");
    const re = /"postgres_changes",\s*\{([^}]*)\}/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src))) {
      const table = /table:\s*"([^"]+)"/.exec(m[1])?.[1] ?? "?";
      found.push({ key: `${relative(ROOT, f)}::${table}`, filtered: /\bfilter:/.test(m[1]) });
    }
  }

  it("the scan sees the subscriptions (it would pass vacuously otherwise)", () => {
    expect(found.length).toBeGreaterThanOrEqual(10);
  });

  it("each one is filtered, or allowed with a reason", () => {
    const bad = found.filter((s) => !s.filtered && !UNFILTERED_ALLOWED[s.key]).map((s) => s.key);
    expect(bad).toEqual([]);
  });

  it("the allow-list has no stale entries", () => {
    const unfiltered = new Set(found.filter((s) => !s.filtered).map((s) => s.key));
    expect(Object.keys(UNFILTERED_ALLOWED).filter((k) => !unfiltered.has(k))).toEqual([]);
  });
});
