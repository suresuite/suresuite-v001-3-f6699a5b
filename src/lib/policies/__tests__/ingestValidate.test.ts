/**
 * CONTRACT-DRIVEN VALIDATION (Phase 3 / WP 3.2 — D7, D8, D46).
 *
 * Every rule exercised here is read from `ingestSpec.generated.ts`, which the
 * data contract generates from supabase/contract/*.contract.yaml. Nothing in
 * this file states a rule; it states what the contract's rules must DO, which is
 * the difference between a test of the validator and a second copy of the
 * contract.
 *
 * The four §10 exit checks live here (the fifth, the semicolon file, is a parse
 * question and lives in csvParse.test.ts):
 *   · blank `volume` is rejected with a ROW-LEVEL finding
 *   · `" MAT-1 "` and `"MAT-1"` resolve to one id
 *   · an integer `time_unit` is rejected with a finding, NEVER coerced
 *   · a quoted comma survives all the way into a staged row
 */
import { describe, expect, it } from "vitest";
import { parseCsv } from "../../../../supabase/functions/_shared/csvParse";
import { validateRows } from "../../../../supabase/functions/_shared/ingestValidate";
import { INGEST_DATASETS } from "../../../../supabase/functions/_shared/ingestSpec.generated";

const INBOUND = INGEST_DATASETS.inbound_logistics;
const H = "supplier_id,material_id,volume,time_unit,lead_time,unit_price";
const run = (body: string) => validateRows(parseCsv(`${H}\n${body}`), INBOUND);
const rowCodes = (r: ReturnType<typeof run>, i = 0) => r.rows[i].findings.map((f) => f.code);

describe("the contract is what decides", () => {
  it("maps every required inbound header the contract names", () => {
    const headers = INBOUND.columns.filter((c) => c.required).map((c) => c.csvHeader);
    expect(headers.sort()).toEqual(
      ["lead_time", "material_id", "supplier_id", "unit_price", "volume"],
    );
  });

  it("targets the tier-2 table the contract names, not the wizard's label", () => {
    expect(INBOUND.target).toBe("inbound_logistics");
    expect(INBOUND.factClass).toBe("transactional");
  });

  it("keys `parsed` by tier-2 COLUMN, and `raw` by the header the file carried", () => {
    const r = run("SUP-1,MAT-1,10,week,2,3");
    expect(Object.keys(r.rows[0].parsed).sort())
      .toEqual(["lead_time", "material_id", "supplier_id", "time_unit", "unit_price", "volume"]);
    expect(r.rows[0].raw.supplier_id).toBe("SUP-1");
  });
});

describe("D7 — a blank required numeric is rejected, never silently null", () => {
  it("rejects a blank volume with a row-level finding naming the row and the column", () => {
    const r = run("SUP-1,MAT-1,,week,2,3");
    expect(rowCodes(r)).toEqual(["required_blank"]);
    expect(r.rows[0].findings[0].row).toBe(2);
    expect(r.rows[0].findings[0].field).toBe("volume");
    expect(r.counts.rows_rejected).toBe(1);
  });

  it("puts NO volume key in `parsed` — absent, not null", () => {
    // The distinction is the defect: `null` says "the file said empty and that
    // is allowed", and 376 production rows say exactly that today.
    const r = run("SUP-1,MAT-1,,week,2,3");
    expect("volume" in r.rows[0].parsed).toBe(false);
  });

  it("rejects the row without rejecting the file", () => {
    const r = run("SUP-1,MAT-1,,week,2,3\nSUP-2,MAT-2,20,week,2,3");
    expect(r.ok).toBe(true);
    expect(r.rows).toHaveLength(2);
    expect(rowCodes(r, 1)).toEqual([]);
  });

  it("accepts a volume of zero — the contract says >= 0, not > 0", () => {
    expect(rowCodes(run("SUP-1,MAT-1,0,week,2,3"))).toEqual([]);
  });

  it("rejects a lead_time of zero — the contract says > 0 for that one", () => {
    expect(rowCodes(run("SUP-1,MAT-1,10,week,0,3"))).toEqual(["out_of_range"]);
  });

  it("rejects a negative volume", () => {
    expect(rowCodes(run("SUP-1,MAT-1,-1,week,2,3"))).toEqual(["out_of_range"]);
  });

  it("rejects a number it cannot read rather than guessing at it", () => {
    expect(rowCodes(run("SUP-1,MAT-1,1 200,week,2,3"))).toEqual(["not_numeric"]);
  });

  it("reads a decimal and an exponent", () => {
    const r = run("SUP-1,MAT-1,1.5e3,week,2,3");
    expect(rowCodes(r)).toEqual([]);
    expect(r.rows[0].parsed.volume).toBe(1500);
  });
});

