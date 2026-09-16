// The manual's structural gate (WP 5.2a).
//
// The registry is the site map for eighty pages that eight work packages will
// fill in one at a time, across sessions that will not have read each other's
// code. Everything asserted here is a mistake one of those packages could make
// silently — a slug that collides, a body with no entry, a "planned" page that
// names no owner, a cross-reference to a table that has since been renamed.
//
// None of it is style. Each case below is a way the manual could become wrong
// without anything failing, which is the failure mode PLAN.md exists to close.

import { describe, expect, it } from "vitest";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { ALL_PAGES, DEFAULT_SLUG, DOC_GROUPS, getPage, prevNext, searchPages } from "../registry";
import { DOC_BODIES } from "../bodies";
import { LEGACY_SLUGS } from "../legacySlugs";
import introspected from "../../../../build/schema.introspected.json";
import { COUNTS, TIERS, UNDESCRIBED } from "../generated/dataModel.generated";
import { REFERENCE_TABLES, REFERENCE_COLUMN_COUNT } from "../generated/reference.generated";
import { UNIT_DAYS } from "../../../../supabase/functions/_shared/grading";

const ROOT = join(__dirname, "..", "..", "..", "..");
const live = ALL_PAGES.filter((p) => p.status === "live");
const planned = ALL_PAGES.filter((p) => p.status === "planned");

