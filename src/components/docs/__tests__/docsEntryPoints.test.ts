/**
 * The manual's public entry points (PLAN.md §6.5).
 *
 * §6.5's argument for publishing the architecture is that "a prospective
 * customer, a researcher and a new modeller all ask the same opening question",
 * and that answering it should not require an account. The routes have been
 * public since WP 5.2a — and for that whole time NOTHING LINKED TO THEM. The
 * manual was reachable only by typing the address, which is public in the same
 * sense an unlisted phone number is.
 *
 * That is the failure this file exists to catch, and it is a silent one: a
 * link is one attribute in a nav, removing it breaks no build, no type and no
 * render, and the page it orphans goes on rendering perfectly for anyone who
 * already knows where it is. Nothing else in the suite would notice.
 *
 * WHAT IS ASSERTED, AND WHY EACH ONE IS A WAY IT COULD GO WRONG AGAIN:
 *   · the public pages link to /docs — the orphaning above, exactly
 *   · the phone nav links to it too — the desktop row is `hidden` below `md`,
 *     so a link added only there is invisible on the device most first visits
 *     arrive on
 *   · every /docs/<slug> deep link on a public page is a LIVE page — a
 *     marketing card pointing at a stub sells a page that says "not written
 *     yet", which is worse than not linking it
 *   · the manual links back out, to the site and to sign-in — a reader who
 *     arrives from a search result is otherwise in a room with no doors
 *   · /docs still resolves to the front door — the index route is one word,
 *     and reverting it to DocPage silently reopens the manual mid-article
 *
 * Source text rather than a render: what is being asserted is that the LINK
 * EXISTS IN THE TREE, and a render test of Landing would need auth, viewport
 * and three.js to say the same thing less directly.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getPage } from "../registry";

const ROOT = join(__dirname, "..", "..", "..", "..");
const read = (...parts: string[]) => readFileSync(join(ROOT, ...parts), "utf8");

const LANDING = read("src", "pages", "Landing.tsx");
const ABOUT = read("src", "pages", "About.tsx");
const DOCS_LAYOUT = read("src", "components", "docs", "DocsLayout.tsx");
const DOCS_HOME = read("src", "components", "docs", "DocsHome.tsx");
const APP = read("src", "App.tsx");

/**
 * Every manual page a source names.
 *
 * Two spellings, because both are in use and both rot the same way: a literal
 * `/docs/<slug>` in a link, and a `slug:` field in a card list the page then
 * maps over. Template holes (`/docs/${x}`) are skipped — the slug is in the
 * data, which the second pattern already reads.
 */
function docSlugs(source: string) {
  const literal = [...source.matchAll(/["'`]\/docs\/([^"'`{}\s]+)["'`]/g)].map((m) => m[1]);
  const fields = [...source.matchAll(/\bslug:\s*["']([a-z0-9-]+)["']/g)].map((m) => m[1]);
  return [...new Set([...literal, ...fields])].filter((slug) => !slug.includes("$"));
}

describe("the public site points at the manual", () => {
  it.each([
    ["Landing.tsx", LANDING],
    ["About.tsx", ABOUT],
  ])("%s links to /docs", (_name, source) => {
    expect(source).toMatch(/to="\/docs"/);
  });

  it("puts Docs in the landing page's phone nav, not only the desktop row", () => {
    // The desktop links carry `hidden md:inline-flex`; the drawer is what a
    // phone gets. A link in the first and not the second is a link most first
    // visits never see.
    // Bounded at `<main`, not at end-of-file: the first draft of this test
    // sliced to the end and passed on the FOOTER's link after the drawer's was
    // deleted — the assertion was true of the file rather than of the drawer.
    const start = LANDING.indexOf("Mobile nav drawer");
    const end = LANDING.indexOf("<main", start);
    expect(start, "the drawer is gone entirely").toBeGreaterThan(-1);
    expect(end, "no <main> after the drawer to bound it").toBeGreaterThan(start);
    expect(LANDING.slice(start, end)).toMatch(/to="\/docs"/);
  });

  it("links to the manual from the footer as well as the nav", () => {
    const footer = LANDING.slice(LANDING.indexOf("<footer"));
    expect(footer).toMatch(/to="\/docs"/);
  });
});

describe("public deep links land on written pages", () => {
  it.each([
    ["Landing.tsx", LANDING],
    ["DocsHome.tsx", DOCS_HOME],
  ])("%s only deep-links to live pages", (name, source) => {
    const links = docSlugs(source);
    expect(links.length, `${name} deep-links to nothing`).toBeGreaterThan(0);
    for (const slug of links) {
      const page = getPage(slug);
      expect(page, `${name} links to unknown page "${slug}"`).toBeDefined();
      expect(page?.status, `${name} links to "${slug}", which is not written`).toBe("live");
    }
  });
});

describe("the manual is not a room with no doors", () => {
  it("carries the site's own top bar back to / and to sign-in", () => {
    expect(DOCS_LAYOUT).toMatch(/to="\/"/);
    expect(DOCS_LAYOUT).toMatch(/to="\/auth"/);
    expect(DOCS_LAYOUT).toMatch(/to="\/about"/);
  });

  it("opens /docs on the front door rather than mid-manual", () => {
    expect(APP).toMatch(/<Route index element={<DocsHome \/>} \/>/);
  });
});
