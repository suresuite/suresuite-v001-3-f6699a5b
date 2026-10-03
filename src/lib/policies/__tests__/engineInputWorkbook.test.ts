/**
 * The policy version's Export — PLAN.md §4 D289.
 *
 * The file claims, on its Read me sheet, to be "exactly what the simulation engine
 * receives". `scripts/example_project/engine_input.json` is the engine's own input
 * for the `page-equals-run` fixture project (`engine_input_from_snapshots`, held
 * current — and proved equal to what `run_scenario` is handed — by
 * `sim-worker/tests/test_engine_input.py`). This suite builds the workbook from it
 * and requires that NOTHING the engine receives is missing from, or different in,
 * the file: every field of every network row, every policy parameter, every
 * setting. It also holds the human half: where each value came from, the hash
 * re-check said in words, and the stored text the hash digests.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as XLSX from "xlsx";
import type { EngineInput } from "@/lib/sim/pyodideEngine";
import {
  buildEngineInputWorkbook,
  cellOf,
  headerFor,
  policyAsSavedRows,
  sha256Hex,
  SOURCE_LABEL,
  type EngineInputExportData,
} from "../engineInputWorkbook";

const ROOT = join(__dirname, "..", "..", "..", "..");
const ENGINE = JSON.parse(readFileSync(join(ROOT, "scripts", "example_project", "engine_input.json"), "utf8")) as EngineInput;
const FX = JSON.parse(readFileSync(join(ROOT, "scripts", "example_project", "page_equals_run.json"), "utf8")) as {
  policy: Record<string, unknown>;
};
const POLICY_TEXT = JSON.stringify(FX.policy);

async function data(over: Partial<EngineInputExportData> = {}): Promise<EngineInputExportData> {
  const hash = await sha256Hex(POLICY_TEXT);
  return {
    version: { id: "v-1", label: "Run: Test Capacity", version_no: 4, created_at: "2026-09-30T11:21:19Z", policy_hash: hash },
    policySnapshot: FX.policy,
    policySnapshotText: POLICY_TEXT,
    policyHashCheck: { state: "match", recomputed: hash },
    dataset: { id: "ds-1", label: null, created_at: "2026-09-30T11:20:00Z", graph_hash: "g".repeat(64), hash_inputs: "h".repeat(64) },
    datasetReason: "The dataset version the latest run read.",
    scenarioReason: "«Base» — the scenario of that latest run.",
    projectModel: "Make-To-Order",
    engine: ENGINE,
    generatedAt: "2026-10-03T00:00:00Z",
    ...over,
  };
}

/** A sheet as rows of cells, read back through the writer so the test sees the file. */
function sheets(wb: XLSX.WorkBook): Record<string, unknown[][]> {
  const back = XLSX.read(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }), { type: "buffer" });
  return Object.fromEntries(
    back.SheetNames.map((n) => [n, XLSX.utils.sheet_to_json(back.Sheets[n], { header: 1, defval: "" }) as unknown[][]]),
  );
}

const SHEET_OF: Record<string, string> = {
  suppliers: "Suppliers",
  supplier_links: "Supplier links",
  materials: "Materials",
  bom: "Bill of materials",
  products: "Products",
  customers: "Customers",
  customer_links: "Customer demand",
};

const asRead = (v: unknown) => {
  const c = cellOf(v);
  return c === null ? "" : c;
};

describe("the Export is the engine's input — nothing missing, nothing different", () => {
  it("every field of every network row is in its sheet, under its own column", async () => {
    const s = sheets(buildEngineInputWorkbook(await data()));
    const net = ENGINE.scenario.network as Record<string, unknown>;
    let checked = 0;
    for (const [key, rows] of Object.entries(net)) {
      if (!Array.isArray(rows) || rows.length === 0) continue;
      const sheet = s[SHEET_OF[key]];
      expect(sheet, `no sheet for ${key}`).toBeDefined();
      const header = sheet[0] as string[];
      expect(sheet.length - 1, `${key}: one row per entity`).toBe(rows.length);
      rows.forEach((row: Record<string, unknown>, i: number) => {
        for (const [field, value] of Object.entries(row)) {
          const meta = ENGINE.fields[key]?.[field];
          const col = header.indexOf(headerFor(meta?.label ?? field, meta?.unit ?? ""));
          expect(col, `${key}.${field} has no column`).toBeGreaterThanOrEqual(0);
          expect(sheet[i + 1][col], `${key}[${i}].${field}`).toEqual(asRead(value));
          checked++;
        }
      });
    }
    expect(checked).toBeGreaterThan(100);
  });

  it("every parameter of every policy the run applies is on the Policies sheet with its value", async () => {
    const rows = sheets(buildEngineInputWorkbook(await data())).Policies;
    for (const p of ENGINE.policies) {
      const name = `${p.catalog_ref} · ${p.id}`;
      for (const r of p.params) {
        const hit = rows.find((x) => x[0] === name && x[1] === r.display.join(" › "));
        expect(hit, `${p.id} ${r.path.join(".")}`).toBeDefined();
        expect(hit![2]).toEqual(asRead(r.value));
        expect(hit![4]).toBe(r.set_by_mapping ? "this version / your data" : "engine default");
      }
    }
    // The built-in buffers are always described, whether or not the version names them.
    expect(rows.some((x) => String(x[0]).endsWith("· inventory_control"))).toBe(true);
    expect(rows.some((x) => String(x[0]).endsWith("· unmet_demand_handling"))).toBe(true);
  });

  it("every simulation setting is on the Settings sheet with its value", async () => {
    const rows = sheets(buildEngineInputWorkbook(await data())).Settings;
    for (const [k, v] of Object.entries(ENGINE.scenario.settings)) {
      const label = ENGINE.fields.settings[k].label;
      const hit = rows.find((x) => x[0] === label);
      expect(hit, k).toBeDefined();
      expect(hit![1]).toEqual(asRead(v));
    }
  });
});

