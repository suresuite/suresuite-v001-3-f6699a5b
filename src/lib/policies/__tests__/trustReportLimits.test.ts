/**
 * The Trust Report's "known limits" block may not cite a CLOSED defect — §4 D103.
 *
 * ── WHY THIS TEST EXISTS ───────────────────────────────────────────────────
 *
 * `knownLimits()` has two halves. The conditional half recomputes from this
 * project's own numbers on every render, so it cannot go stale. The ALWAYS-TRUE
 * half is prose, authored inside a TypeScript module, and it is the half nothing
 * recomputed — so it outlived the defects it described and went on being
 * published to users on every project:
 *
 *   · "The dataset hash does not cover the deep-tier network" cited §4 D75,
 *     which `20260917000009` closed by folding the six deep-tier topology
 *     columns into `hash_network` at `schema_version` 3. The report told a
 *     reader their centrality figures were keyed on a separate anchor when they
 *     were keyed on the same one.
 *   · "Sixteen database functions write data without naming the person who ran
 *     them" was §4 D71/D78's figure. WP 6.2 slices 11 and 12 closed that list
 *     to four names, none of which is debt.
 *
 * Both were wrong in the direction that matters: the report was MORE pessimistic
 * than the software. A trust report that overstates its own blind spots is not
 * safely wrong — it is `single-source` (I1) broken in the one module whose entire
 * job is to be true about the data layer (§4 D101 and D105 are the same shape).
 *
 * ── WHAT IT ASSERTS ────────────────────────────────────────────────────────
 *
 * §4 is the ONLY authority for data-layer evidence (CLAUDE.md), and its table
 * carries a "Closed by" column. So a limit whose `ref` names a D-number is
 * checkable: the row must exist, and it must not be closed. That is the whole
 * rule, and it is the one that would have caught both corrections above.
 *
 * It deliberately does NOT try to check the prose. A gate that diffed sentences
 * would fail on a comma, and the thing that rotted was never the wording — it
 * was the claim's continued existence after its cause was fixed.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { knownLimits } from "@/lib/trust/trustReport";

const ROOT = join(__dirname, "..", "..", "..", "..");
const PLAN = readFileSync(join(ROOT, "docs", "PLAN.md"), "utf8");
// WP 6.3 moved the module to `supabase/functions/_shared/` so A3 can be computed
// where the data is (`src/lib/trust/trustReport.ts` is now a re-export). This test
// reads the SOURCE, so it followed — and it is the gate that noticed the move,
// which is the behaviour a source-reading assertion is for.
const REPORT = readFileSync(
  join(ROOT, "supabase", "functions", "_shared", "trustReport.ts"),
  "utf8",
);

/**
 * §4's rows, by D-number, with the "Closed by" cell.
 *
 * The closed marker is matched as `\u2705` rather than as the glyph itself:
 * `npm run audit:ui` §3.5 forbids an emoji literal in source
 * (`docs/mobile-ui-spec.md`), and it is right to — this file is not product copy,
 * but a rule that made an exception for "tests" would stop being a rule. The
 * assertion is identical; only the spelling changes.
 */
function planDefects(): Map<string, string> {
  const start = PLAN.indexOf("\n## 4. Confirmed defects");
  const end = PLAN.indexOf("\n## 5. ", start);
  expect(start, "§4 not found in PLAN.md").toBeGreaterThan(-1);
  const section = PLAN.slice(start, end === -1 ? undefined : end);
  const out = new Map<string, string>();
  for (const line of section.split("\n")) {
    // `| D18 | … | … | WP 6.2 |` or `| **D103** | … |`. The last cell is the owner.
    const m = /^\|\s*\*{0,2}(D\d+)\*{0,2}\s*\|/.exec(line);
    if (!m) continue;
    const cells = line.split("|");
    // First cell is empty (leading `|`), last is empty (trailing `|`).
    const closedBy = (cells[cells.length - 2] ?? "").trim();
    out.set(m[1], closedBy);
  }
  return out;
}

/**
 * `knownLimits()`'s body with its COMMENTS REMOVED.
 *
 * The first draft of this file scanned the raw body and failed on its own
 * explanation: the module documents the two claims D103 corrected, by quoting
 * them, and a scan for the old wording found the record of its removal. What
 * reaches a user is the string literals — so that is what these rules read, and
 * the comments stay free to say what changed and why.
 */
function publishedText(): string {
  const start = REPORT.indexOf("export function knownLimits(");
  expect(start, "knownLimits() not found").toBeGreaterThan(-1);
  const body = REPORT.slice(start, REPORT.indexOf("\n}\n", start));
  const stripped = body.replace(/^\s*\/\/.*$/gm, "");
  // The strip must actually do something, or every rule below reads the raw body
  // again and passes for the wrong reason.
  expect(stripped.length, "comment strip removed nothing").toBeLessThan(body.length);
  expect(stripped).not.toMatch(/D103 is what that cost/);
  return stripped;
}

/** The `ref:` strings the limits block publishes. */
function publishedRefs(): string[] {
  return [...publishedText().matchAll(/ref:\s*"([^"]+)"/g)].map((m) => m[1]);
}

