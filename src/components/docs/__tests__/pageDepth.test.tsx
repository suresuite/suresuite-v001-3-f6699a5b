// Reader outcomes replace the former 500-word minimum: length is not task quality.
import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { StaticRouter } from "react-router-dom/server";
import { DOC_BODIES } from "../bodies";
import { getPage } from "../registry";

const render = (slug: string) => renderToStaticMarkup(createElement(StaticRouter,
  { location: `/docs/${slug}` }, createElement(DOC_BODIES[slug])));
const html = new Map(Object.keys(DOC_BODIES).map(slug => [slug, render(slug)]));
const journeys: Record<string, string[]> = {
  "your-first-project": ["create", "upload", "inspect", "policies", "disrupt", "reading-the-first-result"],
  "uploading-data": ["dependencies", "what-is-checked", "uploading-twice", "what-happens-after"],
  "how-policies-work": ["precedence", "worked-response", "save", "what-reaches-the-engine"],
  "reading-your-results": ["the-order", "the-panels", "worked-reading", "window", "trust"],
  "getting-an-api-key": ["creating-one", "first-request", "submit", "errors"],
};
describe("reader journeys and destinations", () => {
  it.each(Object.keys(journeys))("%s carries its task checkpoints and a rendered visual", slug => {
    const body = html.get(slug)!;
    for (const id of journeys[slug]) expect(body).toContain(`id="${id}"`);
    expect(body).toContain('<figure');
    expect(body).not.toMatch(/not drawn yet|To fill it:|Work package \d|§4 D\d/);
  });
  it("resolves rendered documentation links, including fragments", () => {
    for (const [source, body] of html) {
      for (const match of body.matchAll(/href="\/docs\/([^"?]+)"/g)) {
        const [slug, fragment] = match[1].split('#');
        if (existsSync(`public/docs/${slug}`)) continue;
        expect(getPage(slug), `${source} links to missing ${slug}`).toBeDefined();
        if (fragment) expect(html.get(slug), `${source} links to missing ${slug}#${fragment}`).toContain(`id="${fragment}"`);
      }
    }
  });
});

// Protect the public reading path and the URLs old pages already link to.
describe("first-reader overview", () => {
  const overview = ["what-suresuite-is", "how-suresuite-is-designed", "how-your-data-flows", "what-happens-to-your-data", "system-boundary", "known-limits", "data-model"];
  it.each(overview)("%s opens with takeaways and keeps engineering evidence out of the body", slug => {
    const body = html.get(slug)!;
    expect(body.indexOf("In short")).toBeLessThan(body.indexOf("<section"));
    expect(body).not.toMatch(/§4 D\d|Work package \d|[a-z/]+\.tsx?:\d+/i);
    expect(body).toContain('href="/docs/');
  });
  it("keeps limits anchors and the explicit security warning", () => {
    const body = html.get("known-limits")!;
    for (const id of ["data-limits", "documentation-limits", "how-to-use", "model-limits", "why-at-the-front"]) {
      expect(body).toContain(`id="${id}"`);
    }
    for (const slug of ["known-limits", "how-suresuite-is-designed"]) {
      expect(html.get(slug)).toContain("incomplete caller authorization on the browser simulation endpoint");
    }
  });
  it("keeps the seven-step journey and glossary definitions reachable", () => {
    const body = html.get("how-your-data-flows")!;
    for (const id of ["upload", "check", "promote", "compute", "decide", "freeze", "stamp"]) expect(body).toContain(`id="${id}"`);
    for (const id of ["staged", "promotion", "natural-key", "canonical", "frozen"]) expect(html.get("glossary")).toContain(`id="${id}"`);
    expect(body).toContain("P-CONTROL");
    expect(body).toContain("M-CASE");
  });
});
