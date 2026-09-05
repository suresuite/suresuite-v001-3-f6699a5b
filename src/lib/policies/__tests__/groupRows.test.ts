import { describe, expect, it } from "vitest";
import { groupByKeyA, summarise } from "../groupRows";

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
