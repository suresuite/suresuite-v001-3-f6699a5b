/**
 * The Data map's "Policies page, column by column" RENDERS every column the
 * grid has, with its verdict — static markup, as `bomTreeRender.test.tsx`
 * does (vitest runs in node with no DOM). The component reads no session and
 * no project data, so nothing is mocked.
 */
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PolicyColumnCheck } from "@/components/policies/PolicyColumnCheck";
import { GRID_STAGES, stageColumnChecks, STAGE_TITLE } from "@/lib/policies/policyColumnCheck";

const html = renderToStaticMarkup(createElement(PolicyColumnCheck));
const text = html.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&gt;/g, ">").replace(/&lt;/g, "<");

describe("PolicyColumnCheck renders the whole page's columns", () => {
  it("every stage has its table", () => {
    for (const s of GRID_STAGES) expect(text).toContain(STAGE_TITLE[s]);
  });

  it("every grid column is a row, named by the grid's own header and its field", () => {
    for (const s of GRID_STAGES) {
      for (const c of stageColumnChecks(s)) {
        expect(text, `${s}:${c.field}`).toContain(c.label);
        expect(text, `${s}:${c.field}`).toContain(`${c.family}.${c.field}`);
      }
    }
  });

  it("the sections outside the grid render too", () => {
    for (const t of ["Page-level controls", "Allocation line", "FG safety buffer (P-P.4)", "Run & validate", "Engine inputs with no column"]) {
      expect(text).toContain(t);
    }
    expect(text).toContain("backorder_allowed");
  });
});
