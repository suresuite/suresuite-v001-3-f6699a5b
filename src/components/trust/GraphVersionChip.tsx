/**
 * WP 10.1 · the graph version a network page is showing, in one line:
 *
 *     Graph v7 · a1b2c3d · metrics computed 14:02 · reused
 *
 * The version is the database's (`dataset_versions.version_no` of the version
 * whose content IS the live data, via ONE read — `get_graph_version_state`, §4
 * D233). The metrics half is the page's own stored answer: when it was computed
 * and whether this load reused it or computed it. Beside it, `FreshnessBadge`
 * says whether the computed rows name the data now loaded — the chip states the
 * version, the badge states the verdict, and neither writes anything.
 *
 * "unsaved" is said when the live data matches no version yet; a version is taken
 * automatically after every promotion, combine and deep-tier upload (§4 D234), so
 * this is the short window between an edit and its version, stated rather than
 * hidden.
 */
import { Badge } from "@/components/ui/badge";
import { useDatasetVersion } from "@/hooks/useDatasetVersion";
import { FreshnessBadge } from "./FreshnessBadge";

export type MetricsOutcome = "reused" | "computed" | "in progress" | "unknown" | null;

export function graphVersionText(args: {
  versionNo: number | null | undefined;
  graphHash: string | null | undefined;
  metricsComputedAt?: string | null;
  outcome?: MetricsOutcome;
  approximation?: boolean;
}): string {
  const parts: string[] = [];
  parts.push(args.versionNo != null ? `Graph v${args.versionNo}` : "Graph unsaved");
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
  metricsComputedAt,
  outcome,
  approximation,
}: {
  projectId: string | null | undefined;
  metricsComputedAt?: string | null;
  outcome?: MetricsOutcome;
  /** true when the page is showing a figure it computed itself and did not store */
  approximation?: boolean;
}) {
  const ds = useDatasetVersion(projectId);
  if (!projectId) return null;
  const text = graphVersionText({
    versionNo: ds.currentVersion?.version_no ?? null,
    graphHash: ds.currentHash,
    metricsComputedAt,
    outcome,
    approximation,
  });
  return (
    <div className="flex flex-wrap items-center gap-1.5" data-testid="graph-version-chip">
      <Badge variant="outline" className="font-mono text-[11px]" title="The graph version this page shows, and the stored metrics it read">
        {ds.loading && !ds.currentHash ? "Graph version…" : text}
      </Badge>
      <FreshnessBadge projectId={projectId} />
    </div>
  );
}