describe("the Trust Report's known limits (§4 D103)", () => {
  const defects = planDefects();

  it("§4 has rows to check against", () => {
    // If the parse breaks, every assertion below passes vacuously — which is
    // §4 D57's lesson (a gate that reports clean because it contains nothing).
    expect(defects.size).toBeGreaterThan(80);
    expect(defects.get("D103")).toBeTruthy();
  });

  it("every §4 reference it publishes names a row that exists", () => {
    const unknown = publishedRefs()
      .map((r) => /§4\s+(D\d+)/.exec(r)?.[1])
      .filter((d): d is string => !!d)
      .filter((d) => !defects.has(d));
    expect(
      unknown,
      "the report cites a §4 defect that §4 does not contain — the D-number is wrong, " +
        "or the row was removed rather than marked closed",
    ).toEqual([]);
  });

  it("it publishes no limit that cites a CLOSED defect as though it were open", () => {
    // THE ONE EXEMPTION, AND WHY IT IS NOT A LOOPHOLE.
    //
    // Closing a defect can CREATE a measurement. §4 D119 was "an unevaluable
    // requirement is dropped in silence"; closing it means the Trust Report now
    // reports how many such fields there are — a live number whose existence is
    // owed to a closed defect. So a ref may name a closed row, and only if the
    // ref ITSELF says the row is closed.
    //
    // That is deliberately awkward to write, which is the point: the author has
    // to state "this is closed, and here is what it left behind" in a string a
    // reader sees. What D103 caught was the opposite — a ref citing a closed
    // defect while the sentence beside it asserted the defect was live.
    const stale = publishedRefs()
      .filter((r) => !/\bclosed\b/i.test(r))
      .map((r) => /§4\s+(D\d+)/.exec(r)?.[1])
      .filter((d): d is string => !!d)
      .filter((d) => /CLOSED|\u2705/.test(defects.get(d) ?? ""));
    expect(
      stale,
      "these limits describe defects §4 records as CLOSED, without saying so. A " +
        "trust report that overstates its own blind spots is still a false " +
        "statement about the data layer, and it reaches a user on every project. " +
        "Delete the entry, replace it with the limit that IS still true, or — if " +
        "the closure is what produced the measurement — say `(closed — …)` in the " +
        "ref (§4 D103).",
    ).toEqual([]);
  });

  it("the exemption cannot be claimed for a defect §4 still calls OPEN", () => {
    // Otherwise "closed" in a ref becomes a word that silences the rule above.
    // A limit may only call a defect closed when §4 does.
    const lying = publishedRefs()
      .filter((r) => /\bclosed\b/i.test(r))
      .map((r) => /§4\s+(D\d+)/.exec(r)?.[1])
      .filter((d): d is string => !!d)
      .filter((d) => !/CLOSED|\u2705/.test(defects.get(d) ?? ""));
    expect(
      lying,
      "a limit's ref calls these §4 defects closed and §4 does not. §4 is the " +
        "only authority for that (CLAUDE.md), so either the row is wrong or the " +
        "ref is.",
    ).toEqual([]);
  });

  it("the two entries D103 named are gone, by their own wording", () => {
    // The mutation case for the rule above: these exact claims were published,
    // and an assertion that has never failed has never been tested. If either
    // sentence comes back, the gate above catches it only while the ref comes
    // back with it — this catches the sentence returning under a different ref.
    const published = publishedText();
    expect(published).not.toMatch(/dataset hash does not cover the deep-tier network/);
    expect(published).not.toMatch(/Sixteen database functions write data/);
  });

  it("no limit claims a count of unattributed database functions", () => {
    // The shape that rotted, not just the instance: a hard-coded number of
    // writers with no actor. `dataPlaneAudit.test.ts` owns that figure and
    // derives it; a second copy here is the two-lists defect D101 is.
    const body = publishedText();
    const counted = /\b(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|\d+)\s+database functions/i.exec(body);
    expect(
      counted?.[0] ?? null,
      "a count of database functions belongs in dataPlaneAudit.test.ts, which derives " +
        "it from the migrations. A number in this prose is a second authority for " +
        "one fact (I1), and it is what D103 was.",
    ).toBeNull();
  });
});

// Audit F-26. T3 was met for the data layer and not for the engine or the
// deployment: nothing said the analysis window is fixed, that production serves
// edge-function builds this repository does not describe, or that the pre-run
// check fails open. Each is always true today, so each is always stated.
describe("the limits the 2026-09-22 audit found are published (F-26)", () => {
  const limits = knownLimits({
    projectName: "P",
    freshness: { project_id: "p", graph_hash: null, graph_hash_short: "", dataset_version: null,
                 measured_at: "t", tables: {}, latest_runs: [] } as never,
    graded: [], findings: [], ingestHistory: [{ run_id: "r", fact_class: "csv", landed_at: "t", uploaded_by: "u", rows: 1 }],
  });
  const text = limits.map((l) => `${l.ref} ${l.limit} ${l.consequence}`).join("\n");
  it("the analysis window is fixed and shorter than the horizon", () => {
    expect(text).toMatch(/52 weeks after the warm-up/);
  });
  it("production's edge functions are not the repository's (§4 D168)", () => {
    expect(limits.some((l) => l.ref === "§4 D168")).toBe(true);
  });
  it("the pre-run data check can fail open and grades a bounded slice", () => {
    expect(text).toMatch(/pre-run data check/);
    expect(text).toMatch(/50 000 rows/);
  });
});

// Audit F-17. The client-asserted-identity limit named uploads only; the AI apply
// path takes its actor from the request body and writes with the service role.
describe("the identity limit names the AI apply path (F-17)", () => {
  const limits = knownLimits({
    projectName: "P",
    freshness: { project_id: "p", graph_hash: null, graph_hash_short: "", dataset_version: null,
                 measured_at: "t", tables: {}, latest_runs: [] } as never,
    graded: [], findings: [], ingestHistory: [],
  });
  it("says a caller with two ids can apply a proposal in someone else's name", () => {
    const d28 = limits.filter((l) => l.ref === "§4 D28").map((l) => l.consequence).join("\n");
    expect(d28).toMatch(/applying an approved proposal/);
    expect(d28).toMatch(/in that user's name/);
  });
});
