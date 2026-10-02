/**
 * WP 10.5 — the Lab's Model and Engine steps. Rendered to static markup (vitest
 * runs in node), as `validatedModelSummary.test.tsx` does.
 */
import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { LabModelStep, type LabModelStepProps } from "../LabModelStep";
import type { ModelValidationCard } from "@/hooks/useModelValidation";

const model = (over: Partial<ModelValidationCard> = {}): ModelValidationCard => ({
  id: "m2", project_id: "p", policy_version_id: "pv", policy_hash: "abcdef1234", dataset_version_id: "dv",
  graph_hash: "f00dbabe99", scenario_hash: "s", scenario_fingerprint: {}, engine_fingerprint: "scsim-0.2.8",
  adopted_warmup_days: 84, warmup_method: "mser5", recommended_replications: 30, replication_basis: {},
  validation_tests: [], findings_snapshot: [], verdict: "validated", basis: "statistical", evidence_run_id: null,
  status: "active", validated_at: "2026-09-20T00:00:00Z", author_email: null, created_at: "2026-09-20T00:00:00Z",
  name: "Q4 baseline", version_no: 2,
  protocol: { replications: 30, root_seed: 42, crn: true, warmup_week: 12, horizon_weeks: 52,
    analysis_window_weeks: 40, ci_level: 0.95, ci_halfwidth_target: 0.05, stopping_rule: "fixed_horizon" },
  ...over,
});

const base = (over: Partial<LabModelStepProps> = {}): LabModelStepProps => ({
  models: [model()],
  chosen: model(),
  onChoose: () => {},
  credibility: { state: "validated", card: model() },
  exploratory: false,
  onExploratory: () => {},
  canExplore: true,
  engines: [{ id: "e1", slug: "scsim", name: "scsim — the strategic engine", version: "0.2.8",
    code_version: "scsim-0.2.8", reported_at: "2026-10-01T00:00:00Z" }],
  enginesLoading: false,
  engineId: null,
  onEngine: () => {},
  deviations: [],
  advanced: false,
  onAdvanced: () => {},
  ...over,
});
const html = (p: LabModelStepProps) => renderToStaticMarkup(createElement(LabModelStep, p));
const text = (h: string) =>
  h.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#x27;/g, "'").replace(/\s+/g, " ");

describe("Model → Engine, with the protocol locked", () => {
  it("offers the model by name, number and protocol, and says it is in force", () => {
    const t = text(html(base()));
    expect(t).toContain("Q4 baseline v2 · 30 seeds · steady from wk 12 · 52 wks");
    expect(t).toContain("in force");
  });
  it("names the engine with its version and the build the worker reported", () => {
    expect(text(html(base()))).toContain("scsim — the strategic engine · 0.2.8 · scsim-0.2.8");
    expect(text(html(base({ engines: [{ ...base().engines[0], code_version: null }] })))).toContain(
      "build ?",
    );
  });
  it("shows the protocol LOCKED, and lists nothing when nothing deviates", () => {
    const h = html(base());
    const t = text(h);
    expect(t).toContain("locked");
    expect(t).toContain("Advanced");
    expect(h).not.toContain('data-testid="protocol-deviations"');
  });
  it("lists every deviation as model → run, recorded on the run", () => {
    const t = text(html(base({
      advanced: true,
      deviations: [{ key: "replications", label: "Replications", model: 30, run: 10 }],
    })));
    expect(t).toContain("unlocked");
    expect(t).toContain("Replications: 30 → 10");
    expect(t).toContain("recorded on the run");
  });
});

describe("the exploratory path is an editor's, and it is badged", () => {
  it("an editor sees the choice; a non-editor does not", () => {
    expect(text(html(base()))).toContain("Exploratory run (unvalidated)");
    expect(text(html(base({ canExplore: false })))).not.toContain("Exploratory run");
  });
  it("an exploratory run is badged and shows no protocol to follow", () => {
    const h = html(base({ exploratory: true }));
    expect(h).toContain('data-testid="exploratory-badge"');
    expect(h).not.toContain('data-testid="model-protocol"');
  });
});

describe("staleness and the run-the-model action", () => {
  it("a stale model says re-validate", () => {
    const t = text(html(base({ credibility: { state: "stale", card: model(), drift: ["data"] } })));
    // WP 11.2 — `data` drift is the simulation's INPUTS, which is what it now says.
    expect(t).toContain("the simulation's inputs changed → re-validate");
  });
  it("a deep-tier change is a note beside 'in force', never 're-validate' (WP 11.3)", () => {
    const t = text(html(base({ credibility: { state: "validated", card: model(), notes: ["network"] } })));
    expect(t).toContain("in force");
    expect(t).toContain("the deep tier changed — not read by the simulation");
    expect(t).not.toContain("re-validate");
  });
  it("Run this model is offered on the baseline, and disabled with its reason", () => {
    const ok = html(base({ onRunModel: () => {} }));
    expect(ok).toContain("Run this model");
    expect(ok).not.toMatch(/<button[^>]*disabled[^>]*>Run this model/);
    const refused = html(base({ onRunModel: () => {}, runModelReason: "A newer graph makes this model stale" }));
    expect(refused).toMatch(/<button[^>]*disabled[^>]*>Run this model/);
    expect(text(refused)).toContain("A newer graph makes this model stale");
  });
  it("with no model at all, it says where to make one", () => {
    expect(text(html(base({ models: [], chosen: null })))).toContain("create one in Policies › Run & Validate");
  });
});
