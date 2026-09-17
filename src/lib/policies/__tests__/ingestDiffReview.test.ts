/**
 * THE DIFF, THE ROLE GATE AND THE ONE REVIEW COMPONENT
 * (Phase 3 / WP 3.4, PLAN.md §10).
 *
 * `supabase/rehearsal/100` asserts what the DATABASE does — that an analyst is
 * refused, that `diff_state` is computed rather than defaulted, that a
 * NULL-bearing natural key diffs the way the upsert matches. This file asserts
 * the three things a running database cannot see:
 *
 *   · that the SQL still says what the rehearsal proved, so a later edit that
 *     reinstates the default or drops the role check fails here before it ever
 *     reaches a database (the rehearsal needs PostgreSQL; this needs nothing);
 *   · that the review screen branches on `source_kind` for LABELS AND NOTHING
 *     ELSE — §10's gap check for this package, and a claim about absence, which
 *     decays the first time somebody adds a convenience unless a test holds it;
 *   · that the diff vocabulary in TypeScript is the CHECK constraint's, because
 *     a screen rendering a fifth state the database cannot store is a screen
 *     showing a category that will always be empty (invariant `single-source`).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DIFF_LABEL,
  SOURCE_LABEL,
  countsDisagree,
  diffLabel,
  provenanceText,
  removalNote,
  reviewCounts,
  rowReason,
  rowState,
  sourceLabel,
  type IngestRun,
  type StagedRow,
} from "../../ingest/runReview";

const ROOT = join(__dirname, "..", "..", "..", "..");
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), "utf8");

const STAGED_SQL = read("supabase", "migrations", "20260916000014_ingest_staged_rows.sql");
const DIFF_SQL = read("supabase", "migrations", "20260917000001_diff_before_promotion.sql");
const REVIEW = read("src", "components", "ingest", "IngestRunReview.tsx");
const LOGIC = read("src", "lib", "ingest", "runReview.ts");
const HOOK = read("src", "hooks", "useIngestRun.tsx");
const FUNCTION = read("supabase", "functions", "ingest-file", "index.ts");

const squash = (s: string) => s.replace(/\s+/g, " ");
/** Source with comments removed — a rule about code must not be met or broken by prose. */
const code = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");

/** The body of the LAST definition of a function across the migrations given. */
function fnBody(sql: string, name: string): string {
  const at = sql.lastIndexOf(`CREATE OR REPLACE FUNCTION public.${name}`);
  expect(at, `no migration defines ${name}`).toBeGreaterThan(-1);
  const end = sql.indexOf("$fn$;", at);
  return sql.slice(at, end === -1 ? undefined : end);
}

describe("`diff_state` stopped claiming to know (§4 D62)", () => {
  it("the column's DEFAULT and NOT NULL are both dropped", () => {
    const stmt = squash(DIFF_SQL).match(
      /ALTER TABLE public\.ingest_staged_rows ALTER COLUMN diff_state[^;]+;/,
    )?.[0];
    expect(stmt, "nothing alters ingest_staged_rows.diff_state").toBeTruthy();
    expect(stmt).toMatch(/DROP DEFAULT/);
    expect(stmt).toMatch(/DROP NOT NULL/);
  });

  it("the CHECK vocabulary is untouched — one component, both sources", () => {
    // A fifth token here would be the branch §10's gap check forbids, arriving
    // as a vocabulary rather than as an `if`.
    expect(STAGED_SQL).toMatch(
      /CHECK \(diff_state IN \('new', 'changed', 'unchanged', 'removed_upstream'\)\)/,
    );
    expect(DIFF_SQL).not.toMatch(/ingest_staged_rows_diff_state_check/);
  });

  it("the screen's diff vocabulary IS the CHECK's, token for token", () => {
    const check = [...STAGED_SQL.matchAll(
      /CHECK \(diff_state IN \(([^)]+)\)\)/g,
    )][0][1];
    const tokens = [...check.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
    expect(Object.keys(DIFF_LABEL).sort()).toEqual(tokens);
  });

  it("a null renders as `not compared`, never as `new`", () => {
    expect(diffLabel(null)).toBe("not compared");
    expect(diffLabel(undefined)).toBe("not compared");
    expect(diffLabel("new")).toBe("new");
  });
});

