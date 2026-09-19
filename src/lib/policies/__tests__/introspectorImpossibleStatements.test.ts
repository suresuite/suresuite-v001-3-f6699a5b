/**
 * The third and fourth abort detectors, exercised — §4 D99.
 *
 * ── WHY THIS FILE EXISTS ───────────────────────────────────────────────────
 *
 * `schema.impossible` was built as a LIST so a second detector could join it, and
 * two have: slice 9's `CREATE INDEX` on a column its table has never had (42703)
 * and slice 10's `firstNonDefaultAfterDefault` (42P13). §4 D99 then names the
 * class as OPEN and lists three statement kinds still unwatched:
 *
 *   · `ADD CONSTRAINT … FOREIGN KEY` to a missing column
 *   · an `ALTER COLUMN TYPE` that cannot cast
 *   · a `CREATE POLICY` naming an absent column
 *
 * WP 6.2 adds the first and the third. **Neither fires on this repository's
 * history**, which is the right outcome — and it also means neither had ever been
 * exercised. A gate whose list is empty proves nothing about the gate. So these
 * point the introspector at a fixture directory whose migrations PostgreSQL would
 * reject, and assert that each is caught with the reason a reader can act on.
 *
 * ── WHY THE SECOND KIND IS NOT HERE ────────────────────────────────────────
 *
 * `ALTER COLUMN TYPE` deliberately has no detector. Whether a cast succeeds
 * depends on the DATA — `text` → `integer` is fine on a column holding "3" and
 * raises 22P02 on one holding "three" — so a static pass can only guess, and
 * `contract:rehearse` executes the statement against a real PostgreSQL, which is
 * the gate that can actually answer. Recorded here so the next reader knows it was
 * decided rather than forgotten, which is what D99's "the class is not closed"
 * needs to keep meaning something.
 */
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(__dirname, "..", "..", "..", "..");

/** A minimal table every fixture below builds on. */
const BASE = `
CREATE TABLE public.widgets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL,
  label text
);
`;

type Aborted = { migration: string; why: string; tables_it_claimed?: string[] };

/**
 * `schema.impossible` is not a published key — it is FOLDED into
 * `aborted_migrations`, with the detector's `why` carried onto the file.
 *
 * That is the right shape: what a downstream reader needs is "this file did not
 * run", and the reason is the detector's contribution. So these assertions read the
 * published artifact rather than an internal list, which also means they break if
 * the fold is ever removed — and the fold IS the behaviour (`build()` replays
 * without an aborted file).
 */
