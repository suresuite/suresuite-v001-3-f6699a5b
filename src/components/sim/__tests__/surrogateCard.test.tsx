/**
 * WP 9.4 slice 3 — the surrogate model is signposted, not simulated. Rendered to
 * static markup (vitest runs in node with no DOM), as `bodies.test.tsx` does.
 */
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SurrogateCard } from "../SurrogateCard";

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