describe("the promotion has a role gate (§10's exit check, §4 D65)", () => {
  const apply = squash(fnBody(DIFF_SQL, "ingest_apply_run"));

  it("it reads effective_project_role and compares against editor", () => {
    expect(apply).toMatch(/effective_project_role\(_actor_user_id, v_run\.project_id\)/);
    expect(apply).toMatch(/project_role_rank\(v_role\) < public\.project_role_rank\('editor'\)/);
    expect(apply).toMatch(/insufficient_privilege/);
  });

  it("it does not ALSO gate on has_project_access", () => {
    // Two authorities for one question is `single-source` broken in the
    // governance plane — and `has_project_access` is "modeler or platform
    // admin", so keeping it would refuse an EDITOR who is not the modeler,
    // which is the entire point of having editors.
    expect(apply).not.toMatch(/has_project_access/);
  });

  it("a new project's modeler becomes a member, or the gate refuses everybody", () => {
    // §4 D61. WP 2.2 backfilled `project_members` once and left no writer.
    expect(DIFF_SQL).toMatch(/CREATE TRIGGER projects_owner_membership\s+AFTER INSERT ON public\.projects/);
    expect(squash(DIFF_SQL)).toMatch(/INSERT INTO public\.project_members[^;]+ON CONFLICT \(project_id, user_id\) DO NOTHING/);
  });
});

describe("the counts are persisted where they were measured (§4 D63, D64)", () => {
  const apply = squash(fnBody(DIFF_SQL, "ingest_apply_run"));
  const diff = squash(fnBody(DIFF_SQL, "ingest_diff_run"));

  it("the promotion no longer writes rows_new = the upsert total", () => {
    expect(apply).not.toMatch(/rows_new\s*=\s*v_total/);
  });

  it("the promotion no longer writes the held-back count into rows_removed", () => {
    expect(apply).not.toMatch(/rows_removed\s*=\s*v_held/);
  });

  it("the diff writes all five counts, and rows_removed as a literal zero", () => {
    expect(diff).toMatch(/rows_new\s*=\s*v_new/);
    expect(diff).toMatch(/rows_changed\s*=\s*v_changed/);
    expect(diff).toMatch(/rows_unchanged\s*=\s*v_unchanged/);
    expect(diff).toMatch(/rows_held\s*=\s*v_held/);
    expect(diff).toMatch(/rows_superseded\s*=\s*v_supers/);
    expect(diff).toMatch(/rows_removed\s*=\s*0/);
  });

  it("nothing on the file path ever writes `removed_upstream`", () => {
    // Decided in writing (§10 asked): a connector PULL speaks for the whole
    // source; a FILE speaks only for the rows it contains.
    expect(diff).not.toMatch(/'removed_upstream'/);
  });
});

