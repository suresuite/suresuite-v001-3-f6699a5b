/**
 * `lead_time_unit` exists end to end (Phase 1 / WP 1.3, D9).
 *
 * The engine has read this field since the scsim bridge was written; no column
 * supplied it, so `r.get("lead_time_unit")` returned None on every row and
 * `_duration_to_weeks` fell back to a 7-day basis — a lead time entered in DAYS
 * was read as WEEKS, seven times too long, with no warning anywhere.
 *
 * The brief named three places to fix together. There are FOUR: the worker's
 * PostgREST projection names its columns explicitly, so adding the column to the
 * table would not have been enough on its own — the engine would still have read
 * None forever. Each link is asserted below.
 *
 * NOT asserted here: the database hop itself. This environment has no Supabase
 * project, so "a CSV with lead_time_unit=day round-trips to the DB" is verified
 * link by link rather than end to end. See PLAN.md §16.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { unitDays } from "../../../../supabase/functions/_shared/grading";

const ROOT = join(__dirname, "..", "..", "..", "..");
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), "utf8");

describe("D9 — lead_time_unit, every link in the chain", () => {
  it("1. the column exists, and only admits units the one unit table knows", () => {
    const sql = read("supabase", "migrations", "20260915000002_lead_time_unit.sql");
    expect(sql).toMatch(/ALTER TABLE public\.inbound_logistics\s+ADD COLUMN IF NOT EXISTS lead_time_unit text/);
    // An unrecognised unit would be read as weeks — the exact failure the column
    // exists to end — so it is rejected at write time instead.
    expect(sql).toContain("public.unit_days(lead_time_unit) IS NOT NULL");
  });

  it("2. the upload wizard offers it WITHOUT requiring it", () => {
    const wiz = read("src", "components", "UploadWizard.tsx");
    expect(wiz).toContain("optionalHeaders: ['lead_time_unit']");
    // expectedHeaders is the required-column gate. A column added there rejects
    // every CSV that predates it, which for an optional column is a regression.
    const inbound = wiz.slice(wiz.indexOf("id: 'inbound_logistics'"), wiz.indexOf("id: 'outbound_logistics'"));
    const open = inbound.indexOf("expectedHeaders: [");
    const required = inbound.slice(open, inbound.indexOf("]", open));
    expect(required).not.toContain("lead_time_unit");
  });

  it("2b. the downloadable template offers the column, left blank", () => {
    const csv = read("public", "template", "inbound_logistic.csv").split("\n");
    expect(csv[0].split(",")).toContain("lead_time_unit");
    // Blank in the sample row: the template must not teach that it is required.
    const header = csv[0].split(",");
    expect(csv[1].split(",")[header.indexOf("lead_time_unit")]).toBe("");
  });

  it("3. the ingest sanitizer keeps it, and normalizes blank to NULL", () => {
    const fn = read("supabase", "functions", "ingest-inbound-logistics", "index.ts");
    expect(fn).toContain("lead_time_unit:");
    // '' is not nullish, so `?? null` would have written an empty string, which
    // the column's CHECK rejects. NULL is how "weeks" is spelled.
    expect(fn).toMatch(/lead_time_unit:.*===\s*''\s*\?\s*null/);
  });

  it("4. the worker SELECTs it — PostgREST returns only what the projection names", () => {
    const datamap = read("sim-worker", "sim_worker", "datamap.py");
    const projection = /"supplier_id,material_id,unit_price,lead_time,lead_time_unit,time_unit,volume"/;
    expect(datamap, "the inbound projection must name lead_time_unit").toMatch(projection);
    // And it must still be handed to SupplyArc.
    expect(datamap).toContain('lead_time_unit=r.get("lead_time_unit")');
  });

  it("5. the engine converts with it, and NULL still means weeks", () => {
    const pm = read("scsim", "scsim", "io", "project_map.py");
    expect(pm).toContain("_duration_to_weeks(arc.lead_time, lt_unit)");
    // `_unit_days(None) or default_days` — the 7-day default IS the weeks rule.
    expect(pm).toMatch(/def _duration_to_weeks\([^)]*default_days: float = 7\.0\)/);
  });

  it("a lead time of 14 days is 2 weeks, not 14", () => {
    // The arithmetic the chain now performs, in the one unit table's terms:
    // _duration_to_weeks(value, unit) = value * unit_days(unit) / 7
    const durationToWeeks = (v: number, u: string | null) => (v * (unitDays(u) ?? 7)) / 7;
    expect(durationToWeeks(14, "day")).toBe(2);
    expect(durationToWeeks(14, "days")).toBe(2);
    // Before the column existed, the unit was always unreadable, so:
    expect(durationToWeeks(14, null)).toBe(14);
    // A duration is not a rate. One month of lead time is ~4.35 WEEKS, while a
    // rate of one per month is ~0.23 per week — inverse conversions, and the
    // reason the contract records `unit_source` per field rather than per table.
    expect(durationToWeeks(1, "month")).toBeCloseTo(4.3482, 4);
  });

  it("the contract records the column, and says NULL means weeks", () => {
    const yaml = read("supabase", "contract", "inbound_logistics.contract.yaml");
    expect(yaml).toContain("lead_time_unit:");
    expect(yaml).toContain("csv_header: lead_time_unit");
    // `contract` is the provenance state reserved in WP 1.2 for a value this
    // document supplies rather than code guessing it. This is its first use.
    expect(yaml).toMatch(/value: "weeks"\s+provenance: contract/);
  });
});
