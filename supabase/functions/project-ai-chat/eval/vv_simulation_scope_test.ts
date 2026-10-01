// WP 11.2 · PLAN.md §4 D259 — the agent's validation badge follows the browser's rule.
//
// `get_validation_status` and the reuse lookup's badge column derive a card's badge in
// the edge function (`deriveValidationBadge`). Before WP 11.2 it compared the COMPOSITE
// graph hash, so after a deep-tier upload — which the engine never reads — the agent
// told the user every model was "stale (data drift)" while the Lab said validated. A
// card that binds the simulation scope now drifts only when that scope moves.

import { assertEquals } from "./harness/asserts.ts";
import { deriveValidationBadge } from "../vvTools.ts";

const card = (over: Record<string, unknown> = {}) => ({
  status: "active", verdict: "validated",
  policy_hash: "p", graph_hash: "g1", hash_simulation: "i1",
  ...over,
});

Deno.test("a deep-tier upload (composite moved, inputs did not) keeps the model validated", () => {
  assertEquals(deriveValidationBadge(card(), { policy: "p", graph: "g2", simulation: "i1" }), "validated");
});

Deno.test("an edit to an input the engine reads is data drift", () => {
  assertEquals(deriveValidationBadge(card(), { policy: "p", graph: "g2", simulation: "i2" }), "stale (data drift)");
});

Deno.test("an unknown simulation hash is never drift", () => {
  assertEquals(deriveValidationBadge(card(), { policy: "p", graph: "g2", simulation: "unknown" }), "validated");
});

Deno.test("a card with no simulation hash keeps the composite rule", () => {
  const legacy = card({ hash_simulation: null });
  assertEquals(deriveValidationBadge(legacy, { policy: "p", graph: "g1", simulation: "i9" }), "validated");
  assertEquals(deriveValidationBadge(legacy, { policy: "p", graph: "g2", simulation: "i1" }), "stale (data drift)");
});