describe("the diff is computed before the promotion, and again during it", () => {
  const apply = squash(fnBody(DIFF_SQL, "ingest_apply_run"));

  it("ingest_apply_run runs the diff in its own transaction", () => {
    expect(apply).toMatch(/v_diff\s*:=\s*public\.ingest_diff_run\(_run_id, _actor_user_id\)/);
  });

  it("and refuses when the diff and the upsert disagree about what existed", () => {
    expect(apply).toMatch(/v_updated\s*<>\s*v_expect/);
    expect(apply).toMatch(/serialization_failure/);
  });

  it("the landing stages and diffs; it does not promote", () => {
    // WP 3.2's `ingest-file` called `ingest_apply_run` on the way past, which
    // makes both the review screen and the role gate unreachable.
    // From the LANDING CALL, not from the first mention of it — the word
    // appears in the file's header comment, and slicing there would have swept
    // in the `apply` mode block above it and made this assertion vacuous.
    const land = FUNCTION.slice(FUNCTION.indexOf('rpc("ingest_land_file"'));
    expect(land).toMatch(/rpc\("ingest_diff_run"/);
    expect(land).not.toMatch(/rpc\("ingest_apply_run"/);
    // It is reachable, but only from the mode a person's click sends.
    expect(FUNCTION).toMatch(/mode === "apply"/);
    expect(FUNCTION).toMatch(/rpc\("ingest_apply_run"/);
  });
});

describe("one component serves both sources — §10's gap check", () => {
  it("the review screen reads source_kind only through the label table", () => {
    // Anything but `sourceLabel(...)` — an ===, a ternary, an indexed lookup —
    // is the branch WP 3.1 was supposed to make unnecessary. Comments are
    // stripped first: this file explains the rule at length, and a test that
    // counted the explanation would fail for the wrong reason.
    const uses = [...code(REVIEW).matchAll(/source_kind/g)].length;
    const throughLabel = [...code(REVIEW).matchAll(/sourceLabel\(run\.source_kind\)/g)].length;
    const throughRemoval = [...code(REVIEW).matchAll(/removalNote\(run\.source_kind\)/g)].length;
    expect(uses).toBe(throughLabel + throughRemoval);
    expect(REVIEW).not.toMatch(/source_kind\s*===/);
    expect(REVIEW).not.toMatch(/source_kind\s*!==/);
  });

  it("the hook that loads a run does not branch on it either", () => {
    expect(HOOK).not.toMatch(/source_kind\s*[=!]==/);
  });

  it("the only conditional on a source anywhere is the label lookup itself", () => {
    // In the logic module the token appears in `SOURCE_LABEL`, `sourceLabel`
    // and `removalNote` — the last is a SENTENCE chosen per source, which is a
    // label with more words, and it is named here so the exemption is explicit
    // rather than accidental.
    const conditionals = [...code(LOGIC).matchAll(/kind\s*===\s*"([a-z-]+)"/g)].map((m) => m[1]);
    expect(conditionals).toEqual(["csv"]);
    expect(removalNote("csv")).toMatch(/cannot remove rows/);
    expect(removalNote("orbit-mrp")).toMatch(/no longer offers/);
  });

  it("the label table covers exactly the source_kind CHECK's vocabulary", () => {
    const check = STAGED_SQL.match(/CHECK \(source_kind IN \(([^)]+)\)\)/)![1];
    const tokens = [...check.matchAll(/'([a-z-]+)'/g)].map((m) => m[1]).sort();
    expect(Object.keys(SOURCE_LABEL).sort()).toEqual(tokens);
    expect(sourceLabel("csv")).toBe("uploaded file");
    expect(sourceLabel(null)).toBe("unknown source");
  });

  it("the badge vocabulary is imported, not re-declared", () => {
    // §10: "reuse `MappingWarningsCard`'s badge vocabulary rather than
    // inventing a second". A vocabulary you cannot import is one you copy.
    expect(REVIEW).toMatch(/import \{ WARN_META \} from "@\/components\/sim\/RunProgressPanel"/);
    expect(REVIEW).not.toMatch(/const WARN_META/);
    expect(read("src", "components", "sim", "RunProgressPanel.tsx")).toMatch(/export const WARN_META/);
  });
});

describe("three row states, not two", () => {
  const row = (findings: StagedRow["findings"]): StagedRow => ({
    id: "r", source_row_number: 2, raw: {}, parsed: {}, findings,
    diff_state: "new", target_table: "inbound_logistics",
  });

  it("a clean row promotes", () => {
    expect(rowState(row([]))).toBe("promoted");
    expect(rowReason(row([]))).toBeNull();
  });

  it("an error holds the row back, and the reason is the error", () => {
    const r = row([{ level: "error", message: "volume is blank", code: "blank" }]);
    expect(rowState(r)).toBe("held");
    expect(rowReason(r)?.message).toBe("volume is blank");
  });

  it("a superseded row is its own state, and names the line that beat it", () => {
    const r = row([{
      level: "warning", code: "superseded_by_later_line",
      message: "Row 2 repeats a row already in this file; row 5 carries the same key and supersedes it.",
    }]);
    expect(rowState(r)).toBe("superseded");
    expect(rowReason(r)?.message).toMatch(/row 5/);
  });

  it("an error outranks a supersession — a held row is never shown as promoted", () => {
    const r = row([
      { level: "warning", code: "superseded_by_later_line", message: "…" },
      { level: "error", message: "volume is blank" },
    ]);
    expect(rowState(r)).toBe("held");
  });
});

describe("the five counts partition the file, and say so when they do not", () => {
  const run = (o: Partial<IngestRun>): IngestRun => ({
    id: "run", project_id: "p", source_kind: "csv", status: "staged",
    rows_new: 0, rows_changed: 0, rows_unchanged: 0, rows_removed: 0,
    rows_held: 0, rows_superseded: 0, mapping_warnings: null, applied_at: null, ...o,
  });

  it("willPromote is the three diff states and nothing else", () => {
    const c = reviewCounts(run({ rows_new: 2, rows_changed: 3, rows_unchanged: 4, rows_held: 1, rows_superseded: 1 }));
    expect(c.willPromote).toBe(9);
    expect(c.accountedFor).toBe(11);
  });

  it("silent when the buckets add up", () => {
    expect(countsDisagree(run({ rows_new: 2, rows_held: 1 }), 3)).toBeNull();
  });

  it("and loud when they do not — §5 T3", () => {
    const msg = countsDisagree(run({ rows_new: 2 }), 5);
    expect(msg).toMatch(/staged 5 row\(s\)/);
    expect(msg).toMatch(/account for 2/);
  });
});

describe("a NULL provenance is unknown, never absent", () => {
  it("says so, and says why", () => {
    const { text, known } = provenanceText(null);
    expect(known).toBe(false);
    expect(text).toMatch(/unknown/i);
    expect(text).toMatch(/not a row that came from nowhere/);
  });

  it("names the file and the physical line when it has them", () => {
    const { text, known } = provenanceText({
      filename: "inbound.csv", line: 47, sha256: "a".repeat(64), runId: "r",
    });
    expect(known).toBe(true);
    expect(text).toBe("inbound.csv · line 47");
  });

  it("a staged row that outlived its file still yields the line", () => {
    // Both FK columns are ON DELETE SET NULL and the hops are separate reads
    // for exactly this: a partial answer is most of what a person wanted.
    expect(provenanceText({ filename: null, line: 12, sha256: null, runId: "r" }).known).toBe(true);
  });
});
