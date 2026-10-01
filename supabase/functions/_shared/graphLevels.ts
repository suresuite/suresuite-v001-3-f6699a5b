/**
 * Lives in `_shared/` (WP 11.3) so the Trust Report — computed in the browser AND by
 * the agent's `get_data_trust_report` tool — names a level version with the same code
 * the pages use; `src/lib/trust/graphLevels.ts` re-exports it, as `trustReport.ts` does.
 *
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

// ── WP 11.3 · how a level version is SAID, once ─────────────────────────────

export const LEVEL_LABEL: Record<GraphLevel, string> = {
  product: "Product graph",
  process: "Process graph",
  firm: "Firm graph",
  simulation: "Simulation inputs",
};

/** The short letter a snapshot's tuple uses: P3 · R2 · F5 · S4. */
export const LEVEL_LETTER: Record<GraphLevel, string> = {
  product: "P",
  process: "R",
  firm: "F",
  simulation: "S",
};

/** "Product graph v3", "Product graph unsaved", or null when the level has no hash. */
export function levelVersionText(level: GraphLevel, state: LevelVersionState | null | undefined): string | null {
  if (!state || state.hash === null) return null;
  return state.currentVersion
    ? `${LEVEL_LABEL[level]} v${state.currentVersion.version_no}`
    : `${LEVEL_LABEL[level]} unsaved`;
}

/** A snapshot's tuple — "P3 · R2 · F5 · S4" — from whatever numbers are known. A
 *  missing level is "?", never omitted: an absent number is a fact to show (T1). */
export function tupleText(numbers: Partial<Record<GraphLevel, number | null>>): string {
  return GRAPH_LEVELS.map((l) => `${LEVEL_LETTER[l]}${numbers[l] ?? "?"}`).join(" · ");
}

/** The numbers of a `dataset_version_tuple` payload (`list_dataset_versions.tuple`). */
export function tupleNumbers(raw: unknown): Partial<Record<GraphLevel, number | null>> & { snapshot: number | null } {
  const out: Partial<Record<GraphLevel, number | null>> & { snapshot: number | null } = { snapshot: null };
  if (!raw || typeof raw !== "object") return out;
  const t = raw as Record<string, unknown>;
  out.snapshot = typeof t.version_no === "number" ? t.version_no : null;
  for (const l of GRAPH_LEVELS) {
    const v = t[l] as { version_no?: unknown } | null | undefined;
    out[l] = v && typeof v.version_no === "number" ? v.version_no : null;
  }
  return out;
}

/** The chip's title: the snapshot and its tuple, each level current or unsaved. */
export function snapshotTupleTitle(snapshotNo: number | null | undefined, levels: LevelStates): string {
  const numbers = Object.fromEntries(
    GRAPH_LEVELS.map((l) => [l, levels[l]?.currentVersion?.version_no ?? null]),
  );
  const unsaved = GRAPH_LEVELS.filter((l) => levels[l]?.unsaved).map((l) => LEVEL_LABEL[l].toLowerCase());
  return [
    `${snapshotNo != null ? `Snapshot v${snapshotNo}` : "Snapshot unsaved"} · ${tupleText(numbers)}`,
    unsaved.length ? `unsaved: ${unsaved.join(", ")}` : null,
  ].filter(Boolean).join(" — ");
}
