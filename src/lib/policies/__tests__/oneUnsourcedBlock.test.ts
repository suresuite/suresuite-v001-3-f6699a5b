/**
 * §4 D183 — one unsourced material is ONE block.
 *
 * D174 added a master-row sweep ("materials with no qualified supplier") beside
 * the BOM's "no supplier link" block, and a material in BOTH the BOM and the
 * master with no inbound lane was reported by both: the same field, the same
 * material, two blocks. `supabase/functions/_shared/grading_test.ts` asserts
 * exactly one and had been red on `main` since the sweep landed. This mirrors
 * those Deno assertions in the vitest suite every pull request runs, and adds
 * the case the Deno file does not: a master-only material still blocks.
 */
import { it, expect } from "vitest";
import { flattenFindings, gradeManifest } from "../../../../supabase/functions/_shared/grading";
import registry from "../registry.generated.json";
import bridge from "../../../../supabase/functions/_shared/engineBridge.json";
import fixture from "../../../../supabase/functions/_shared/fixtures/validation_parity/dataset.json";
import expected from "../../../../supabase/functions/_shared/fixtures/validation_parity/expected_findings.json";
const g = (d: unknown) => flattenFindings(gradeManifest(d as never, fixture.defaults as never, registry as never, bridge as never));
it("the shared grader reports an unsourced material once, and still blocks a master-only one", () => {
  const D = fixture.dataset as never as Record<string, unknown[]>;
  expect(g(D)).toEqual(expected);
  const v1 = { ...D, materials: [...D.materials, ...fixture.unsourced_extra.materials], bom: [...D.bom, ...fixture.unsourced_extra.bom] };
  const b1 = g(v1).filter((x) => x.severity === "block");
  expect(b1.length).toBe(1); expect(b1[0].rows).toEqual(["M_UNSOURCED"]);
  const v2 = { ...D, materials: [...D.materials, ...fixture.unsourced_extra.materials], bom: [...fixture.multi_level_variant.bom, ...fixture.multi_level_variant.unsourced_bom] };
  const b2 = g(v2).filter((x) => x.severity === "block");
  expect(b2.length).toBe(1); expect(b2[0].rows).toEqual(["M_UNSOURCED"]);
  expect(g(v2)).toEqual(g(v1));
  // a master-only material still blocks (D174's purpose)
  const v3 = { ...D, materials: [...D.materials, { material_id: "M_MASTER_ONLY" }] };
  const b3 = g(v3).filter((x) => x.severity === "block");
  expect(b3.map((x) => x.rows)).toEqual([["M_MASTER_ONLY"]]);
});
