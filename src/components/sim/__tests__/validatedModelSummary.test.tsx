/**
 * WP 10.3 · §4 D243 — the Validated Model summary card. Rendered to static markup
 * (vitest runs in node with no DOM), as `surrogateCard.test.tsx` does.
 *
 * T1, no number without a source: every figure the card prints is a field of the
 * model (or of the version row it names), and an unrecorded field is SAID to be
 * unrecorded — never filled with a default.
 */
import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { ValidatedModelSummary } from "../ValidatedModelSummary";
import {
  modelDeepLink,
  openedModelLine,
  staleMessage,
  validatedModelLines,
} from "@/lib/sim/validatedModel";
import type { ModelValidationCard } from "@/hooks/useModelValidation";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

const card: ModelValidationCard = {
  id: "m1",
  project_id: "p1",
  policy_version_id: "pv1",
  policy_hash: "abc1234deadbeef",
  dataset_version_id: "dv1",
  graph_hash: "f00dbabcafe",
  hash_simulation: "5a5a5a5a5a",
  simulation_version_id: "sv1",
  scenario_hash: "5ce7a210",
  scenario_fingerprint: {},
  engine_fingerprint: "scsim 0.2.9",
  adopted_warmup_days: 91,
  warmup_method: "mser5",
  recommended_replications: 37,
  replication_basis: {},
  validation_tests: [
    { kpi: "fill_rate", ks: 0.1, ks_p: 0.6, t: 0.4, t_p: 0.7, n: 3, source: "weekly series", pass: true },
    { kpi: "max_backlog", ks: 0.1, ks_p: 0.6, t: 0.4, t_p: 0.7, n: 3, source: "weekly series", pass: true },
  ],
  findings_snapshot: [],
  verdict: "validated",
  basis: "statistical",
  evidence_run_id: "e5e5e5e5-0000-0000-0000-000000000000",
  status: "active",
  validated_at: "2026-10-01T09:00:00Z",
  author_email: "analyst@example.com",
  created_at: "2026-10-01T09:00:00Z",
  name: "Q4 baseline",
  version_no: 4,
  protocol: {
    replications: 37,
    root_seed: 42,
    crn: true,
    warmup_week: 13,
    horizon_weeks: 156,
    analysis_window_weeks: 143,
    ci_level: 0.95,
    ci_halfwidth_target: 0.05,
    stopping_rule: "fixed_horizon",
  },
  protocol_hash: "11aa",
  model_hash: "77bb88cc99",
};
const refs = { graphVersionNo: 7, policyVersionNo: 3, simulationVersionNo: 4, policyCode: "20261004", simulationCode: "20260915" };

describe("every figure on the card has a source", () => {
  const lines = validatedModelLines(card, refs);

  it("shows the lines the brief names — the simulation inputs first, the snapshot second (WP 11.3)", () => {
    expect(lines.map((l) => l.label)).toEqual([
      "Data (simulation inputs)",
      "Snapshot",
      "Policy",
      "Engine",
      "Run",
      "Steady state from",
      "Horizon",
      "Analysis window",
      "CI level / ε",
      "Stopping rule",
      "Validated",
      "Evidence",
    ]);
  });

  it("each line names the column it is read from", () => {
    for (const l of lines) expect(l.source).toMatch(/model_validations\./);
  });

  it("each number printed is a number the model or its version rows hold", () => {
    // The pool is the model's own fields and the two version numbers; a percent
    // is its fraction × 100, so "95" is "0.95"'s digits — matched as a substring.
    const pool = JSON.stringify({ ...card, ...refs });
    for (const l of lines) {
      if (l.label === "Validated") continue; // a locale date; its source is validated_at
      for (const n of (l.value ?? "").match(/\d+/g) ?? []) {
        expect(pool, `${l.label}: ${n}`).toContain(n);
      }
    }
    expect(lines.find((l) => l.label === "Validated")!.source).toContain("validated_at");
  });

  it("reads the figures the protocol states", () => {
    const by = Object.fromEntries(lines.map((l) => [l.label, l.value]));
    // WP 10.5 follow-up — the stored codes, the hash beside them.
    expect(by["Data (simulation inputs)"]).toBe("Data 20260915 · 5a5a5a5");
    expect(by.Snapshot).toBe("Snapshot v7 · f00dbab");
    expect(by.Policy).toBe("Policy 20261004 · abc1234");
    expect(by.Run).toBe("37 replications · root seed 42 · CRN on");
    expect(by["Steady state from"]).toBe("week 13");
    expect(by.Horizon).toBe("156 weeks");
    expect(by["Analysis window"]).toBe("143 weeks");
    expect(by["CI level / ε"]).toBe("95% · ε ±5% of mean");
  });
});

