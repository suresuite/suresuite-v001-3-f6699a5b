/**
 * The manual's release keys and its prepared answers agree with the registry
 * (§4 D218, `20260930000012`).
 *
 * A section's audience is keyed by `DocGroup.key`, and the database seeds one
 * row per key. The key SET belongs to the registry — a CHECK listing it would
 * need a migration for every new section — so the column only checks the shape,
 * and this file checks the rest:
 *   · every key is unique and slug-shaped, so the database will accept it
 *   · the seed names exactly the registry's keys, all confidential, so deploying
 *     changes nothing and no seeded row points at a section that does not exist
 *   · every link and related page in a seeded answer is a real, written page —
 *     an answer pointing at nothing is the dead link the manual exists to avoid
 * A section added later with no row is confidential on both sides, which
 * `docsAccess.test.ts` asserts; it is not a failure here.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DOC_GROUPS, getPage } from "../registry";

const ROOT = join(__dirname, "..", "..", "..", "..");
const MIGRATION = readFileSync(
  join(ROOT, "supabase", "migrations", "20260930000012_docs_release_and_questions.sql"),
  "utf8",
);

function seededKeys(): string[] {
  const start = MIGRATION.indexOf("INSERT INTO public.docs_section_releases");
  const block = MIGRATION.slice(start, MIGRATION.indexOf("ON CONFLICT", start));
  return [...block.matchAll(/'([a-z][a-z0-9-]*)'/g)].map((m) => m[1]).filter((k) => k !== "confidential");
}

function seededAnswers(): { answer: string; section: string | null; related: string[] }[] {
  const start = MIGRATION.indexOf("INSERT INTO public.docs_faq");
  const block = MIGRATION.slice(start, MIGRATION.indexOf("ON CONFLICT (question)", start));
  const rows = block.split(/\n\(\n/).slice(1);
  return rows.map((row) => {
    const related = /ARRAY\[([^\]]*)\]/.exec(row)?.[1] ?? "";
    const section = /,\s*\n\s*(NULL|'([a-z-]+)'),\s*ARRAY\[/.exec(row);
    return {
      answer: row,
      section: section?.[2] ?? null,
      related: [...related.matchAll(/'([a-z0-9-]+)'/g)].map((m) => m[1]),
    };
  });
}

describe("section keys", () => {
  it("are unique and slug-shaped", () => {
    const keys = DOC_GROUPS.map((g) => g.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const k of keys) expect(k).toMatch(/^[a-z][a-z0-9-]*$/);
  });

  it("are exactly the keys the migration seeds, and every one seeds confidential", () => {
    expect(seededKeys().sort()).toEqual(DOC_GROUPS.map((g) => g.key).sort());
    expect(MIGRATION).toMatch(/SELECT k, 'confidential'\s+FROM unnest\(ARRAY\[/);
  });
});

describe("the prepared answers", () => {
  const answers = seededAnswers();

  it("were seeded", () => {
    expect(answers.length).toBeGreaterThanOrEqual(10);
  });

  it("link only to written pages", () => {
    for (const a of answers) {
      for (const m of a.answer.matchAll(/\]\(\/docs\/([a-z0-9-]+)\)/g)) {
        expect(getPage(m[1])?.status, `an answer links to /docs/${m[1]}`).toBe("live");
      }
      for (const slug of a.related) {
        expect(getPage(slug)?.status, `an answer names related page "${slug}"`).toBe("live");
      }
    }
  });

  it("name only sections the registry has", () => {
    const keys = new Set(DOC_GROUPS.map((g) => g.key));
    for (const a of answers) if (a.section) expect(keys.has(a.section), a.section).toBe(true);
  });
});
