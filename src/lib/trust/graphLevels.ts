/**
 * WP 11.1 · §4 D258 — a version per graph LEVEL.
 *
 * `get_graph_version_state` returns, beside the composite snapshot, each level's
 * own state: the level version the live content IS ("Product graph v3"), the
 * latest version, how many there are, and whether the live content is unsaved.
 * This module reads that block and nothing else, so every surface that names a
 * level version names it the same way.
 *
 * `unsaved` is the database's answer, not a comparison made here: a level is
 * unsaved when its live hash matches no version the project ever froze. A level
 * whose hash is null (the snapshot cannot support it) is neither saved nor
 * unsaved — it has no version to name, and says so with `hash: null`.
 */

export const GRAPH_LEVELS = ["product", "process", "firm", "simulation"] as const;
export type GraphLevel = (typeof GRAPH_LEVELS)[number];

export interface LevelVersionRef {
  id: string;
  version_no: number;
  created_at: string;
}

export interface LevelVersionState {
  level: GraphLevel;
  hash: string | null;
  /** The version whose content IS the live data, or null (unsaved, or no hash). */
  currentVersion: LevelVersionRef | null;
  latestVersion: (LevelVersionRef & { level_hash?: string }) | null;
  versionCount: number;
  unsaved: boolean;
}

export type LevelStates = Partial<Record<GraphLevel, LevelVersionState>>;

function ref(v: unknown): LevelVersionRef | null {
  if (!v || typeof v !== "object") return null;
  const r = v as Record<string, unknown>;
  if (typeof r.id !== "string" || typeof r.version_no !== "number") return null;
  return { id: r.id, version_no: r.version_no, created_at: String(r.created_at ?? "") };
}

/** The `levels` block of `get_graph_version_state`, typed. Unknown keys are ignored;
 *  a missing block (a database before WP 11.1) is an empty object, never a guess. */
export function parseLevelStates(raw: unknown): LevelStates {
  const out: LevelStates = {};
  if (!raw || typeof raw !== "object") return out;
  const block = raw as Record<string, unknown>;
  for (const level of GRAPH_LEVELS) {
    const s = block[level];
    if (!s || typeof s !== "object") continue;
    const r = s as Record<string, unknown>;
    const latest = ref(r.latest_version);
    out[level] = {
      level,
      hash: typeof r.hash === "string" ? r.hash : null,
      currentVersion: ref(r.current_version),
      latestVersion: latest
        ? { ...latest, level_hash: typeof (r.latest_version as Record<string, unknown>).level_hash === "string"
            ? String((r.latest_version as Record<string, unknown>).level_hash) : undefined }
        : null,
      versionCount: typeof r.version_count === "number" ? r.version_count : Number(r.version_count ?? 0) || 0,
      unsaved: r.unsaved === true,
    };
  }
  return out;
}
