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
 * THE ADVERTISING CAN BE SWITCHED OFF, AND THIS FILE IS WHY IT IS A SWITCH.
 * `DOCS_PUBLIC_ENTRY_POINTS` (src/lib/ui/docsVisibility.ts) hides every one of
 * them at once. Hiding them by DELETING the markup would have meant
 * deleting the assertions below with it — and then the invariant §6.5 argues
 * for survives only as a comment, which is the same silent failure one level
 * up. So the flag is the single source and this gate reads it:
 *   · flag ON  — every surface links to the manual, exactly as before
 *   · flag OFF — every surface still CARRIES that markup, and every one of
 *     them is guarded by the flag, so flipping one line restores the links and
 *     these assertions together. A surface deleted outright fails either way.
 *
 * Source text rather than a render: what is being asserted is that the LINK
 * EXISTS IN THE TREE, and a render test of Landing would need auth, viewport
 * and three.js to say the same thing less directly.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getPage } from "../registry";
import { DOCS_PUBLIC_ENTRY_POINTS } from "../../../lib/ui/docsVisibility";

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

const GUARD = "DOCS_PUBLIC_ENTRY_POINTS";

/**
 * One surface of the public site, as a SLICE of its page's source.
 *
 * Bounded rather than whole-file, and the reason is a bug this file already
 * had: the first draft of the drawer assertion sliced to end-of-file and went
 * on passing on the FOOTER's link after the drawer's was deleted — the
 * assertion was true of the file rather than of the surface it named. Every
 * bound below is a marker that would have to be deleted for the slice to be
 * wrong, and `cut` fails loudly when one goes missing.
 */
type Surface = { name: string; source: string; from: string; to?: string };

function cut({ name, source, from, to }: Surface): string {
  const start = source.indexOf(from);
  expect(start, `${name}: no "${from}" left to bound the slice`).toBeGreaterThan(-1);
  if (to === undefined) return source.slice(start);
  const end = source.indexOf(to, start + from.length);
  expect(end, `${name}: no "${to}" after "${from}"`).toBeGreaterThan(start);
  return source.slice(start, end);
}

/** Every surface §6.5 puts the manual on, across both public pages. The
 *  desktop row and the phone drawer are listed separately on purpose: the
 *  desktop links carry `hidden md:inline-flex`, so a link present in one and
 *  not the other is invisible on the device most first visits arrive on. */
const SURFACES: Surface[] = [
  { name: "Landing desktop top bar", source: LANDING, from: "{/* Top bar */}", to: "{/* Mobile nav drawer */}" },
  { name: "Landing phone drawer", source: LANDING, from: "Mobile nav drawer", to: "<main" },
  { name: "Landing Documentation section", source: LANDING, from: "Documentation — the manual, in public", to: "{/* Technical Architecture */}" },
  { name: "Landing footer", source: LANDING, from: "<footer" },
  { name: "About desktop top bar", source: ABOUT, from: "<header", to: "</header>" },
  { name: "About footer", source: ABOUT, from: "<footer" },
];

describe.runIf(DOCS_PUBLIC_ENTRY_POINTS)("the public site points at the manual", () => {
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

describe.runIf(!DOCS_PUBLIC_ENTRY_POINTS)("the manual is hidden by the flag, not by deletion", () => {
  it.each([
    ["Landing.tsx", LANDING],
    ["About.tsx", ABOUT],
  ])("%s reads the flag rather than hard-coding the answer", (_name, source) => {
    expect(source).toContain(GUARD);
  });

  it.each(SURFACES.map((s) => [s.name, s] as const))("%s still carries the link, guarded", (_name, surface) => {
    const slice = cut(surface);
    expect(
      slice,
      `${surface.name} no longer mentions /docs at all. The flag is meant to be ` +
        `flipped back — hiding a surface means guarding its markup, not deleting it.`,
    ).toMatch(/to="\/docs"/);
    expect(
      slice,
      `${surface.name} links /docs but names no ${GUARD}. Either the guard was ` +
        `removed — the link is live again while the flag says it is not — or the ` +
        `surface was rewritten without one.`,
    ).toContain(GUARD);
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
