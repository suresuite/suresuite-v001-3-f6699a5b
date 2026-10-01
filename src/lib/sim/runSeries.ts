/**
 * The ONE loader for a run's weekly series — Phase 10 / WP 10.6 · §4 D246.
 *
 * A worker run since WP 10.6 keeps its series in ONE zstd Parquet object in the
 * private `run-results` bucket (`simulation_runs.series_object`), and its
 * replication rows hold `time_series = {}`. Every chart, the warm-up detection
 * and the export read `replication.time_series` — so instead of teaching each of
 * them a second source, the rows are HYDRATED here, once, from the object, and
 * everything downstream is unchanged. An old run (series in its rows) and a
 * browser-computed run (the Pyodide engine writes JSONB) need nothing and get
 * nothing. A run whose series were swept says so — with the RunKey that
 * reproduces them — rather than rendering empty charts (T1).
 *
 * The object is read through a short-lived signed URL `sim-command` mints
 * (`run.series_url`); the Parquet reader and its zstd codec are imported on
 * demand, so they cost the first page nothing.
 */
import { supabase } from "@/integrations/supabase/client";
import { formatBytes } from "./labModel";

export type SeriesByRep = Record<number, Record<string, (number | null)[]>>;

const CELL_COLUMNS = new Set(["rep_index", "model_rep", "event_rep", "week"]);

/** Long-form Parquet rows → rep_index → { series key → weekly values }. A key a
 *  replication never carried (all null) is dropped, so a hydrated row has exactly
 *  the keys the engine wrote for it. */
export function seriesFromRows(rows: Array<Record<string, unknown>>): SeriesByRep {
  const out: SeriesByRep = {};
  const sorted = [...rows].sort(
    (a, b) => Number(a.rep_index) - Number(b.rep_index) || Number(a.week) - Number(b.week),
  );
  for (const row of sorted) {
    const rep = Number(row.rep_index);
    const series = (out[rep] ??= {});
    for (const [k, v] of Object.entries(row)) {
      if (CELL_COLUMNS.has(k)) continue;
      (series[k] ??= []).push(typeof v === "number" ? v : v == null ? null : Number(v));
    }
  }
  for (const series of Object.values(out)) {
    for (const k of Object.keys(series)) {
      if (series[k].every((x) => x === null)) delete series[k];
    }
  }
  return out;
}

/** Parse a series object's bytes. The worker writes zstd and nothing else
 *  (`series_store.write`), so the one codec loaded is `fzstd` — the full
 *  `hyparquet-compressors` set carried a ~120 kB brotli dictionary for codecs no
 *  object of ours uses. */
export async function parseSeriesObject(buf: ArrayBuffer): Promise<SeriesByRep> {
  const [{ parquetReadObjects }, { decompress }] = await Promise.all([import("hyparquet"), import("fzstd")]);
  const compressors = { ZSTD: (input: Uint8Array) => decompress(input) };
  const rows = (await parquetReadObjects({ file: buf, compressors })) as Array<Record<string, unknown>>;
  return seriesFromRows(rows);
}

/** Fill each row's empty `time_series` from the object's series for its index. */
export function hydrateReplications<T extends { rep_index: number; time_series?: unknown }>(
  reps: T[],
  byRep: SeriesByRep,
): T[] {
  return reps.map((r) => {
    const has = r.time_series && typeof r.time_series === "object" && Object.keys(r.time_series).length > 0;
    const fill = byRep[r.rep_index];
    return has || !fill ? r : { ...r, time_series: fill };
  });
}

export type RunSeriesState =
  | { state: "inline" }
  | { state: "loaded"; byRep: SeriesByRep }
  | { state: "expired"; runKey: string | null }
  | { state: "unavailable"; reason: string };

// One fetch per run per page load: an object is immutable once written.
const cache = new Map<string, Promise<RunSeriesState>>();

/** A run's series state, fetching its object when it has one. */
export function fetchRunSeries(
  run: { id: string; project_id: string; series_object?: string | null; series_expired_at?: string | null; run_key?: string | null },
): Promise<RunSeriesState> {
  if (run.series_expired_at) return Promise.resolve({ state: "expired", runKey: run.run_key ?? null });
  if (!run.series_object) return Promise.resolve({ state: "inline" });
  const hit = cache.get(run.id);
  if (hit) return hit;
  const p = (async (): Promise<RunSeriesState> => {
    const { data, error } = await supabase.functions.invoke("sim-command", {
      body: { project_id: run.project_id, kind: "run.series_url", payload: { run_id: run.id }, client_ts: Date.now() },
    });
    if (error) return { state: "unavailable", reason: `the series link could not be minted (${error.message ?? error})` };
    const body = data as { url?: string | null; expired?: boolean; run_key?: string | null };
    if (body?.expired) return { state: "expired", runKey: body.run_key ?? run.run_key ?? null };
    if (!body?.url) return { state: "inline" };
    const res = await fetch(body.url);
    if (!res.ok) return { state: "unavailable", reason: `the series object could not be read (HTTP ${res.status})` };
    return { state: "loaded", byRep: await parseSeriesObject(await res.arrayBuffer()) };
  })();
  cache.set(run.id, p);
  // A failure is not cached: the next load tries again.
  void p.then((s) => {
    if (s.state === "unavailable") cache.delete(run.id);
  });
  return p;
}

/** The replications of `run`, with their series wherever they are kept. */
export async function withRunSeries<T extends { rep_index: number; time_series?: unknown }>(
  run: Parameters<typeof fetchRunSeries>[0] & { status?: string | null },
  reps: T[],
): Promise<{ reps: T[]; series: RunSeriesState }> {
  const series = await fetchRunSeries(run);
  return { reps: series.state === "loaded" ? hydrateReplications(reps, series.byRep) : reps, series };
}

/** What a results surface says when a run's series are not on screen. */
export function seriesNotice(s: RunSeriesState): string | null {
  if (s.state === "expired") {
    return `Series expired — re-run reproduces it${s.runKey ? ` (RunKey ${s.runKey.slice(0, 12)})` : ""}. ` +
      "The run's KPIs and aggregates are kept.";
  }
  if (s.state === "unavailable") return `Weekly series are not shown: ${s.reason}.`;
  return null;
}

/** How long a run keeps its series, from the run's own columns (WP 10.6). */
export function retentionText(run: {
  status?: string | null;
  retention?: string | null;
  series_expires_at?: string | null;
  series_expired_at?: string | null;
  series_bytes?: number | null;
  run_key?: string | null;
}): string | null {
  if (run.status !== "done") return null;
  if (run.series_expired_at) return seriesNotice({ state: "expired", runKey: run.run_key ?? null });
  const size = run.series_bytes != null ? ` · ${formatBytes(run.series_bytes)}` : "";
  if (run.retention === "evidence") return `Series kept — the evidence of a Validated Model${size}`;
  if (run.retention === "pinned") return `Series pinned — kept until released${size}`;
  if (run.series_expires_at) {
    return `Series kept until ${new Date(run.series_expires_at).toLocaleDateString()} (standard retention)${size}`;
  }
  return null;
}
