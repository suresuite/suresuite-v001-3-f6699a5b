/**
 * A5 · the Reproducibility Record, and `result-binding` (I8) — WP 6.3.
 *
 * ── WHAT IT HAS TO GET RIGHT ───────────────────────────────────────────────
 *
 * The record's whole value is being trustworthy about its own completeness. So the
 * assertions here are mostly about the ABSENCE case: a record that silently omits a
 * missing binding reads as complete, which is the over-claim T1 forbids and is worse
 * in this artifact than in any other, because completeness is the only thing it
 * claims.
 *
 * Three properties, each tested from both directions:
 *
 *   1. every part is either a value WITH a source, or null WITH a reason;
 *   2. `reproducible` is DERIVED from the required bindings, never asserted;
 *   3. the headline is never better than the bindings and the analyses allow.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  bindingsOf,
  buildReproducibilityRecord,
  recordRows,
  type AnalysisBinding,
  type ReproducibilityRecordInput,
} from "@/lib/trust/reproducibilityRecord";

const COMPLETE: ReproducibilityRecordInput = {
  projectId: "11111111-1111-4111-8111-111111111111",
  projectName: "Reproducible Project",
  graphHash: "a".repeat(64),
  datasetVersionId: "22222222-2222-4222-8222-222222222222",
  hashSchemaVersion: 3,
  policyVersionId: "33333333-3333-4333-8333-333333333333",
  policyHash: "b".repeat(64),
  scenarioId: "44444444-4444-4444-8444-444444444444",
  scenarioSeed: 42,
  engineCodeVersion: "0.2.3",
  browserEngineVersion: "0.2.3",
  analyses: [],
  limits: [],
  measuredAt: "2026-09-19T00:00:00.000Z",
};

const analysis = (over: Partial<AnalysisBinding> = {}): AnalysisBinding => ({
  kind: "network_metrics",
  runId: "55555555-5555-4555-8555-555555555555",
  codeVersion: "network_metrics@wp43.1",
  inputHash: "a".repeat(64),
  paramsHash: "c".repeat(64),
  finishedAt: "2026-09-19T00:00:00.000Z",
  inputHashIsCurrent: true,
  ...over,
});

describe("A5 · every part is bound or its absence is stated", () => {
  it("a complete input binds everything and reproduces", () => {
    const r = buildReproducibilityRecord(COMPLETE);
    expect(r.reproducible).toBe(true);
    expect(r.missing).toEqual([]);
    expect(r.bindings.every((b) => b.value !== null)).toBe(true);
  });

  it("every binding names WHERE it comes from, present or absent", () => {
    // A value with no source is a number with no provenance (T1). The source is
    // required even when the value is null, because it then says where the value
    // WOULD come from — which is what a reader needs in order to go and get it.
    for (const input of [COMPLETE, { ...COMPLETE, policyHash: null, scenarioSeed: null }]) {
      for (const b of bindingsOf(input)) {
        expect(b.source.length, `${b.key} has no source`).toBeGreaterThan(3);
      }
    }
  });

  it("an absent binding carries a REASON, and a present one does not", () => {
    // Both directions. A reason on a present binding would be dead text that goes
    // stale; a missing reason on an absent one is the omission this artifact exists
    // to prevent.
    const r = buildReproducibilityRecord({ ...COMPLETE, policyHash: null, datasetVersionId: null });
    for (const b of r.bindings) {
      if (b.value === null) {
        expect(b.absentBecause, `${b.key} is absent and says nothing`).toBeTruthy();
        expect((b.absentBecause ?? "").length).toBeGreaterThan(20);
      } else {
        expect(b.absentBecause, `${b.key} has a value AND a reason for absence`).toBeUndefined();
      }
    }
  });

  it("an empty string is treated as absent, not as a value", () => {
    // A blank `code_version` off a database row is the shape this actually arrives
    // in, and `""` rendered as a bound value is a record that claims an engine
    // nobody can identify.
    const r = buildReproducibilityRecord({ ...COMPLETE, engineCodeVersion: "" });
    expect(r.missing).toContain("engine.worker_code_version");
    expect(r.reproducible).toBe(false);
  });
});

describe("A5 · `reproducible` is derived, not asserted", () => {
  it("one missing REQUIRED binding is enough to make it false", () => {
    for (const key of [
      "graphHash",
      "hashSchemaVersion",
      "policyVersionId",
      "policyHash",
      "scenarioId",
      "scenarioSeed",
      "engineCodeVersion",
    ] as const) {
      const r = buildReproducibilityRecord({ ...COMPLETE, [key]: null });
      expect(r.reproducible, `${key} missing and the record still claims reproducible`).toBe(false);
      expect(r.missing.length).toBe(1);
      expect(r.headline).toMatch(/^NOT reproducible/);
    }
  });

  it("a missing RECOMMENDED binding is a caveat, not a failure", () => {
    // `browser_engine_version` and `dataset.version_id` do not stop reproduction:
    // the first names which of two engines ran, the second names a hash that is
    // already present. Treating them as required would make almost every record
    // read "not reproducible" and the verdict would stop meaning anything.
    for (const key of ["browserEngineVersion", "datasetVersionId"] as const) {
      const r = buildReproducibilityRecord({ ...COMPLETE, [key]: null });
      expect(r.reproducible, `${key} is recommended and was treated as required`).toBe(true);
      expect(r.missing).toEqual([]);
    }
  });

  it("the hash ALGORITHM version is required, and that is the point", () => {
    // The binding most likely to be overlooked. `graph_hash` is a SHA-256 over a
    // snapshot whose shape has changed three times (schema_version 1 → 2 → 3, most
    // recently when WP 5.3 folded the deep-tier topology in), so a hash without its
    // algorithm version is a number nobody can recompute.
    const r = buildReproducibilityRecord({ ...COMPLETE, hashSchemaVersion: null });
    expect(r.missing).toEqual(["dataset.hash_schema_version"]);
    const b = r.bindings.find((x) => x.key === "dataset.hash_schema_version")!;
    expect(b.absentBecause).toMatch(/RECOMPUTED/);
  });

  it("the two engine versions are SEPARATE bindings", () => {
    // §4 D87: the browser wheels are committed, so the browser and the worker can
    // run different engine code — I1 across a boundary no test crosses. One binding
    // would be silently wrong for whichever surface produced the figure.
    const keys = bindingsOf(COMPLETE).map((b) => b.key);
    expect(keys).toContain("engine.worker_code_version");
    expect(keys).toContain("engine.browser_version");
  });
});

describe("A5 · the headline is never better than the record", () => {
  it("an analysis with no input hash is named, and outranks the stale case", () => {
    // "We cannot say which data produced this" is worse than "this describes older
    // data", so it wins the headline. Both are true; the reader needs the worse one.
    const r = buildReproducibilityRecord({
      ...COMPLETE,
      analyses: [analysis({ inputHash: null, inputHashIsCurrent: null }), analysis({ inputHashIsCurrent: false })],
    });
    expect(r.reproducible).toBe(true);
    expect(r.headline).toMatch(/no input hash/);
    expect(r.headline).toMatch(/nothing can say which data produced them/);
  });

  it("a stale analysis reproduces ITSELF, and the headline says so", () => {
    const r = buildReproducibilityRecord({
      ...COMPLETE,
      analyses: [analysis({ inputHashIsCurrent: false })],
    });
    expect(r.headline).toMatch(/earlier version of this dataset/);
    expect(r.headline).toMatch(/reproduce themselves, not the data now loaded/);
  });

  it("no analyses at all is stated as a scope, not as success", () => {
    const r = buildReproducibilityRecord(COMPLETE);
    expect(r.headline).toMatch(/No analysis has been run/);
    expect(r.headline).toMatch(/simulation inputs only/);
  });

  it("a missing binding outranks every analysis remark", () => {
    const r = buildReproducibilityRecord({
      ...COMPLETE,
      scenarioSeed: null,
      analyses: [analysis({ inputHash: null })],
    });
    expect(r.headline).toMatch(/^NOT reproducible/);
  });
});

describe("A5 · the rows a reader is handed", () => {
  it("a missing binding appears as a ROW, with its reason", () => {
    const rows = recordRows(buildReproducibilityRecord({ ...COMPLETE, policyHash: null }));
    const flat = rows.map((r) => r.join("|")).join("\n");
    expect(flat).toMatch(/policy\.hash/);
    expect(flat).toMatch(/MISSING \(required\)/);
    expect(flat).toMatch(/cannot be detected/);
  });

  it("no analyses says WHY the network numbers are unattributable", () => {
    const flat = recordRows(buildReproducibilityRecord(COMPLETE))
      .map((r) => r.join("|"))
      .join("\n");
    // Not merely "(none)". A reader looking at centralities on screen needs to know
    // those numbers predate the store (§4 D88), or they will assume the record
    // covers them.
    expect(flat).toMatch(/No analysis has been run/);
    expect(flat).toMatch(/cannot be attributed to a run/);
  });

  it("an empty limits block is itself declared a limit", () => {
    // T3. A report claiming no limits is making the strongest claim in the
    // document, so it may not do that silently.
    const flat = recordRows(buildReproducibilityRecord(COMPLETE))
      .map((r) => r.join("|"))
      .join("\n");
    expect(flat).toMatch(/none reported/);
    expect(flat).toMatch(/not evidence there are none/);
  });

  it("supplied limits are carried VERBATIM, not summarised", () => {
    // The Trust Report computes them (§4 D103 is what happens when a second copy
    // drifts). This module renders; it does not re-author.
    const limit = {
      ref: "§4 D28",
      limit: "Three calls in the public API write data without naming a person.",
      consequence: "Those writes record that a change happened and cannot name who asked for it.",
    };
    const flat = recordRows(buildReproducibilityRecord({ ...COMPLETE, limits: [limit] }))
      .map((r) => r.join("|"))
      .join("\n");
    expect(flat).toContain(limit.limit);
    expect(flat).toContain(limit.consequence);
    expect(flat).toContain(limit.ref);
  });

  it("the verdict is on the sheet, not only in the object", () => {
    const flat = recordRows(buildReproducibilityRecord({ ...COMPLETE, policyHash: null }))
      .map((r) => r.join("|"))
      .join("\n");
    expect(flat).toMatch(/reproducible\|false/);
    expect(flat).toMatch(/NOT reproducible/);
  });
});

/**
 * ── A5 IS REACHABLE, WHICH IS THE PART A MODULE TEST CANNOT SHOW ───────────
 *
 * A module nobody calls is a promise, not a deliverable. That is the
 * `seeded_from_hash` lesson and this repository has paid for it twice: a column
 * nothing filled (WP 4.4) and a `planned()` helper nothing reaches (WP 5.2g).
 *
 * So these assertions are about the WIRING: the export hook assembles a record,
 * hands it to the workbook, and the workbook makes a sheet either way.
 */