describe("the site map", () => {
  it("covers all 15 sections of PLAN.md §6.3, numbered 1..15 in order", () => {
    expect(DOC_GROUPS.map((g) => g.section)).toEqual(
      Array.from({ length: 15 }, (_, i) => i + 1),
    );
  });

  it("gives every section a blurb, so a stub can say what its section is for", () => {
    for (const g of DOC_GROUPS) {
      expect(g.blurb.length, `section ${g.section} (${g.group})`).toBeGreaterThan(10);
    }
  });

  it("has no duplicate slug", () => {
    const seen = new Set<string>();
    for (const p of ALL_PAGES) {
      expect(seen.has(p.slug), `duplicate slug "${p.slug}"`).toBe(false);
      seen.add(p.slug);
    }
  });

  it("uses URL-safe slugs", () => {
    for (const p of ALL_PAGES) {
      expect(p.slug, `slug "${p.slug}"`).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
  });

  it("never uses a slug that public/docs/ would shadow", () => {
    // The manual lives at /docs and `public/docs/` serves real files at the
    // same prefix. A static host serves the file and never reaches the SPA, so
    // a slug that matched one would be a page nobody could open. Today every
    // file there ends in `.md` and the slug pattern above forbids a dot — this
    // test is what keeps that true if either side changes.
    const shadowed = new Set(readdirSync(join(ROOT, "public", "docs")));
    for (const p of ALL_PAGES) {
      expect(shadowed.has(p.slug), `slug "${p.slug}" is shadowed by public/docs/`).toBe(false);
    }
  });

  it("starts on a page that exists and is written", () => {
    const home = getPage(DEFAULT_SLUG);
    expect(home, `DEFAULT_SLUG "${DEFAULT_SLUG}"`).toBeDefined();
    expect(home?.status).toBe("live");
  });
});

describe("pages and their bodies", () => {
  it("gives every live page a body", () => {
    for (const p of live) {
      expect(DOC_BODIES[p.slug], `live page "${p.slug}" has no body`).toBeDefined();
    }
  });

  it("has no body without a page — an unreachable body is dead code", () => {
    for (const slug of Object.keys(DOC_BODIES)) {
      expect(getPage(slug), `body "${slug}" is in no section`).toBeDefined();
    }
  });

  it("never ships a body for a page still marked planned", () => {
    for (const p of planned) {
      expect(DOC_BODIES[p.slug], `"${p.slug}" has a body but is marked planned`).toBeUndefined();
    }
  });

  it("names the work package that owes every planned page", () => {
    for (const p of planned) {
      expect(p.wp, `planned page "${p.slug}" names no work package`).toMatch(/^5\.2[b-h]$/);
    }
  });

  it("ships sections 1, 2 and 15 in full — WP 5.2a's and WP 5.2h's scope", () => {
    for (const g of DOC_GROUPS.filter((x) => x.section <= 2 || x.section === 15)) {
      for (const p of g.pages) {
        expect(p.status, `${g.group} / ${p.title}`).toBe("live");
      }
    }
    // 10 from WP 5.2a + 4 from WP 5.2h. A later package raises this as it
    // ships; it is here so that flipping a `status` without writing a body,
    // or the reverse, cannot pass unnoticed.
    expect(live).toHaveLength(14);
  });

  it("gives every page a summary — it is what a stub and a search hit show", () => {
    for (const p of ALL_PAGES) {
      expect(p.summary?.length ?? 0, `page "${p.slug}"`).toBeGreaterThan(10);
    }
  });
});

describe("cross-references", () => {
  it("only names tables the schema actually has", () => {
    const real = new Set(introspected.tables.map((t: { name: string }) => t.name));
    for (const p of ALL_PAGES) {
      if (!p.table) continue;
      expect(real.has(p.table), `page "${p.slug}" references missing table "${p.table}"`).toBe(true);
    }
  });

  it("never points two pages at the same table", () => {
    const seen = new Map<string, string>();
    for (const p of ALL_PAGES) {
      if (!p.table) continue;
      expect(seen.has(p.table), `"${p.table}" is claimed by both "${seen.get(p.table)}" and "${p.slug}"`).toBe(false);
      seen.set(p.table, p.slug);
    }
  });

  it("resolves every related-page link", () => {
    for (const p of ALL_PAGES) {
      for (const r of p.related ?? []) {
        expect(getPage(r), `"${p.slug}" relates to missing page "${r}"`).toBeDefined();
      }
    }
  });

  it("redirects every legacy slug to a page that exists", () => {
    for (const [from, to] of Object.entries(LEGACY_SLUGS)) {
      expect(getPage(to), `/help/${from} redirects to missing page "${to}"`).toBeDefined();
    }
  });
});

describe("navigation", () => {
  it("never pages a reader onto a stub", () => {
    for (const p of ALL_PAGES) {
      const { prev, next } = prevNext(p.slug);
      expect(prev?.status ?? "live").toBe("live");
      expect(next?.status ?? "live").toBe("live");
    }
  });

  it("walks the live pages in order, first to last", () => {
    expect(prevNext(live[0].slug).prev).toBeUndefined();
    expect(prevNext(live[live.length - 1].slug).next).toBeUndefined();
    expect(prevNext(live[0].slug).next?.slug).toBe(live[1].slug);
  });

  it("finds planned pages too, but ranks written ones first", () => {
    const hits = searchPages("data");
    expect(hits.length).toBeGreaterThan(1);
    const firstPlanned = hits.findIndex((h) => h.status === "planned");
    const lastLive = hits.map((h) => h.status).lastIndexOf("live");
    if (firstPlanned >= 0 && lastLive >= 0) expect(lastLive).toBeLessThan(firstPlanned);
  });

  it("finds a planned page by a term only it carries", () => {
    // "No matches" for a feature the product has would read as "we do not do
    // this", which is exactly the false impression T3 forbids.
    expect(searchPages("idempotency").map((h) => h.slug)).toContain("rate-limits-and-idempotency");
  });
});

describe("the generated data-model module", () => {
  it("accounts for every table in the schema, exactly once", () => {
    const described = TIERS.flatMap((t) => t.tables.map((x) => x.table));
    const undescribed = UNDESCRIBED.flatMap((g) => g.tables.map((x) => x.table));
    const all = [...described, ...undescribed];
    expect(new Set(all).size, "a table is listed twice").toBe(all.length);
    expect(all.sort()).toEqual(introspected.tables.map((t: { name: string }) => t.name).sort());
  });

  it("agrees with its own counts", () => {
    expect(COUNTS.tablesInSchema).toBe(introspected.tables.length);
    expect(COUNTS.tablesDescribed).toBe(TIERS.flatMap((t) => t.tables).length);
    expect(COUNTS.tablesUndescribed).toBe(UNDESCRIBED.flatMap((g) => g.tables).length);
  });

  it("names a work package for every table it cannot describe", () => {
    for (const g of UNDESCRIBED) {
      expect(g.wp, "an undescribed group with no work package").toMatch(/^\d+\.\d+$/);
      expect(g.why.length, `WP ${g.wp} gives no reason`).toBeGreaterThan(20);
    }
  });
});

describe("the generated reference module (WP 5.2h)", () => {
  it("describes exactly the tables the contract describes", () => {
    const described = TIERS.flatMap((t) => t.tables.map((x) => x.table)).sort();
    expect(REFERENCE_TABLES.map((t) => t.table).sort()).toEqual(described);
  });

  it("carries every described column — the field index cannot undercount", () => {
    const counted = REFERENCE_TABLES.reduce((n, t) => n + t.columns.length, 0);
    expect(counted).toBe(REFERENCE_COLUMN_COUNT);
    expect(counted).toBe(COUNTS.columnsDescribed);
  });

  it("gives every column a name and a type, and no duplicates within a table", () => {
    for (const t of REFERENCE_TABLES) {
      const seen = new Set<string>();
      for (const c of t.columns) {
        expect(c.name.length, `${t.table} has an unnamed column`).toBeGreaterThan(0);
        expect(c.type.length, `${t.table}.${c.name} has no type`).toBeGreaterThan(0);
        expect(seen.has(c.name), `${t.table}.${c.name} appears twice`).toBe(false);
        seen.add(c.name);
      }
    }
  });

  it("leads with the CSV header wherever one exists — D21", () => {
    // The page renders `csvHeader ?? name`. If no described table recorded a
    // header, that rendering is vacuous and D21 is not actually closed here.
    const withHeader = REFERENCE_TABLES.flatMap((t) => t.columns).filter((c) => c.csvHeader);
    expect(withHeader.length).toBeGreaterThan(0);
  });

  it("reads the unit table rather than restating it", () => {
    // The units page imports UNIT_DAYS directly. This asserts the import is
    // live and non-empty, and pins the one value D10 was about: `quarter` was
    // read as weekly by the old SQL, 13x its real value.
    expect(Object.keys(UNIT_DAYS).length).toBeGreaterThan(0);
    expect(UNIT_DAYS.quarter).toBe(91.3125);
    expect(UNIT_DAYS.week).toBe(7);
  });

  it("declares a unit on every column the units page would list", () => {
    const united = REFERENCE_TABLES.flatMap((t) => t.columns).filter((c) => c.unit);
    for (const c of united) expect(c.unit!.trim().length).toBeGreaterThan(0);
  });
});
