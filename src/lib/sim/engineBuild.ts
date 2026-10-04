/**
 * The engine a run names, read from its `code_version` — PLAN.md §25 · WP 15.1 · §4 D292.
 *
 * Since WP 15.1 a run records the BUILD that computed it, by content:
 * `scsim-0.6.1+ce3483abda4e` (version + a digest of the engine's source and the
 * worker's compute path, `sim_worker/build.py`). Earlier runs recorded only
 * `scsim-0.6.1`, which two different builds shared — so "same version" never
 * meant "same code", and a run from before WP 15.1 has no build to compare.
 */

export type EngineLabel = {
  /** `scsim`, or `worker-legacy` for the retired engine. */
  slug: string;
  /** Semantic engine version, when the label carries one. */
  version: string | null;
  /** The content digest, when the run was recorded since WP 15.1. */
  build: string | null;
};

export function parseCodeVersion(codeVersion: string | null | undefined): EngineLabel | null {
  const cv = (codeVersion ?? "").trim();
  if (!cv) return null;
  if (!cv.startsWith("scsim-")) return { slug: cv, version: null, build: null };
  const rest = cv.slice("scsim-".length);
  const plus = rest.indexOf("+");
  return plus < 0
    ? { slug: "scsim", version: rest || null, build: null }
    : { slug: "scsim", version: rest.slice(0, plus) || null, build: rest.slice(plus + 1) || null };
}

/** `0.6.1 (build ce3483abda4e)`, or the raw label for anything that is not scsim. */
export function engineLabelText(codeVersion: string | null | undefined): string {
  const p = parseCodeVersion(codeVersion);
  if (!p) return "unknown engine";
  if (p.slug !== "scsim") return p.slug;
  if (!p.version) return codeVersion ?? "scsim";
  return p.build ? `${p.version} (build ${p.build})` : `${p.version} (build not recorded)`;
}

/**
 * Why two runs' engines differ, in words — or null when they are the same build.
 *
 * Three cases a user has to tell apart: different versions; the same version
 * built from different code (D292, live on `main` for a day); and a run from
 * before WP 15.1, whose build nobody can know.
 */
export function engineDifference(
  a: string | null | undefined,
  b: string | null | undefined,
): string | null {
  if (!a || !b || a === b) return null;
  const pa = parseCodeVersion(a);
  const pb = parseCodeVersion(b);
  if (!pa || !pb || pa.slug !== "scsim" || pb.slug !== "scsim" || !pa.version || !pb.version) {
    return `the engines differ (${a} vs ${b})`;
  }
  if (pa.version !== pb.version) {
    return `engine versions differ (${pa.version} vs ${pb.version})`;
  }
  if (!pa.build || !pb.build) {
    return (
      `same engine version ${pa.version}, but one run predates build identity (WP 15.1), ` +
      `so whether it ran the same code is unknown`
    );
  }
  return `same engine version ${pa.version}, different builds (${pa.build} vs ${pb.build})`;
}
