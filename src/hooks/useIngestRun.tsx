/**
 * ONE STAGED RUN, LOADED FOR REVIEW (Phase 3 / WP 3.4, PLAN.md §10).
 *
 * Reads `ingest_runs`, its `ingest_files` manifest and its `ingest_staged_rows`,
 * and exposes the two actions the review screen has: re-compare, and promote.
 * Both go through the `ingest-file` edge function rather than straight to the
 * RPC, because `ingest_diff_run` and `ingest_apply_run` are granted to
 * `service_role` alone — deliberately. A promotion that the browser could call
 * directly would be a promotion whose role gate lives in the same bundle as the
 * button that hides it.
 *
 * IT READS THE TABLES DIRECTLY AND THAT IS NOT A CONTRADICTION: the three
 * `ingest_*` tables grant SELECT to `authenticated` behind an RLS policy that
 * routes through the run's project (`20260916000014`). Reading a staged row is
 * governed; writing tier 2 is not something the browser may ask for at all.
 *
 * NOTHING HERE BRANCHES ON `source_kind` — §10's gap check for this package.
 * A connector run and a file run are loaded by the same three queries; a
 * connector run simply has no `ingest_staged_rows` and its own staging tables
 * are WP 3.1's, not this screen's.
 */
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { IngestFile, IngestRun, StagedRow } from "@/lib/ingest/runReview";

export interface IngestRunState {
  run: IngestRun | null;
  file: IngestFile | null;
  rows: StagedRow[];
  /** The DATABASE's answer to "may this user promote", returned by the diff. */
  actorRole: string | null;
  canPromote: boolean;
  loading: boolean;
  busy: "diff" | "promote" | null;
  error: string | null;
  reload: () => Promise<void>;
  recompute: () => Promise<void>;
  promote: () => Promise<Record<string, unknown> | null>;
}

export function useIngestRun(runId: string | null, userId: string | null): IngestRunState {
  const [run, setRun] = useState<IngestRun | null>(null);
  const [file, setFile] = useState<IngestFile | null>(null);
  const [rows, setRows] = useState<StagedRow[]>([]);
  const [actorRole, setActorRole] = useState<string | null>(null);
  const [canPromote, setCanPromote] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<"diff" | "promote" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!runId) {
      setRun(null); setFile(null); setRows([]);
      return;
    }
    setLoading(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;
    try {
      const [r, f, s] = await Promise.all([
        sb.from("ingest_runs").select("*").eq("id", runId).maybeSingle(),
        sb.from("ingest_files").select("*").eq("ingest_run_id", runId).maybeSingle(),
        sb.from("ingest_staged_rows").select("*").eq("ingest_run_id", runId)
          .order("source_row_number", { ascending: true }),
      ]);
      if (r.error) throw new Error(r.error.message);
      setRun((r.data ?? null) as IngestRun | null);
      setFile((f.data ?? null) as IngestFile | null);
      setRows((s.data ?? []) as StagedRow[]);
      setError(null);
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
    } finally {
      setLoading(false);
    }
  }, [runId]);

  useEffect(() => { void reload(); }, [reload]);

  /** One call shape for both server actions — the function takes a FormData. */
  const call = useCallback(
    async (mode: "diff" | "apply") => {
      if (!runId || !userId) return null;
      const body = new FormData();
      body.append("mode", mode);
      body.append("run_id", runId);
      body.append("user_id", userId);
      const { data, error: err } = await supabase.functions.invoke("ingest-file", { body });
      if (err) throw new Error(data?.error || err.message);
      if (!data?.success) throw new Error(data?.error || `The ${mode} failed.`);
      return data as Record<string, unknown>;
    },
    [runId, userId],
  );

  const recompute = useCallback(async () => {
    setBusy("diff");
    try {
      const d = await call("diff");
      if (d) {
        setActorRole((d.actor_role as string) ?? null);
        setCanPromote(Boolean(d.actor_may_promote));
      }
      await reload();
      setError(null);
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
    } finally {
      setBusy(null);
    }
  }, [call, reload]);

  // The role is the database's answer and it arrives with the counts, so the
  // screen never has a second opinion about who may promote.
  useEffect(() => { if (runId && userId) void recompute(); }, [runId, userId]); // eslint-disable-line react-hooks/exhaustive-deps

  const promote = useCallback(async () => {
    setBusy("promote");
    try {
      const applied = await call("apply");
      await reload();
      setError(null);
      return applied;
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
      return null;
    } finally {
      setBusy(null);
    }
  }, [call, reload]);

  return { run, file, rows, actorRole, canPromote, loading, busy, error, reload, recompute, promote };
}
