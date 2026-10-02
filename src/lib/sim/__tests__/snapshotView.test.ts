/**
 * WP 12.2 — what `GET /v1/projects/{id}/dataset-versions/{version}` serves.
 *
 * The snapshot is served as frozen, in either shape (v2 `inputs`/`network`, v1
 * top-level), and `?tables=` narrows it without changing its shape. An unknown
 * table name is reported rather than read as an empty table.
 */
import { describe, expect, it } from "vitest";
import {
  gzip,
  selectTables,
  snapshotTables,
  tablesParam,
  wantsGzip,
} from "../../../../supabase/functions/_shared/snapshotView";

const V2 = {
  schema_version: 2,
  inputs: { suppliers: [{ supplier_id: "S1" }], inbound: [{ supplier_id: "S1", material_id: "M1" }], bom: [] },
  network: { network_nodes: [{ node_id: "n" }] },
};
const V1 = { suppliers: [{ supplier_id: "S1" }], inbound: [], products: [] };

describe("snapshotView", () => {
  it("lists tables by domain, for both shapes", () => {
    expect(snapshotTables(V2)).toEqual({ inputs: ["suppliers", "inbound", "bom"], network: ["network_nodes"] });
    expect(snapshotTables(V1)).toEqual({ inputs: ["suppliers", "inbound", "products"], network: [] });
  });

  it("serves the whole snapshot when no tables are asked for", () => {
    expect(selectTables(V2, null).snapshot).toBe(V2);
  });

  it("narrows a v2 snapshot and keeps its shape and version", () => {
    const { snapshot, unknown } = selectTables(V2, ["inbound"]);
    expect(unknown).toEqual([]);
    expect(snapshot).toEqual({ schema_version: 2, inputs: { inbound: V2.inputs.inbound }, network: {} });
  });

  it("narrows a v1 snapshot at the top level", () => {
    expect(selectTables(V1, ["suppliers"]).snapshot).toEqual({ suppliers: V1.suppliers });
  });

  it("reports a table the snapshot does not hold", () => {
    expect(selectTables(V2, ["inbound", "inbound_logistics"]).unknown).toEqual(["inbound_logistics"]);
  });

  it("parses ?tables=", () => {
    expect(tablesParam(new URL("https://x/?tables=a,%20b,,c"))).toEqual(["a", "b", "c"]);
    expect(tablesParam(new URL("https://x/"))).toBeNull();
  });

  it("compresses only large responses for clients that accept gzip", async () => {
    expect(wantsGzip("gzip, deflate", 100)).toBe(false);
    expect(wantsGzip("gzip, deflate", 64 * 1024)).toBe(true);
    expect(wantsGzip(null, 64 * 1024)).toBe(false);
    const text = JSON.stringify(V2).repeat(500);
    const gz = await gzip(text);
    expect(gz.length).toBeLessThan(text.length / 10);
    const back = await new Response(new Blob([gz]).stream().pipeThrough(new DecompressionStream("gzip"))).text();
    expect(back).toBe(text);
  });
});
