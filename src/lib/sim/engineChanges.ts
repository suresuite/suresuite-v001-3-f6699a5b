/**
 * What an engine version changed, for every surface that names one — PLAN.md §25 · WP 15.6 · §4 D297.
 *
 * Reads the change record (`scsim/CHANGELOG.yaml`, through its generated module)
 * and the release reports (`scsim/docs/releases/<version>.json`, WP 15.5). Both
 * are generated and CI-gated, so nothing here restates a fact about the engine:
 * a comparison, a Validated Model and the manual all read the same entries.
 *
 * Before this module a comparison could say only "engine versions differ" and a
 * stale model only "the engine changed" — correct, and impossible to act on.
 */
import { ENGINE_CHANGES, type EngineChange } from "@/components/docs/generated/engineChangelog.generated";
import { parseCodeVersion } from "./engineBuild";

export type ReleaseKpi = {
  n: number;
  previous?: number;
  current?: number;
  delta?: number;
  ci95?: [number, number];
  verdict: "identical" | "moved" | "within noise" | "not measured";
};

export type ReleaseReport = {
  version: string;
  current_build: string;
  previous_version: string;
  previous_commit: string;
  previous_build: string;
  replications: number;
  kpis_compared: string[];
  cases: Record<string, { previous_build: string; kpis: Record<string, ReleaseKpi> }>;
  moved: string[];
  changed: string[];
};

// Resolved at BUILD time: every committed report, keyed by its version.
const REPORT_FILES = import.meta.glob("../../../scsim/docs/releases/*.json", {
  eager: true,
  import: "default",
}) as Record<string, ReleaseReport>;

export const RELEASE_REPORTS: Record<string, ReleaseReport> = Object.fromEntries(
  Object.values(REPORT_FILES).map((r) => [r.version, r]),
);

/** Semantic order: `0.2.10` after `0.2.9`. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

export const CURRENT_ENGINE: EngineChange = ENGINE_CHANGES[0];

export function changeFor(version: string | null | undefined): EngineChange | null {
  return version ? ENGINE_CHANGES.find((e) => e.version === version) ?? null : null;
}

/** The entries a result crosses going from `from` to `to` (newer side's versions), newest first. */
export function changesBetween(from: string, to: string): EngineChange[] {
  const [lo, hi] = compareVersions(from, to) <= 0 ? [from, to] : [to, from];
  return ENGINE_CHANGES.filter((e) => compareVersions(e.version, lo) > 0 && compareVersions(e.version, hi) <= 0);
}

/** The manual's anchor for a version: `/docs/engine-versions#v0-6-1`. */
export function engineDocHref(versionOrCodeVersion: string | null | undefined): string {
  const v = parseCodeVersion(versionOrCodeVersion)?.version ?? versionOrCodeVersion ?? null;
  return v && changeFor(v) ? `/docs/engine-versions#v${v.replace(/\./g, "-")}` : "/docs/engine-versions";
}

/** Whether any of these entries says it touches one of the given catalog policies. */
export function touchesPolicies(entries: EngineChange[], policyIds: string[]): EngineChange[] {
  const want = new Set(policyIds);
  return entries.filter((e) => e.policies.some((p) => want.has(p)));
}

/**
 * One sentence on what lies between two engines, or null when they are one
 * version (a different BUILD of one version is `engineDifference`'s to say).
 * Names the count, the versions that changed results, and the KPIs they name.
 */
export function engineChangeSummary(
  fromCodeVersion: string | null | undefined,
  toCodeVersion: string | null | undefined,
): string | null {
  const a = parseCodeVersion(fromCodeVersion)?.version;
  const b = parseCodeVersion(toCodeVersion)?.version;
  if (!a || !b || a === b) return null;
  const between = changesBetween(a, b);
  if (between.length === 0) return null;
  const changing = between.filter((e) => e.comparable !== "identical" || e.amendments.length > 0);
  const kpis = [...new Set(changing.flatMap((e) => e.kpis))];
  const n = between.length;
  if (changing.length === 0) {
    return `${n} version${n === 1 ? "" : "s"} between them, none of which changes results`;
  }
  return (
    `${n} version${n === 1 ? "" : "s"} between them; ` +
    `${changing.map((e) => e.version).join(", ")} change${changing.length === 1 ? "s" : ""} results for some projects` +
    (kpis.length ? ` (${kpis.join(", ")})` : "")
  );
}
