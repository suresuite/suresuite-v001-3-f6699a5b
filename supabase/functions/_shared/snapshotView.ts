// The frozen inputs a library pulls — Phase 12 · WP 12.2.
//
// `GET /v1/projects/{id}/dataset-versions/{vid}` returns a dataset version's
// snapshot: the tier-2 rows a run was (or will be) computed from, exactly as
// `_build_dataset_snapshot` froze them. Pure functions here so the gateway's
// behaviour is testable without a database (`snapshotView.test.ts`).
//
// Two snapshot shapes exist and both are served as stored — nothing rewrites a
// frozen version (dataset_versions sidecar, `snapshot`): schema_version 2 puts
// tables under `inputs` (what a simulation reads) and `network` (what the
// analyses read); v1 holds them at the top level.

export type Snapshot = Record<string, unknown>;

/** The table names a snapshot holds, by domain. */
export function snapshotTables(snapshot: Snapshot): { inputs: string[]; network: string[] } {
  const v2 = typeof snapshot.inputs === "object" && snapshot.inputs !== null;
  const names = (o: unknown) =>
    o && typeof o === "object" ? Object.keys(o as Record<string, unknown>).filter((k) => Array.isArray((o as Record<string, unknown>)[k])) : [];
  return v2
    ? { inputs: names(snapshot.inputs), network: names(snapshot.network) }
    : { inputs: names(snapshot), network: [] };
}

/**
 * Keep only the named tables (`?tables=suppliers,inbound`), preserving the
 * snapshot's own shape and its non-table fields (`schema_version`). Unknown
 * names are reported, not ignored — a typo should not read as an empty table.
 */
export function selectTables(
  snapshot: Snapshot,
  wanted: string[] | null,
): { snapshot: Snapshot; unknown: string[] } {
  if (!wanted || wanted.length === 0) return { snapshot, unknown: [] };
  const have = snapshotTables(snapshot);
  const all = new Set([...have.inputs, ...have.network]);
  const unknown = wanted.filter((t) => !all.has(t));
  const keep = new Set(wanted);
  const pick = (o: unknown) =>
    Object.fromEntries(
      Object.entries((o ?? {}) as Record<string, unknown>).filter(([k, v]) => !Array.isArray(v) || keep.has(k)),
    );
  const v2 = typeof snapshot.inputs === "object" && snapshot.inputs !== null;
  const out = v2
    ? { ...snapshot, inputs: pick(snapshot.inputs), ...(snapshot.network ? { network: pick(snapshot.network) } : {}) }
    : pick(snapshot);
  return { snapshot: out, unknown };
}

/** Parse `?tables=a,b` into a list (null when absent). */
export function tablesParam(url: URL): string[] | null {
  const raw = url.searchParams.get("tables");
  if (raw === null) return null;
  return raw.split(",").map((t) => t.trim()).filter(Boolean).slice(0, 50);
}

/** Compress a response only when the client accepts gzip and it is worth it. */
export const GZIP_MIN_BYTES = 32 * 1024;
export function wantsGzip(acceptEncoding: string | null, bytes: number): boolean {
  return bytes >= GZIP_MIN_BYTES && /\bgzip\b/i.test(acceptEncoding ?? "");
}

export async function gzip(text: string): Promise<Uint8Array> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