describe("A5 · the record reaches a reader", () => {
  const ROOT = join(__dirname, "..", "..", "..", "..");
  const HOOK = readFileSync(join(ROOT, "src", "hooks", "useVerifiableExports.tsx"), "utf8");
  const EXPORTS = readFileSync(
    join(ROOT, "src", "lib", "policies", "verifiableExports.ts"),
    "utf8",
  );

  it("the export hook builds a record and passes it to the workbook", () => {
    expect(HOOK).toMatch(/buildReproducibilityRecord\(/);
    expect(HOOK).toMatch(/buildRunResultsWorkbook\([\s\S]{0,400}record,/);
  });

  it("the workbook always writes a `reproducibility` sheet", () => {
    // Even with no record. A workbook silently LACKING the sheet is
    // indistinguishable from one whose record was complete — §4 D103's shape, in
    // an artifact a reviewer is meant to audit without the app.
    expect(EXPORTS).toMatch(/"reproducibility"/);
    expect(EXPORTS).toMatch(/NOT SUPPLIED/);
    expect(EXPORTS).toMatch(/NOT evidence\s*\n?\s*.{0,40}the run is reproducible|NOT evidence/);
  });

  it("the limits come from the Trust Report, not from a second list", () => {
    // §4 D103 is what a second copy costs: two limits outlived their defects and
    // were published on every project. The hook calls `knownLimits` rather than
    // re-authoring, and passes `graded: null` honestly — which `knownLimits` turns
    // into a declared limit of its own rather than an empty section.
    expect(HOOK).toMatch(/knownLimits\(/);
    expect(HOOK).toMatch(/graded: null/);
  });

  it("`unknown` is never bound as a browser engine version", () => {
    // §4 D87: the build script wrote exactly that string when its version lookup
    // failed, and a record binding it would name an engine nobody can identify.
    expect(HOOK).toMatch(/v !== "unknown"/);
  });

  it("the analysis list is the LATEST per kind, not every run", () => {
    // A record is a binding, not a log. Every historical run would make the sheet
    // unreadable and would not say which one a screen actually showed.
    expect(HOOK).toMatch(/latestByKind/);
    expect(HOOK).toMatch(/if \(!kind \|\| latestByKind\.has\(kind\)\) continue;/);
  });

  it("a failed lookup becomes an absent binding, not a failed export", () => {
    // `maybeSingle()` and the try/catch around the manifest fetch are the whole of
    // this: a reviewer holding six of nine bindings and three stated reasons is
    // better served than one holding an error toast.
    expect(HOOK).toMatch(/\.maybeSingle\(\)/);
    expect(HOOK).toMatch(/browserEngineVersion = null;/);
  });
});