describe("what was never recorded is said, not defaulted", () => {
  it("a backfilled protocol's unknown keys read as predating protocols", () => {
    const old = {
      ...card,
      engine_fingerprint: null,
      protocol: { ...card.protocol!, horizon_weeks: null as unknown as number, backfilled: true, unknown: ["horizon_weeks"] },
    };
    const lines = validatedModelLines(old, { graphVersionNo: null, policyVersionNo: null });
    const horizon = lines.find((l) => l.label === "Horizon")!;
    expect(horizon.value).toBeNull();
    expect(horizon.reason).toMatch(/predates protocols/);
    const engine = lines.find((l) => l.label === "Engine")!;
    expect(engine.value).toBeNull();
    expect(engine.reason).toMatch(/not recorded/);
    expect(lines.find((l) => l.label === "Snapshot")!.value).toBe("f00dbab (version number not loaded)");
  });

  it("a face-validated model shows the statement it rests on", () => {
    const face = { ...card, basis: "face" as const, validation_tests: [], face_validation: "Reviewed with ops." };
    expect(validatedModelLines(face, refs).find((l) => l.label === "Evidence")!.value).toBe(
      "statement: “Reviewed with ops.”",
    );
  });
});

describe("the card's action and its staleness", () => {
  const render = (credibility: Parameters<typeof ValidatedModelSummary>[0]["credibility"]) =>
    renderToStaticMarkup(
      createElement(MemoryRouter, null, createElement(ValidatedModelSummary, { card, credibility, projectId: "p1" })),
    );

  it("its primary action opens the model in the Lab", () => {
    expect(modelDeepLink("p1", "m1")).toBe("/simulation-lab?project=p1&model=m1");
    const html = render({ state: "validated", card });
    expect(html).toContain("Open in Simulation Lab");
    expect(html).toContain('href="/simulation-lab?project=p1&amp;model=m1"');
    expect(html).toContain("v4 · no period · Q4 baseline");
  });

  it("newer data never mutates the model — the card says re-validate", () => {
    const cred = { state: "stale" as const, card, drift: ["data" as const, "policy" as const] };
    expect(staleMessage(cred)).toBe("the simulation's inputs changed · a newer policy exists → re-validate");
    expect(render(cred)).toContain("the simulation&#x27;s inputs changed · a newer policy exists → re-validate");
    expect(staleMessage({ state: "validated", card })).toBeNull();
  });
});

describe("the Lab names the model a ?model= link opened", () => {
  it("in force, superseded, stale", () => {
    expect(openedModelLine({ ...card, model_code: "2026Q3" }, { state: "validated" })).toBe(
      "Model 2026Q3 · Q4 baseline · 37 replications · 156 weeks · results from wk 13 · valid",
    );
    expect(openedModelLine({ ...card, status: "superseded" }, { state: "validated" })).toMatch(
      /superseded by a newer model$/,
    );
    // §23 WP 13.3 — the opened line and the Lab's pill say the same thing about moved data.
    expect(openedModelLine(card, { state: "stale", drift: ["data"] })).toMatch(/a run replays the validated data$/);
    expect(openedModelLine(card, { state: "stale", drift: ["data", "policy"] })).toMatch(
      /the simulation's inputs changed · a newer policy exists → re-validate$/,
    );
  });
});

// WP 11.3 · §4 D259 — the model binds the simulation's inputs; a deep-tier change is a
// note the card SHOWS and never a reason to re-validate.
describe("the simulation inputs, and a change the simulation does not read", () => {
  it("a deep-tier change reads 'valid' with its note, never 're-validate'", () => {
    const line = openedModelLine(card, { state: "validated", notes: ["network"] });
    expect(line).toMatch(/valid \(the deep tier changed — not read by the simulation\)$/);
    expect(line).not.toMatch(/re-validate/);
    const html = renderToStaticMarkup(
      createElement(MemoryRouter, null, createElement(ValidatedModelSummary, {
        card, credibility: { state: "validated", card, notes: ["network"] }, projectId: "p1",
      })),
    );
    expect(html).toContain("the deep tier changed — not read by the simulation — the model stays as validated");
  });

  it("a model with no simulation hash says why, rather than printing the snapshot as its inputs", () => {
    const legacy = { ...card, hash_simulation: null, simulation_version_id: null };
    const l = validatedModelLines(legacy, refs).find((x) => x.label === "Data (simulation inputs)")!;
    expect(l.value).toBeNull();
    expect(l.reason).toMatch(/matched on its snapshot/);
  });
});

