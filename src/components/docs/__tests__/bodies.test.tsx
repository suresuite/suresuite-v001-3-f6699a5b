// Every page of the manual actually renders — WP 5.2b.
//
// `registry.test.ts` asserts the site map's SHAPE: a body exists for every live
// page, no slug collides, every cross-reference resolves. None of that executes
// a body. A page that reads `t.columns` on a table the contract does not
// describe, or destructures a field the generator stopped emitting, passes
// every one of those assertions and is a blank screen.
//
// This renders each body to static markup and requires real output. It is the
// cheapest possible end-to-end check and it is the one that would have caught
// D57's shape if D57 had been a runtime error rather than a type error.
//
// Rendered rather than mounted: this repository's vitest runs in node with no
// DOM, and `renderToStaticMarkup` needs none. What it cannot see is behaviour
// after hydration — a collapsed block opening, a link being clicked. Those are
// `<details>` and `<Link>`, which is deliberate: the manual has no page whose
// content depends on JavaScript having run.

import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { DOC_BODIES } from "../bodies";
import { ALL_PAGES, getPage } from "../registry";

function render(slug: string) {
  const Body = DOC_BODIES[slug];
  return renderToStaticMarkup(
    createElement(MemoryRouter, { initialEntries: [`/docs/${slug}`] }, createElement(Body)),
  );
}

describe("every live page renders", () => {
  const slugs = Object.keys(DOC_BODIES).sort();

  it.each(slugs)("%s", (slug) => {
    const html = render(slug);
    // A body that renders an empty fragment is a live page showing nothing,
    // which is worse than a stub: the stub at least says it is unwritten.
    expect(html.length, `${slug} rendered ${html.length} characters`).toBeGreaterThan(800);
    expect(html, `${slug} has no heading`).toContain("<h1");
  });

  it("leads every page with the title the registry promises", () => {
    // The nav, the search hit and the page itself have to agree, or a reader
    // clicks "Deep-Tier Nodes" and lands on something else.
    for (const slug of slugs) {
      const title = getPage(slug)!.title;
      const h1 = /<h1[^>]*>([\s\S]*?)<\/h1>/.exec(render(slug))?.[1] ?? "";
      const text = h1.replace(/<[^>]+>/g, "").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").trim();
      // The em dash in "BOM — single level" survives; entities do not, so both
      // sides are compared after the same stripping.
      expect(text, `${slug}`).toBe(title.replace(/&amp;/g, "&"));
    }
  });

  it("never renders a raw markdown code span — the sidecars are written in them", () => {
    // `Prose` turns `like this` into <code>. A page that interpolates a
    // contract string directly prints the backticks, which reads as a typo in
    // generated text and quietly undermines what generated text is for.
    for (const slug of slugs) {
      const body = render(slug).replace(/<code[^>]*>[\s\S]*?<\/code>/g, "");
      expect(body.includes("`"), `${slug} prints a raw backtick`).toBe(false);
    }
  });
});

describe("the input-table pages carry what section 3 promises", () => {
  // §6.3 section 3: "purpose, where to upload, template, column-by-column
  // reference, example, notes, related tables". The two below are the ones a
  // page can silently lose by being rewritten, and they are the two the old
  // manual failed on (D21, and §5.3 T1).
  const tablePages = ALL_PAGES.filter((p) => p.section === 3 && p.table);

  it("names every page's own table in the tree", () => {
    expect(tablePages.length).toBeGreaterThan(0);
  });

  it.each(tablePages.map((p) => p.slug))("%s answers what a blank cell does", (slug) => {
    const html = render(slug);
    // Either the per-column line, or — for the four tables outside the
    // ingestion contract, which have no cell-level rules to state — the
    // sentence that says why there is none.
    expect(
      html.includes("If you leave it blank") || html.includes("Blank means blank"),
      `${slug} never tells a reader what happens to an empty cell`,
    ).toBe(true);
  });

  it.each(tablePages.map((p) => p.slug))("%s links on to related pages", (slug) => {
    expect(render(slug)).toContain('href="/docs/');
  });
});
