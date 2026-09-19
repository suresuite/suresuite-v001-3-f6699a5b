// A floor under every page — WP 5.2j.
//
// ── WHY THIS EXISTS, AND WHY IT DID NOT BEFORE ────────────────────────────
//
// §16 · WP 5.2i's gap check named the hole: "`registry.test.ts` counts pages and
// nothing counts what is on them. Eighty live pages with a body is what the gate
// asserts; a 260-word page and a 1 600-word page are identical to it." It
// declined to add a floor, for a good reason — "picking the number is a
// judgement about what a short page is allowed to be, and a threshold set
// carelessly is one that gets raised until it means nothing."
//
// That reason is now discharged rather than repeated. The number is 500,
// inherited from the brief that measured the manual rather than chosen here, and
// as of this package EVERY page clears it, so the floor is not a ratchet aimed
// at somebody else's work — it is where the manual already is.
//
// ── THE EXEMPTION LIST IS THE POINT ───────────────────────────────────────
//
// A page is allowed to be short when its subject IS short. `customer-stage` is
// the case that proved it: two columns, neither reaching the engine, and the
// honest page says so in fewer words than a padded one would take. So a page may
// sit below the floor by being named here WITH A REASON — and the test fails on
// an entry with no reason, and on an entry for a page that is no longer short,
// so the list cannot quietly become a place where thin pages go to be forgiven.
//
// It is empty today. That is the strongest statement the list can make.

import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { DOC_BODIES } from "../bodies";
import { getPage } from "../registry";

/** Rendered words, not source words: what a reader actually receives. */
const FLOOR = 500;

/**
 * Pages allowed below the floor, each with the reason its subject is small.
 * An entry whose page is ABOVE the floor fails — a stale excuse is worse than
 * none, because it reads as a standing permission.
 */
const SHORT_BY_SUBJECT: Record<string, string> = {};

function words(slug: string): number {
  const html = renderToStaticMarkup(
    createElement(
      MemoryRouter,
      { initialEntries: [`/docs/${slug}`] },
      createElement(DOC_BODIES[slug]),
    ),
  );
  const text = html
    .replace(/<style[\s\S]*?<\/style>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z#0-9]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text ? text.split(" ").length : 0;
}

describe("every page carries enough to be worth opening", () => {
  const slugs = Object.keys(DOC_BODIES).sort();
  const counts = new Map(slugs.map((s) => [s, words(s)]));

  it("prints the distribution", () => {
    const sorted = [...counts.values()].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    console.log(
      `manual depth: ${slugs.length} pages · median ${median} words · ` +
        `shortest ${sorted[0]} · ${sorted.filter((n) => n < FLOOR).length} below ${FLOOR}`,
    );
    expect(sorted.length).toBeGreaterThan(50);
  });

  it.each(slugs)("%s", (slug) => {
    const n = counts.get(slug)!;
    if (n >= FLOOR) return;
    const reason = SHORT_BY_SUBJECT[slug];
    expect(
      reason,
      `${slug} renders ${n} words, under the ${FLOOR}-word floor, and is not named in ` +
        `SHORT_BY_SUBJECT. Either the page is unfinished — apply the method in PLAN.md §6.4 ` +
        `and deepen it — or its SUBJECT is genuinely small, in which case name it there with ` +
        `the reason, the way customer-stage says its stage has two columns.`,
    ).toBeTruthy();
  });

  it("has no stale exemption", () => {
    for (const [slug, reason] of Object.entries(SHORT_BY_SUBJECT)) {
      expect(getPage(slug), `SHORT_BY_SUBJECT names "${slug}", which is not a page`).toBeDefined();
      expect(
        reason.length,
        `SHORT_BY_SUBJECT["${slug}"] has no reason — an exemption without one is a blanket`,
      ).toBeGreaterThan(20);
      expect(
        counts.get(slug)!,
        `${slug} is exempt from the floor and renders ${counts.get(slug)} words, above it. ` +
          `Remove the exemption rather than leaving a standing permission nobody needs.`,
      ).toBeLessThan(FLOOR);
    }
  });
});
