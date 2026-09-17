/**
 * WP 4.4 · the freshness HOOK and the roll-up, in their own module.
 *
 * They lived beside `FreshnessBadge` until eslint pointed out that a file
 * exporting both a component and a function breaks fast refresh. Splitting them
 * is the better shape anyway: the roll-up is a pure function with a rule in it
 * ("stale beats unknown beats fresh") and a rule worth stating is a rule worth
 * testing without mounting a component.
 */
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { FreshnessPayload } from "@/lib/trust/trustReport";

export function useProjectFreshness(projectId: string | null | undefined) {
  const [data, setData] = useState<FreshnessPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!projectId) { setData(null); return; }
    let cancelled = false;
    setLoading(true);
    supabase
      .rpc("project_freshness", { p_project_id: projectId })
      .then(({ data: d, error: e }) => {
        if (cancelled) return;
        setLoading(false);
        // T1 · a badge that cannot reach its source says so. Rendering "fresh"
        // on a failed call would be a claim with no data behind it.
        if (e) { setError(e.message); setData(null); return; }
        setError(null);
        setData(d as unknown as FreshnessPayload);
      });
    return () => { cancelled = true; };
  }, [projectId]);

  return { freshness: data, error, loading };
}


/** Roll the per-table counts up into the one state a badge can show. */
export function rollUp(f: FreshnessPayload | null): "fresh" | "stale" | "unknown" | "empty" {
  if (!f) return "unknown";
  const t = Object.values(f.tables ?? {});
  const rows = t.reduce((n, v) => n + (v.rows ?? 0), 0);
  if (rows === 0) return "empty";
  // Stale beats unknown beats fresh: the badge reports the WORST state present,
  // because a single stale row is what a reader needs to know about.
  if (t.some((v) => (v.stale ?? 0) > 0)) return "stale";
  if (t.some((v) => (v.unknown ?? 0) > 0)) return "unknown";
  return "fresh";
}

