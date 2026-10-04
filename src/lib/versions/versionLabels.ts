// The version vocabulary — ONE place that says how a model, its data and its
// policies are named to a person (WP 10.5 follow-up, blueprint §8.4 · §9.5).
//
//     2026Q3 - Data 20260915 - Policy 20261004
//
// The codes are STORED by the database (`20261004000001_version_codes.sql`):
//   · `model_validations.model_code` — the planning period the modeller chose, `-n`
//     for the n-th model of that period;
//   · `graph_level_versions.version_code` (simulation level) — the UTC day the
//     simulation inputs first had this content, `-n` for the n-th that day;
//   · `policy_versions.version_code` — the same rule for policy content.
// This module only FORMATS them. Where a code is absent (a row read before the
// migration, a model saved before periods existed) the per-table `vN` is shown and
// says so — never a code computed here (T1: no number without a source).

/** "2026Q3" — the quarter a date falls in, by the viewer's calendar. */
export function quarterOf(d: Date): string {
  return `${d.getFullYear()}Q${Math.floor(d.getMonth() / 3) + 1}`;
}

/** The periods a model can be saved for: two years back to one ahead, newest first. */
export function planningPeriodOptions(now: Date = new Date()): string[] {
  const out: string[] = [];
  const y = now.getFullYear();
  for (let year = y + 1; year >= y - 2; year--) {
    for (let q = 4; q >= 1; q--) out.push(`${year}Q${q}`);
  }
  return out;
}

export const PLANNING_PERIOD_RE = /^\d{4}Q[1-4]$/;

interface CodedVersion {
  version_code?: string | null;
  version_no?: number | null;
}

/** "Policy 20261004" — or "Policy v4" before the row carries a code. */
export function policyRef(v: CodedVersion | null | undefined): string | null {
  if (!v) return null;
  if (v.version_code) return `Policy ${v.version_code}`;
  return v.version_no != null ? `Policy v${v.version_no}` : null;
}

/** "Data 20260915" — the simulation inputs' code, or "Data v2" before it carries one. */
export function dataRef(v: CodedVersion | null | undefined): string | null {
  if (!v) return null;
  if (v.version_code) return `Data ${v.version_code}`;
  return v.version_no != null ? `Data v${v.version_no}` : null;
}

interface ModelLike {
  name?: string | null;
  version_no?: number | null;
  model_code?: string | null;
}

/** "2026Q3-2" — or "v1 · no period" for a model saved before periods existed. */
export function modelRef(m: ModelLike): string {
  if (m.model_code) return m.model_code;
  return m.version_no != null ? `v${m.version_no} · no period` : "no period";
}

/** The default name the database gives a model nobody named — not worth repeating. */
const DEFAULT_MODEL_NAME = "Validated model";

/** "2026Q3 - Data 20260915 - Policy 20261004 · Q4 baseline". The data and policy
 *  parts are omitted when not loaded, never guessed. */
export function modelCodeLine(
  m: ModelLike,
  refs?: { data?: string | null; policy?: string | null } | null,
): string {
  const head = [modelRef(m), refs?.data ?? null, refs?.policy ?? null].filter(Boolean).join(" - ");
  const name = m.name?.trim();
  return name && name !== DEFAULT_MODEL_NAME ? `${head} · ${name}` : head;
}

/** "1 replication · 53 weeks · results from wk 5" — `?` for a value not recorded. */
export function protocolText(p: {
  replications?: number | null;
  warmup_week?: number | null;
  horizon_weeks?: number | null;
}): string {
  const part = (v: number | null | undefined, f: (x: number) => string) => (v == null ? "?" : f(v));
  return [
    part(p.replications, (x) => `${x} ${x === 1 ? "replication" : "replications"}`),
    part(p.horizon_weeks, (x) => `${x} ${x === 1 ? "week" : "weeks"}`),
    part(p.warmup_week, (x) => `results from wk ${x}`),
  ].join(" · ");
}

/** "scsim 0.6.1" — the build only when it is not simply `<slug>-<version>`; the
 *  name's description (after " — ") goes to the tooltip. */
export function engineLabel(e: {
  slug: string;
  name: string;
  version: string | null;
  code_version: string | null;
}): { label: string; title: string } {
  const [short, ...rest] = e.name.split(" — ");
  const plainBuild = e.version != null && e.code_version === `${e.slug}-${e.version}`;
  const label = [
    short.trim(),
    e.version ?? null,
    e.code_version ? (plainBuild ? null : `build ${e.code_version}`) : "build ?",
  ]
    .filter(Boolean)
    .join(" ");
  const title = [rest.join(" — ").trim() || null, e.code_version ? `build ${e.code_version}` : "build not reported"]
    .filter(Boolean)
    .join(" · ");
  return { label, title };
}

/** Auto-saved labels used to end in the saving browser's date ("Run: X — 9/30/2026,
 *  11:21:19 AM"); the card shows the date from `created_at`, so the copy goes. */
export function stripLegacyDate(label: string): string {
  return label.replace(/\s+—\s+\d{1,4}[/.-]\d{1,2}[/.-]\d{1,4}(,?\s.*)?$/, "").trim();
}

/** "used by 3 runs · 1 model" — why a version cannot be deleted; null when unused. */
export function usageText(runCount?: number | null, cardCount?: number | null): string | null {
  const runs = runCount ?? 0;
  const cards = cardCount ?? 0;
  if (runs + cards === 0) return null;
  const parts = [
    runs > 0 ? `${runs} ${runs === 1 ? "run" : "runs"}` : null,
    cards > 0 ? `${cards} ${cards === 1 ? "model" : "models"}` : null,
  ].filter(Boolean);
  return `used by ${parts.join(" · ")}`;
}