describe("the Export says where each value came from", () => {
  it("a source column sits beside every value the mapper records an origin for", async () => {
    const mats = sheets(buildEngineInputWorkbook(await data()))["Materials"];
    const header = mats[0] as string[];
    const cost = header.indexOf("Cost (€/unit)");
    expect(header[cost + 1]).toBe("Cost — source");
    const byId = new Map(mats.slice(1).map((r) => [r[0], r]));
    // M1: a /policies override; M2: no master cost, derived from the lanes.
    expect(byId.get("M1")![cost]).toBe(11.5);
    expect(byId.get("M1")![cost + 1]).toBe(SOURCE_LABEL.override);
    expect(byId.get("M2")![cost + 1]).toBe(SOURCE_LABEL.lanes);
  });

  it("a resolved value the engine does not simulate says so, rather than showing a source for a blank", async () => {
    const prods = sheets(buildEngineInputWorkbook(await data())).Products;
    const header = prods[0] as string[];
    const meta = ENGINE.fields.products.fg_base_stock;
    const col = header.indexOf(`${meta.label} — source`);
    const p1 = prods.find((r) => r[0] === "P1")!;
    // P1 is make-to-order: its master S of 400 is resolved and not read.
    expect(p1[header.indexOf(headerFor(meta.label, meta.unit))]).toBe("");
    expect(String(p1[col])).toMatch(/^item master \(uploaded data\) \(400\) — not applied, see Mapping notes$/);
  });

  it("the mapper's notes and the long source list are both in the file", async () => {
    const s = sheets(buildEngineInputWorkbook(await data()));
    expect(s["Mapping notes"].length - 1).toBe(ENGINE.warnings.length);
    expect(s["Where values came from"].length - 1).toBe(ENGINE.sources.length);
  });
});

describe("the Export ties its content to its hashes", () => {
  it("Read me states both versions, both hashes and the re-check in words", async () => {
    const readMe = sheets(buildEngineInputWorkbook(await data()))["Read me"].map((r) => r.join(" | ")).join("\n");
    const d = await data();
    expect(readMe).toContain(`Policy v4 · Run: Test Capacity`);
    expect(readMe).toContain(d.version.policy_hash!);
    expect(readMe).toContain("Policy hash check | MATCHES");
    expect(readMe).toContain("id ds-1");
    expect(readMe).toContain(d.dataset.graph_hash!);
    expect(readMe).toContain(`scsim ${ENGINE.engine_version}`);
  });

  it("a hash that does not match is said loudly, and one that was not checked says why", async () => {
    const bad = sheets(buildEngineInputWorkbook(await data({ policyHashCheck: { state: "mismatch", recomputed: "abc" } })));
    expect(bad["Read me"].map((r) => r.join(" ")).join("\n")).toContain("DOES NOT MATCH — the stored version hashes to abc");
    const un = sheets(buildEngineInputWorkbook(await data({
      policySnapshotText: null,
      policyHashCheck: { state: "unchecked", reason: "the stored text could not be read" },
    })));
    expect(un["Read me"].map((r) => r.join(" ")).join("\n")).toContain("Not checked — the stored text could not be read.");
    expect(un["Policy JSON (hashed)"]).toBeUndefined();
  });

  it("the hashed text is in the file, and joining its cells reproduces the policy hash", async () => {
    const big = JSON.stringify({ ...FX.policy, pad: "x".repeat(70000) });
    const hash = await sha256Hex(big);
    const s = sheets(buildEngineInputWorkbook(await data({
      policySnapshotText: big,
      version: { id: "v", label: null, created_at: "", policy_hash: hash },
    })));
    const cells = s["Policy JSON (hashed)"].slice(1).map((r) => String(r[0]));
    expect(cells.length).toBe(3); // a cell holds < 32 767 characters
    expect(await sha256Hex(cells.join(""))).toBe(hash);
  });

  it("Policy as saved lists every stored setting once — the content the hash covers", () => {
    const snap = FX.policy as { defaults: Record<string, Record<string, unknown>>; overrides: Array<{ patch: Record<string, unknown> }>; fulfillment_strategy?: string };
    const expected =
      Object.values(snap.defaults).reduce((n, f) => n + Object.keys(f).length, 0) +
      (typeof snap.fulfillment_strategy === "string" ? 1 : 0) +
      snap.overrides.reduce((n, o) => n + Object.keys(o.patch ?? {}).length, 0);
    expect(policyAsSavedRows(FX.policy)).toHaveLength(expected);
  });
});

describe("the Export reads as a document", () => {
  it("opens on Read me, every sheet name is legal, and the index names every sheet in the file", async () => {
    const wb = buildEngineInputWorkbook(await data());
    expect(wb.SheetNames[0]).toBe("Read me");
    for (const n of wb.SheetNames) expect(n.length).toBeLessThanOrEqual(31);
    const readMe = sheets(wb)["Read me"].map((r) => String(r[0]));
    for (const n of wb.SheetNames.slice(1)) expect(readMe, n).toContain(n);
  });

  it("units go in the header only when they add something", () => {
    expect(headerFor("Cost", "€/unit")).toBe("Cost (€/unit)");
    expect(headerFor("Lead time weeks", "weeks")).toBe("Lead time weeks");
    expect(headerFor("Demand model", "enum")).toBe("Demand model");
  });
});
