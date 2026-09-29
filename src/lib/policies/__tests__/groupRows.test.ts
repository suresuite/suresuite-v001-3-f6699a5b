import { describe, expect, it } from "vitest";
import { groupByKeyA, memberDisplay, summarise } from "../groupRows";

describe("groupByKeyA", () => {
  it("groups consecutive rows sharing key A", () => {
    const rows = [
      { material_id: "MAT-1001", supplier_id: "S1" },
      { material_id: "MAT-1001", supplier_id: "S2" },
      { material_id: "MAT-1002", supplier_id: "S3" },
    ];
    const groups = groupByKeyA(rows, "material_id");
    expect(groups).toHaveLength(2);
    expect(groups[0].id).toBe("MAT-1001");
    expect(groups[0].members).toHaveLength(2);
    expect(groups[1].members).toHaveLength(1);
  });

  it("does not merge non-consecutive runs of the same id", () => {
    const rows = [{ id: "A" }, { id: "B" }, { id: "A" }];
    const groups = groupByKeyA(rows, "id");
    expect(groups).toHaveLength(3);
  });
});

describe("summarise", () => {
  it("labels its aggregates", () => {
    expect(summarise({ kind: "int" }, [1200, 600])).toBe("Σ 1,800");
    expect(summarise({ kind: "num", dec: 2 }, [12.4, 13.15])).toBe("ø 12.78");
    expect(summarise({ kind: "toggle" }, [true, false])).toBe("1 / 2 primary");
    expect(summarise({ kind: "type" }, ["min_max", "min_max"])).toBe("min_max");
    expect(summarise({ kind: "type" }, ["min_max", "rop", "base_stock"])).toBe("3 types");
    expect(summarise({ kind: "text" }, ["Acme", "Acme"])).toBe("Acme");
    expect(summarise({ kind: "text" }, ["Acme", "Beta"])).toBe("varies");
    expect(summarise({ kind: "vector" }, [])).toBe("per line");
  });
});

/**
 * §4 D179 — every material names itself on screen.
 *
 * The rendered key-A column is modelled exactly as StagePolicyTable draws it:
 * EVERY member writes its own id; a continuation (`memberDisplay(...)
 * .isContinuation`) prefixes it with "↳" to mark the group. Owner-directed:
 * the material must be readable on every line, not only the group's first. The fixture is Test_Simulation's shape (one material with
 * several suppliers, one with a single supplier) plus the one-line classes
 * D175/D176 add. Under the 2026-09-19 rule every one-line material rendered
 * as a bare "↳", which is the "only M001 is listed" report.
 */
describe("memberDisplay (D179)", () => {
  const visibleKeyA = (rows: Array<{ material_id: string }>): string[] =>
    groupByKeyA(rows, "material_id").flatMap((g) =>
      g.members.map((_, mi) =>
        memberDisplay(g.members.length, mi).isContinuation ? `↳ ${g.id}` : g.id,
      ),
    );

  it("a group of one is neither collapsible nor a continuation — it names itself", () => {
    expect(memberDisplay(1, 0)).toEqual({ isFirstOfGroup: false, isContinuation: false });
  });

  it("a group of three: first names it, the other two continue it", () => {
    expect([0, 1, 2].map((i) => memberDisplay(3, i))).toEqual([
      { isFirstOfGroup: true, isContinuation: false },
      { isFirstOfGroup: false, isContinuation: true },
      { isFirstOfGroup: false, isContinuation: true },
    ]);
  });

  it("Test_Simulation's shape: BOTH materials are visible, not only the multi-supplier one", () => {
    const rows = [
      { material_id: "M001", supplier_id: "S001" },
      { material_id: "M001", supplier_id: "S002" },
      { material_id: "M001", supplier_id: "S003" },
      { material_id: "M002", supplier_id: "S004" },
    ];
    expect(visibleKeyA(rows)).toEqual(["M001", "↳ M001", "↳ M001", "M002"]);
  });

  it("every LINE names its own material — including the one-line classes", () => {
    const rows = [
      { material_id: "ABS0785D162C" }, { material_id: "ABS0785D162C" },
      { material_id: "INT-1" },          // (made in-house)
      { material_id: "M-LEAF" },         // (unassigned supplier)
      { material_id: "M-ORPHAN" },       // not in BOM
      { material_id: "M-ONE-SUP" },      // single supplier
    ];
    const cells = visibleKeyA(rows);
    rows.forEach((r, i) => expect(cells[i].endsWith(r.material_id)).toBe(true));
  });

  it("an active sort that interleaves materials still names every row", () => {
    // groups degrade to singletons under a sort; each must still show its id
    const rows = [{ material_id: "B" }, { material_id: "A" }, { material_id: "B" }];
    expect(visibleKeyA(rows)).toEqual(["B", "A", "B"]);
  });
});