describe("D8 — identifiers are trimmed, and blank after trimming is missing", () => {
  it('resolves " MAT-1 " and "MAT-1" to one id', () => {
    const r = run("SUP-1, MAT-1 ,10,week,2,3\nSUP-1,MAT-1,20,week,2,3");
    expect(r.rows[0].parsed.material_id).toBe("MAT-1");
    expect(r.rows[1].parsed.material_id).toBe("MAT-1");
    expect(r.rows[0].parsed.material_id).toBe(r.rows[1].parsed.material_id);
  });

  it("keeps the untrimmed cell in `raw`, so the two are still distinguishable", () => {
    const r = run("SUP-1, MAT-1 ,10,week,2,3");
    expect(r.rows[0].raw.material_id).toBe(" MAT-1 ");
  });

  it("rejects an id that is only whitespace", () => {
    expect(rowCodes(run("SUP-1,   ,10,week,2,3"))).toEqual(["required_blank"]);
  });
});

describe("D46 — an unrecognised time_unit is refused, never read as weekly", () => {
  it("rejects an integer token with a finding", () => {
    const r = run("SUP-1,MAT-1,10,21,2,3");
    expect(rowCodes(r)).toEqual(["unit_unrecognized"]);
    expect(r.rows[0].findings[0].message).toMatch(/21/);
  });

  it("lands no time_unit for the rejected row", () => {
    expect("time_unit" in run("SUP-1,MAT-1,10,21,2,3").rows[0].parsed).toBe(false);
  });

  it("accepts every spelling the ONE unit table knows", () => {
    for (const u of ["day", "weekly", "MONTH", " quarter ", "annually"]) {
      expect(rowCodes(run(`SUP-1,MAT-1,10,${u},2,3`))).toEqual([]);
    }
  });

  it("accepts a blank time_unit — optional, and blank means weeks", () => {
    const r = run("SUP-1,MAT-1,10,,2,3");
    expect(rowCodes(r)).toEqual([]);
    expect("time_unit" in r.rows[0].parsed).toBe(false);
    expect(r.counts.fields_defaulted).toBe(1);
  });
});

describe("D6 — the shape of a row is checked before its cells", () => {
  it("rejects a short row with one finding and reads none of its cells", () => {
    const r = run("SUP-1,MAT-1,10,week,2");
    expect(rowCodes(r)).toEqual(["field_count_mismatch"]);
    expect(r.rows[0].parsed).toEqual({});
  });

  it("rejects a long row the same way", () => {
    expect(rowCodes(run("SUP-1,MAT-1,10,week,2,3,extra"))).toEqual(["field_count_mismatch"]);
  });

  it("carries a quoted comma all the way into a staged row", () => {
    const r = validateRows(
      parseCsv(`${H}\n"Acme, Inc.",MAT-1,10,week,2,3`),
      INBOUND,
    );
    expect(rowCodes(r)).toEqual([]);
    expect(r.rows[0].parsed.supplier_id).toBe("Acme, Inc.");
    expect(r.rows[0].parsed.volume).toBe(10);
  });
});

describe("file-level problems reject the file, not a row", () => {
  it("refuses a file missing a required column and lists what it found", () => {
    const r = validateRows(parseCsv("supplier_id,material_id\nSUP-1,MAT-1"), INBOUND);
    expect(r.ok).toBe(false);
    expect(r.fileFindings.map((f) => f.code)).toContain("missing_required_column");
    expect(r.fileFindings[0].message).toMatch(/supplier_id, material_id/);
  });

  it("refuses a file that carries a column the server supplies", () => {
    const r = validateRows(
      parseCsv(`project_id,${H}\nx,SUP-1,MAT-1,10,week,2,3`),
      INBOUND,
    );
    expect(r.ok).toBe(false);
    expect(r.fileFindings.map((f) => f.code)).toContain("server_set_column_in_file");
  });

  it("notes an unknown column without rejecting anything", () => {
    const r = validateRows(parseCsv(`${H},notes\nSUP-1,MAT-1,10,week,2,3,hello`), INBOUND);
    expect(r.ok).toBe(true);
    expect(r.fileFindings.map((f) => f.code)).toEqual(["unmapped_column"]);
    expect(r.rows[0].raw.notes).toBe("hello");
    expect(rowCodes(r)).toEqual([]);
  });
});

describe("the other five datasets validate from the same spec", () => {
  it("accepts level 0 in bom_multi_level — the root component both live parsers admit", () => {
    const spec = INGEST_DATASETS.bom_multi_level;
    const r = validateRows(
      parseCsv("material_id,level,higher_level_component_id,consumption_rate\nMAT-1,0,,2"),
      spec,
    );
    expect(r.rows[0].findings).toEqual([]);
    expect(r.rows[0].parsed.level).toBe(0);
  });

  it("rejects a non-integer level", () => {
    const spec = INGEST_DATASETS.bom_multi_level;
    const r = validateRows(
      parseCsv("material_id,level,higher_level_component_id,consumption_rate\nMAT-1,1.5,MAT-0,2"),
      spec,
    );
    expect(r.rows[0].findings.map((f) => f.code)).toEqual(["not_an_integer"]);
  });

  it("covers every dataset the contract declares, with a target and a fact class", () => {
    for (const [id, spec] of Object.entries(INGEST_DATASETS)) {
      expect(spec.dataset).toBe(id);
      expect(spec.columns.length).toBeGreaterThan(0);
      expect(["master", "transactional"]).toContain(spec.factClass);
      for (const c of spec.columns) expect(c.rule.kind).toBeTruthy();
    }
  });
});
