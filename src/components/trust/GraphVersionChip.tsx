/**
 * WP 10.1 · the graph version a network page is showing, in one line — and since
 * WP 11.3 the version of THE LEVEL the page shows (§4 D258):
 *
 *     Product graph v3 · a1b2c3d · metrics computed 14:02 · reused
 *
 * The version is the database's: the `graph_level_versions` row whose content is the
 * page's live level hash, via ONE read (`get_graph_version_state`, §4 D233). A change
 * to another level — a deep-tier upload on the product page — moves nothing here. The
 * snapshot's whole tuple ("snapshot v9 · P3 · R2 · F5 · S4") is the title. The metrics
 * half is the page's own stored answer. Beside it, `FreshnessBadge` says whether the
 * computed rows name the data now loaded — the chip states the version, the badge
 * states the verdict, and neither writes anything.
 *
 * "unsaved" is said per level when the live content matches no version yet; a version
 * is taken automatically after every promotion, combine and deep-tier upload (§4
 * D234), so this is the short window between an edit and its version, stated rather
 * than hidden.
 */
import { Badge } from "@/components/ui/badge";
import { useDatasetVersion } from "@/hooks/useDatasetVersion";
import { LEVEL_LABEL, snapshotTupleTitle, type GraphLevel } from "@/lib/trust/graphLevels";
import { FreshnessBadge } from "./FreshnessBadge";

export type MetricsOutcome = "reused" | "computed" | "in progress" | "unknown" | null;

export function graphVersionText(args: {
  versionNo: number | null | undefined;
  graphHash: string | null | undefined;
  metricsComputedAt?: string | null;
  outcome?: MetricsOutcome;
  approximation?: boolean;
  /** WP 11.3 — the level the version is OF. Omitted = the composite snapshot. */
  level?: GraphLevel;
}): string {
  const parts: string[] = [];
  const name = args.level ? LEVEL_LABEL[args.level] : "Graph";
  parts.push(args.versionNo != null ? `${name} v${args.versionNo}` : `${name} unsaved`);
  if (args.graphHash) parts.push(args.graphHash.slice(0, 7));
  if (args.approximation) {
    parts.push("approximation, not stored");
  } else if (args.metricsComputedAt) {
    const t = new Date(args.metricsComputedAt);
    const hhmm = `${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}`;
    parts.push(`metrics computed ${hhmm}`);
  } else {
    parts.push("no stored metrics");
  }
  if (args.outcome && args.outcome !== "unknown") parts.push(args.outcome);
  return parts.join(" · ");
}

export function GraphVersionChip({
  projectId,
  level,
  metricsComputedAt,
  outcome,
  approximation,
}: {
  projectId: string | null | undefined;
  /** WP 11.3 — the level this page shows. Omitted = the composite (as before). */
  level?: Exclude<GraphLevel, "simulation">;
  metricsComputedAt?: string | null;
  outcome?: MetricsOutcome;
  /** true when the page is showing a figure it computed itself and did not store */
  approximation?: boolean;
}) {
  const ds = useDatasetVersion(projectId);
  if (!projectId) return null;
  // A database before WP 11.1 has no levels block: the page says the composite, as
  // it did, rather than "unsaved" for a level the database cannot number.
  const lvl = level ? ds.levels[level] : undefined;
  const text = level && lvl
    ? graphVersionText({
        level,
        versionNo: lvl.currentVersion?.version_no ?? null,
        graphHash: lvl.hash,
        metricsComputedAt, outcome, approximation,
      })
    : graphVersionText({
        versionNo: ds.currentVersion?.version_no ?? null,
        graphHash: ds.currentHash,
        metricsComputedAt, outcome, approximation,
      });
  return (
    <div className="flex flex-wrap items-center gap-1.5" data-testid="graph-version-chip">
      <Badge
        variant="outline"
        className="font-mono text-[11px]"
        title={snapshotTupleTitle(ds.currentVersion?.version_no ?? null, ds.levels)}
      >
        {ds.loading && !ds.currentHash ? "Graph version…" : text}
      </Badge>
      <FreshnessBadge projectId={projectId} />
    </div>
  );
}
