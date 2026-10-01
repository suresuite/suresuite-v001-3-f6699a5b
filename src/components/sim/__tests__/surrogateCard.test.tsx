/**
 * WP 9.4 slice 3 — the surrogate model is signposted, not simulated. Rendered to
 * static markup (vitest runs in node with no DOM), as `bodies.test.tsx` does.
 */
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SurrogateCard } from "../SurrogateCard";
import { trainingSetLine, type TrainingTotals } from "@/lib/sim/surrogateTraining";

describe("SurrogateCard", () => {
  const html = renderToStaticMarkup(createElement(SurrogateCard));

  it("names the feature and says it is not here yet", () => {
    expect(html).toContain("Surrogate model: nexus node detection");
    expect(html).toContain("coming soon");
  });

  it("offers nothing to click and prints no figure (T1)", () => {
    expect(html).not.toMatch(/<button|<a |onclick/i);
    expect(html.replace(/<[^>]+>/g, "")).not.toMatch(/\d/);
  });
});

// WP 10.8 · §4 D249 — one figure, and it is a count of what exists.
describe("SurrogateCard · the training set (WP 10.8)", () => {
  const t = (over: Partial<TrainingTotals> = {}): TrainingTotals => ({
    runs: 2, replications: 3, models: 1, graph_versions: 1, ...over,
  });

  it("states the set's size: replications, runs, models and graph versions", () => {
    expect(trainingSetLine(t({ runs: 4, replications: 34, models: 2, graph_versions: 2 })))
      .toBe("Training set: 34 replications · 4 runs · 2 Validated Models · 2 graph versions");
    expect(trainingSetLine(t({ runs: 1, replications: 1 })))
      .toBe("Training set: 1 replication · 1 run · 1 Validated Model · 1 graph version");
  });

  // §4 D254 — production's shape (§15 run 36863326325, probe 16): one run with one
  // replication, the evidence run three versions of one model share. The size is
  // one of each; summing the per-model groups said three.
  it("a run several models cite counts once (D254)", () => {
    expect(trainingSetLine({ runs: 1, replications: 1, models: 3, graph_versions: 1 }))
      .toBe("Training set: 1 replication · 1 run · 3 Validated Models · 1 graph version");
  });

  it("an empty set says what counts; an unread one says nothing", () => {
    expect(trainingSetLine(t({ runs: 0, replications: 0, models: 0, graph_versions: 0 })))
      .toMatch(/empty — only faithful runs of a Validated Model count; exploratory runs never do/);
    expect(trainingSetLine(null)).toBeNull();
  });

  it("renders the count on the card, still with nothing to click", () => {
    const withSet = renderToStaticMarkup(createElement(SurrogateCard, { training: t() }));
    expect(withSet).toContain("Training set: 3 replications");
    expect(withSet).toContain("coming soon");
    expect(withSet).not.toMatch(/<button|<a |onclick/i);
  });
});
