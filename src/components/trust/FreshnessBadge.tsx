/**
 * WP 4.4 · the freshness badge — dataset version, hash prefix, computed-at,
 * stale flag, in one line beside the thing it describes.
 *
 * IT SHOWS THREE STATES AND NOT TWO, which is the whole reason `freshness_of`
 * returns three. A row written before WP 4.3 carries no input hash; rendering
 * that as "out of date" tells a user a number is wrong when the truth is that
 * nothing can say, which is T1 ("no number without a source") answered with a
 * guess that happens to be cautious.
 *
 * AND IT NEVER WRITES. The state is computed at read time (§4 D70): a project
 * whose dataset moves and moves back shows fresh again with nothing rewritten.
 * That is the invariant this component is the visible half of.
 */
import { AlertTriangle, CheckCircle2, HelpCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { FreshnessPayload } from "@/lib/trust/trustReport";

import { rollUp, useProjectFreshness } from "./useProjectFreshness";

export function FreshnessBadge({ projectId }: { projectId: string | null | undefined }) {
  const { freshness, error, loading } = useProjectFreshness(projectId);

  if (!projectId) return null;
  if (loading) return <Badge variant="outline">checking freshness…</Badge>;
  if (error) {
    return (
      <Badge variant="outline" className="border-amber-500 text-amber-700">
        freshness unavailable
      </Badge>
    );
  }
  if (!freshness) return null;

  const state = rollUp(freshness);
  const version = (freshness.dataset_version?.version ?? freshness.dataset_version?.label) as string | undefined;
  const computedAt = Object.values(freshness.tables ?? {})
    .map((t) => t.computed_at)
    .filter(Boolean)
    .sort()
    .pop();

  const look = {
    fresh:   { icon: CheckCircle2,   cls: "border-emerald-500 text-emerald-700", label: "current" },
    stale:   { icon: AlertTriangle,  cls: "border-amber-500 text-amber-700",     label: "out of date" },
    unknown: { icon: HelpCircle,     cls: "border-slate-400 text-slate-600",     label: "provenance unknown" },
    empty:   { icon: HelpCircle,     cls: "border-slate-300 text-slate-500",     label: "nothing computed" },
  }[state];
  const Icon = look.icon;

  const stale = Object.values(freshness.tables ?? {}).reduce((n, v) => n + (v.stale ?? 0), 0);
  const unknown = Object.values(freshness.tables ?? {}).reduce((n, v) => n + (v.unknown ?? 0), 0);
  const staleOverrides = freshness.tables?.policy_overrides?.stale ?? 0;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge variant="outline" className={`gap-1 ${look.cls}`}>
            <Icon className="h-3 w-3" />
            {look.label}
            {version ? <span className="opacity-70">· {version}</span> : null}
            {freshness.graph_hash_short
              ? <span className="font-mono opacity-70">· {freshness.graph_hash_short}</span>
              : null}
          </Badge>
        </TooltipTrigger>
        <TooltipContent className="max-w-sm space-y-1 text-xs">
          <div className="font-medium">
            {state === "fresh" && "Every computed row names the dataset now loaded."}
            {state === "stale" && `${stale} computed row(s) were produced from a different dataset.`}
            {state === "unknown" && `${unknown} computed row(s) carry no input hash, so nothing can say whether they are current.`}
            {state === "empty" && "No analysis has run against this project yet."}
          </div>
          {staleOverrides > 0 && (
            <div className="text-amber-700">
              {staleOverrides} policy override(s) were seeded from data this project
              no longer holds. The engine reads overrides rather than the grid, so a
              run would use the seeded number — this is a simulation-correctness
              problem, not a display one.
            </div>
          )}
          {computedAt && <div className="opacity-70">Last computed {new Date(computedAt).toLocaleString()}</div>}
          <div className="opacity-70">Measured {new Date(freshness.measured_at).toLocaleString()} · nothing was written to produce this.</div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
