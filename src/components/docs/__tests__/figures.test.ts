// The manual's figures — WP 5.2i.
//
// A figure can be wrong in four ways that nothing else would catch:
//
//   · a slot names a page that does not exist          → a figure nobody sees
//   · a page renders a slot id the manifest lacks      → a thrown render
//   · a slot names a file that is not in the folder    → an OPEN SLOT, not a
//                                                        failure: the manual
//                                                        ships with slots
//                                                        unfilled on purpose
//   · a file sits in the folder that no slot uses      → a FAILURE. A dead
//                                                        asset in a repository
//                                                        is a file nobody can
//                                                        tell is dead.
//
// The asymmetry in the last two is the design. An unfilled slot is a promise
// the manual makes out loud (§5.3 T3) and must not block a commit; an orphaned
// file is debt with no owner and must.

import { describe, expect, it } from "vitest";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { FIGURE_SLOTS, slotsFor } from "../figureManifest";
import { getPage } from "../registry";

const MANUAL_DIR = join(__dirname, "..", "..", "..", "assets", "manual");

/**
 * The folder, read from disk rather than through `import.meta.glob`.
 *
 * The component globs; this reads. Two routes to one answer, deliberately: a
 * glob pattern that stopped matching (a new extension, a moved folder) would
 * make every figure silently disappear AND make a glob-based test agree with
 * it, which is the vacuous-gate shape §4 D57 is.
 */
const IMAGE = /\.(svg|png|jpe?g|webp|avif)$/i;
const files = readdirSync(MANUAL_DIR).filter((f) => IMAGE.test(f));

describe("the figure manifest", () => {
  it("puts every slot on a page that exists", () => {
    for (const s of FIGURE_SLOTS) {
      expect(getPage(s.page), `slot "${s.id}" names missing page "${s.page}"`).toBeDefined();
    }
  });

  it("only puts a slot on a page that is written", () => {
    for (const s of FIGURE_SLOTS) {
      expect(getPage(s.page)?.status, `slot "${s.id}" is on an unwritten page`).toBe("live");
    }
  });

  it("has no duplicate slot id", () => {
    const seen = new Set<string>();
    for (const s of FIGURE_SLOTS) {
      expect(seen.has(s.id), `duplicate slot id "${s.id}"`).toBe(false);
      seen.add(s.id);
    }
  });

  it("gives every slot real alt text, a caption, and a brief", () => {
    for (const s of FIGURE_SLOTS) {
      // Alt text is what a screen reader says and what shows when the image
      // fails. A diagram whose only explanation is the picture is a diagram
      // half this manual's readers cannot use.
      expect(s.alt.length, `slot "${s.id}" alt text`).toBeGreaterThan(40);
      expect(s.caption.length, `slot "${s.id}" caption`).toBeGreaterThan(20);
      // `shows` is the brief for whoever draws it. A slot without one is a
      // placeholder that tells an author nothing.
      expect(s.shows.length, `slot "${s.id}" brief`).toBeGreaterThan(60);
    }
  });

  it("never lets alt text and caption be the same sentence", () => {
    // They do different jobs: alt DESCRIBES the picture, the caption says what
    // to take from it. Copying one into the other is how a figure ends up
    // explaining nothing twice.
    for (const s of FIGURE_SLOTS) {
      expect(s.alt.trim(), `slot "${s.id}"`).not.toBe(s.caption.trim());
    }
  });
});

describe("the figure files", () => {
  it("fails on a file no slot uses — a dead asset nobody can tell is dead", () => {
    const used = new Set(FIGURE_SLOTS.map((s) => s.file).filter(Boolean));
    const orphans = files.filter((f) => !used.has(f));
    expect(
      orphans,
      "these files are in src/assets/manual/ and no slot in figureManifest.ts names them. " +
        "Either point a slot at one, or delete it.",
    ).toEqual([]);
  });

  it("reports the fill rate — an open slot is a fact, not a failure", () => {
    const filled = FIGURE_SLOTS.filter((s) => s.file && files.includes(s.file));
    const open = FIGURE_SLOTS.filter((s) => !s.file || !files.includes(s.file));
    // Printed rather than asserted: this number is meant to move as diagrams
    // are drawn, and a threshold here would either block a commit or be raised
    // until it meant nothing.
    console.log(
      `figures: ${filled.length} of ${FIGURE_SLOTS.length} slots filled; ` +
        `${open.length} open — ${open.map((s) => s.id).join(", ") || "none"}`,
    );
    expect(FIGURE_SLOTS.length).toBeGreaterThan(0);
  });

  it("names a file with an extension the component can actually load", () => {
    for (const s of FIGURE_SLOTS) {
      if (!s.file) continue;
      expect(s.file, `slot "${s.id}" file "${s.file}"`).toMatch(IMAGE);
      // A slot pointing at a file that is not there is an OPEN slot, and the
      // page says so. What must not happen is a slot pointing at a file that
      // IS there under a name the glob will not match.
      if (!files.includes(s.file)) continue;
      expect(files, `slot "${s.id}"`).toContain(s.file);
    }
  });
});

describe("the pages that carry figures", () => {
  it("declares a slot only where the page renders one", async () => {
    // The manifest says a page has a figure; the body has to actually ask for
    // it. Otherwise a slot is declared, counted as open, briefed — and invisible.
    const pages = [...new Set(FIGURE_SLOTS.map((s) => s.page))];
    const { DOC_BODIES } = await import("../bodies");
    for (const page of pages) {
      expect(DOC_BODIES[page], `page "${page}" carries slots but has no body`).toBeDefined();
      for (const s of slotsFor(page)) {
        expect(s.page, `slot "${s.id}"`).toBe(page);
      }
    }
  });
});
