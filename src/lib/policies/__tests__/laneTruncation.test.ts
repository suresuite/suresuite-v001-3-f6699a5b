/**
 * D20 — `projectLanes`'s fallback truncated at 10 000 rows SILENTLY
 * (docs/PLAN.md §4, closed by WP 3.1).
 *
 * The defect was never the ceiling. A bound is required: without an explicit
 * `.limit()` PostgREST applies its own `db-max-rows` and cuts the read without
 * saying so, which is the same failure with a smaller number. The defect was
 * that the slice came back shaped exactly like a whole project, so every count
 * computed from it — "12/12 lanes priced", a validation clearance, an exported
 * BOM sheet — was a statement about data nobody knew was missing.
 *
 * §5 T2 decides where the fix has to live: substitution is visible AT THE POINT
 * OF DISPLAY. So these tests check two things a console warning would fail:
 * that the fetcher REPORTS a truncated lane, and that the surfaces which render
 * lane-derived numbers actually show the report. The second half is read from
 * the source of those components, the way `orgIdentity.test.ts` reads policy
 * SQL — a fetcher that reports into a field nobody renders is D20 again with
 * one more step in it.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LANE_ROW_CEILING, laneTruncationNotice } from "../laneTruncation";

const ROOT = join(__dirname, "..", "..", "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

describe("D20 — a truncated lane read is reported, not swallowed", () => {
  it("says nothing when nothing was truncated", () => {
    expect(laneTruncationNotice({ truncated: [] })).toBeNull();
  });

  it("names every lane that hit the ceiling, and the ceiling", () => {
    const note = laneTruncationNotice({ truncated: ["inbound_logistics", "bom_multi_level"] });
    expect(note).toContain("inbound_logistics");
    expect(note).toContain("bom_multi_level");
    expect(note).toContain(LANE_ROW_CEILING.toLocaleString());
  });

  it("says the numbers are a slice, in words a user can act on", () => {
    const note = laneTruncationNotice({ truncated: ["inbound_logistics"] }) ?? "";
    expect(note.toLowerCase()).toContain("partial");
    expect(note.toLowerCase()).toContain("slice");
  });

  it("the fetcher's ceiling is one named constant, used by every lane read", () => {
    const src = read("src/lib/policies/projectLanes.ts");
    // No bare numeric limit may return: the whole defect was a literal nobody
    // could see from the UI.
    expect(src).not.toMatch(/\.limit\(\s*\d/);
    expect(src.match(/\.limit\(LANE_ROW_CEILING\)/g) ?? []).toHaveLength(4);
  });

  it("the wording lives in one module and the fetcher re-exports it", () => {
    const src = read("src/lib/policies/projectLanes.ts");
    expect(src).toContain('from "@/lib/policies/laneTruncation"');
    expect(src).not.toMatch(/Partial data —/);
  });

  it("the RPC path declares that it cannot truncate, rather than leaving it implied", () => {
    const src = read("src/lib/policies/projectLanes.ts");
    expect(src).toMatch(/truncated: \[\],/);
  });
});

describe("D20 — every surface that renders lane numbers renders the notice", () => {
  const surfaces = [
    // the policy grid — supplier/plant/customer stages
    "src/components/policies/FocusedStage.tsx",
    // the data map — "k of n lanes priced" for every mapped column
    "src/components/policies/DataMapGrid.tsx",
    // Run & validate — the grade, and §5 T3's "publish your own blind spots"
    "src/components/policies/RunValidateStage.tsx",
  ];

  for (const file of surfaces) {
    it(`${file} renders <LaneTruncationNotice>`, () => {
      const src = read(file);
      expect(src).toContain("LaneTruncationNotice");
      expect(src).toMatch(/<LaneTruncationNotice\s+truncated=/);
    });
  }

  it("the export path tells the person exporting, not the console", () => {
    const src = read("src/hooks/useVerifiableExports.tsx");
    expect(src).toContain("laneTruncationNotice");
    expect(src).toMatch(/toast\.warning\(note\)/);
  });

  it("the notice component has one wording, taken from the fetcher", () => {
    const src = read("src/components/policies/LaneTruncationNotice.tsx");
    expect(src).toContain("laneTruncationNotice");
    // The sentence itself must not be re-typed in the component.
    expect(src).not.toMatch(/Partial data —/);
  });
});
