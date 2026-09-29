/**
 * The Data map's version line renders the latest version, its date, the engine
 * it was checked against and this build; the history is behind a toggle and
 * closed by default; no stale warning while the engines agree.
 */
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MappingVersionBar } from "@/components/policies/MappingVersionBar";
import { ENGINE_VERSION, MAPPING_VERSIONS, staleAgainstEngine } from "@/lib/policies/mappingVersions";

describe.each(["columns", "uploads"] as const)("MappingVersionBar — %s", (tool) => {
  const html = renderToStaticMarkup(createElement(MappingVersionBar, { tool }));
  const latest = MAPPING_VERSIONS[tool][0];

  it("states the version, the date, the engine it was checked against and the engine this build runs", () => {
    expect(html).toContain(`Mapping v${latest.version}`);
    expect(html).toContain(`updated ${latest.updated}`);
    expect(html).toContain(`checked against engine ${latest.engine}`);
    expect(html).toContain(`this build runs engine ${ENGINE_VERSION}`);
    expect(html).toContain("build ");
  });

  it("keeps the history behind a closed toggle", () => {
    expect(html).toContain("Version history");
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain("version history</ol>");
    expect(html).not.toContain(latest.changes[0]);
  });

  it("opened, lists every version with its date, engine and changes, newest first", () => {
    const open = renderToStaticMarkup(createElement(MappingVersionBar, { tool, defaultOpen: true }));
    expect(open).toContain('aria-expanded="true"');
    let last = -1;
    for (const v of MAPPING_VERSIONS[tool]) {
      const at = open.indexOf(`<b>v${v.version}</b>`);
      expect(at, v.version).toBeGreaterThan(last);
      last = at;
      for (const c of v.changes) expect(open).toContain(c.replace(/&/g, "&amp;").replace(/>/g, "&gt;").replace(/</g, "&lt;").replace(/'/g, "&#x27;"));
    }
  });

  it("raises no stale warning while the mapping was checked against this engine", () => {
    expect(staleAgainstEngine(tool)).toBeNull();
    expect(html).not.toContain("Re-check it before relying on it");
  });
});