function introspect(files: Record<string, string>): { impossible: Aborted[]; aborted: string[] } {
  const dir = mkdtempSync(join(tmpdir(), "introspect-fixture-"));
  const out = join(dir, "artifact.json");
  try {
    for (const [name, sql] of Object.entries(files)) writeFileSync(join(dir, name), sql);
    execFileSync(process.execPath, [join(ROOT, "scripts", "data-contract", "introspect.mjs")], {
      cwd: ROOT,
      env: { ...process.env, CONTRACT_MIGRATIONS_DIR: dir, CONTRACT_INTROSPECT_OUT: out },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    const artifact = JSON.parse(readFileSync(out, "utf8"));
    const abortedRows: Aborted[] = artifact.aborted_migrations ?? [];
    return {
      // Only the files a DETECTOR rejected. The corroboration test also fills this
      // list, and its reason is a different sentence, so keeping the two apart is
      // what stops these assertions passing on the wrong mechanism.
      impossible: abortedRows.filter((a) => /42703|42P13/.test(a.why)),
      aborted: abortedRows.map((a) => a.migration),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("§4 D99 · the detectors are exercised, not merely present", () => {
  it("the harness works: a clean fixture yields no rejected statement", () => {
    // Without this, every assertion below could pass because the harness silently
    // produced an empty list — §4 D57's failure exactly (a gate reporting clean
    // because it contains nothing).
    const { impossible, aborted } = introspect({ "20260101000000_base.sql": BASE });
    expect(impossible).toEqual([]);
    expect(aborted).toEqual([]);
  });

  describe("detector 3 · ADD CONSTRAINT on a column the table does not have", () => {
    const fixture = {
      "20260101000000_base.sql": BASE,
      "20260102000000_bad_fk.sql": `
        ALTER TABLE public.widgets
          ADD CONSTRAINT widgets_owner_fk FOREIGN KEY (owner_id)
          REFERENCES public.widgets(id);
        ALTER TABLE public.widgets ADD COLUMN note text;
      `,
    };

    it("is caught, and named", () => {
      const { impossible } = introspect(fixture);
      expect(impossible).toHaveLength(1);
      expect(impossible[0].migration).toBe("20260102000000_bad_fk.sql");
      // `tables_it_claimed` is what the FILE CREATES, and this one creates
      // nothing — so the table has to come out of the reason, which is where a
      // reader needs it anyway.
      expect(impossible[0].tables_it_claimed ?? []).toEqual([]);
      expect(impossible[0].why).toMatch(/widgets/);
      expect(impossible[0].why).toMatch(/owner_id/);
      expect(impossible[0].why).toMatch(/42703/);
    });

    it("the WHOLE FILE is treated as aborted, which is the point", () => {
      // The statement after it — `ADD COLUMN note` — is perfectly valid and NEVER
      // RAN, because a Supabase migration is one transaction. An artifact that
      // recorded `note` would describe a column production does not have, which is
      // the defect D48 and D97 are.
      const { aborted } = introspect(fixture);
      expect(aborted).toContain("20260102000000_bad_fk.sql");
    });

    it("a valid constraint on a real column is NOT caught", () => {
      // The mutation case. A detector that flagged every ADD CONSTRAINT would be
      // worse than none: it would abort files that ran.
      const { impossible, aborted } = introspect({
        "20260101000000_base.sql": BASE,
        "20260102000000_good.sql": `
          ALTER TABLE public.widgets
            ADD CONSTRAINT widgets_project_fk FOREIGN KEY (project_id)
            REFERENCES public.widgets(id);
        `,
      });
      expect(impossible).toEqual([]);
      expect(aborted).toEqual([]);
    });

    it("a CHECK's expression is left alone — it needs a parser, not a guess", () => {
      // `ownCols` is empty for a CHECK on purpose. A CHECK naming a missing column
      // DOES abort, and finding that needs an expression parser; reporting one from
      // a regex would flag every CHECK that calls a function.
      const { impossible } = introspect({
        "20260101000000_base.sql": BASE,
        "20260102000000_check.sql": `
          ALTER TABLE public.widgets
            ADD CONSTRAINT widgets_label_ck CHECK (char_length(label) > 0);
        `,
      });
      expect(impossible).toEqual([]);
    });
  });

  describe("detector 4 · CREATE POLICY qualifying a column the table does not have", () => {
    it("is caught when the reference names THIS table", () => {
      const { impossible, aborted } = introspect({
        "20260101000000_base.sql": BASE,
        "20260102000000_bad_policy.sql": `
          ALTER TABLE public.widgets ENABLE ROW LEVEL SECURITY;
          CREATE POLICY "widgets: owner" ON public.widgets
            FOR SELECT USING (public.widgets.owner_id = '00000000-0000-0000-0000-000000000000');
        `,
      });
      expect(impossible).toHaveLength(1);
      expect(impossible[0].why).toMatch(/widgets\.owner_id/);
      expect(impossible[0].why).toMatch(/42703/);
      expect(aborted).toContain("20260102000000_bad_policy.sql");
    });

    it("a policy on a real column of this table is NOT caught", () => {
      const { impossible } = introspect({
        "20260101000000_base.sql": BASE,
        "20260102000000_good_policy.sql": `
          ALTER TABLE public.widgets ENABLE ROW LEVEL SECURITY;
          CREATE POLICY "widgets: project" ON public.widgets
            FOR SELECT USING (public.widgets.project_id IS NOT NULL);
        `,
      });
      expect(impossible).toEqual([]);
    });

    it("a BARE identifier is not examined, and that is deliberate", () => {
      // Inside a predicate, a bare name may be a column of this table, a column of
      // a table in a sub-SELECT, a function, an enum label or a parameter. The
      // detector looks only at references qualified with THIS table's name, where
      // the qualifier makes the answer certain. `not_a_column` below WOULD abort in
      // PostgreSQL and is not reported here — a known limit, stated rather than
      // pretended away, because the alternative is a detector that fires on every
      // policy calling `get_current_user_id()`.
      const { impossible } = introspect({
        "20260101000000_base.sql": BASE,
        "20260102000000_bare.sql": `
          ALTER TABLE public.widgets ENABLE ROW LEVEL SECURITY;
          CREATE POLICY "widgets: bare" ON public.widgets
            FOR SELECT USING (not_a_column IS NOT NULL);
        `,
      });
      expect(impossible).toEqual([]);
    });

    it("a reference to ANOTHER table inside a sub-SELECT is not examined", () => {
      // `others.missing_col` is qualified, but not with this table's name, so it is
      // out of scope — this pass cannot know what columns `others` has at this
      // point without resolving the sub-query.
      const { impossible } = introspect({
        "20260101000000_base.sql": BASE,
        "20260102000000_other.sql": `
          CREATE TABLE public.others (id uuid PRIMARY KEY, widget_id uuid);
          ALTER TABLE public.widgets ENABLE ROW LEVEL SECURITY;
          CREATE POLICY "widgets: via others" ON public.widgets
            FOR SELECT USING (EXISTS (
              SELECT 1 FROM public.others o WHERE o.widget_id = public.widgets.id));
        `,
      });
      expect(impossible).toEqual([]);
    });
  });
});
