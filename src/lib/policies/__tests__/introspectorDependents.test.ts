/**
 * WP 6.2 · §4 D49 + D59 — THE INTROSPECTOR IS COMPLETE ABOUT DEPENDENT OBJECTS.
 *
 * Four defects, one sentence: the artifact records an object by NAME while
 * PostgreSQL tracks it by OID, so anything that follows a column or a table
 * automatically in the database has to be followed by hand here.
 *
 *   D52  a TABLE rename, not followed into foreign keys        (closed WP 3.1/6.2)
 *   D53  a `REFERENCES` schema qualifier, dropped              (closed WP 6.2 slice 8)
 *   D49  a COLUMN rename, not followed into indexes            (this file)
 *   D59  an inline column CHECK, never recorded at all         (this file)
 *
 * ── WHY IT IS STATIC ──────────────────────────────────────────────────────
 *
 * The fix is to the INTROSPECTOR, and `contract:rehearse` builds its base from
 * the BASE BRANCH's artifact — so in plain and `--fixtures` mode the artifact
 * under test is the one from BEFORE the fix, and a SQL assertion has to skip.
 * A skip cannot tell "the base predates the fix" from "the fix broke", which is
 * what slice 8 learned the expensive way. This file reads the MIGRATIONS and
 * the ARTIFACT, needs no database, and therefore has no base to be stale.
 *
 * ── AND D49's RECORDED CAUSE WAS RIGHT FOR ONE INDEX OF THREE ─────────────
 *
 * §4 D49 named three indexes and one cause. `supply_chain_data.plant` → `plant_name`
 * is that cause exactly. The other two name columns `supply_chain_data_multi_tier`
 * has NEVER had in any definition — they belong to `bom_multi_level` — so no
 * rename could have produced them. `CREATE INDEX IF NOT EXISTS` guards the index
 * NAME, not the column: PostgreSQL raises 42703 and the file's transaction rolls
 * back. `20250909153130` therefore aborted in production, and `20250909153231`
 * is its retry with those two lines removed. That is D48's class, and §3 below
 * is the gate for it.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { splitStatements, splitTopLevel, parenBody, readQualifiedName, squash } from "../../../../scripts/data-contract/sql-lex.mjs";

const ROOT = join(__dirname, "..", "..", "..", "..");
const MIGRATIONS = join(ROOT, "supabase", "migrations");

type Constraint = { name: string | null; kind: string; columns?: string[]; definition: string };
type Index = { name: string; columns: string[]; predicate: string | null; added_by: string };
type Table = { name: string; columns: { name: string }[]; constraints?: Constraint[]; indexes?: Index[] };

const artifact = JSON.parse(
  readFileSync(join(ROOT, "build", "schema.introspected.json"), "utf8"),
) as { tables: Table[]; aborted_migrations: { migration: string; why: string }[] };

const files = readdirSync(MIGRATIONS)
  .filter((n) => n.endsWith(".sql"))
  .sort()
  .map((n) => [n, readFileSync(join(MIGRATIONS, n), "utf8")] as const);

const aborted = new Set(artifact.aborted_migrations.map((a) => a.migration));

/** A bare, unquoted column reference — not an expression, not `col DESC`. */
const bareColumn = (expr: string) => /^"?([A-Za-z_][A-Za-z0-9_]*)"?$/.exec(expr.trim())?.[1] ?? null;

describe("WP 6.2 · D49 · a column rename follows the column into its dependents", () => {
  it("there are indexes to check — an empty artifact makes this vacuous", () => {
    expect(artifact.tables.flatMap((t) => t.indexes ?? []).length).toBeGreaterThan(50);
  });

  it("no index names a column its table does not have", () => {
    // The defect in its general form. `rehearsal-schema.mjs` SKIPS such an index
    // with a warning, so the rehearsed database is missing it and nothing fails
    // — the warning is the only signal, and a warning nothing reads is not a gate.
    const stale: string[] = [];
    for (const t of artifact.tables) {
      const cols = new Set(t.columns.map((c) => c.name));
      for (const idx of t.indexes ?? []) {
        for (const expr of idx.columns ?? []) {
          const c = bareColumn(expr);
          if (c && !cols.has(c)) stale.push(`${t.name}.${idx.name} names ${c} (added_by ${idx.added_by})`);
        }
      }
    }
    expect(stale, "§4 D49 — the rehearsal skips each of these, so the database it builds does not have them").toEqual([]);
  });

  it("no constraint names a column its table does not have", () => {
    // The same rule on the other dependent kind. A CHECK is emitted VERBATIM by
    // `rehearsal-schema.mjs`, so a stale column name there does not warn — it
    // fails the base build outright.
    const stale: string[] = [];
    for (const t of artifact.tables) {
      const cols = new Set(t.columns.map((c) => c.name));
      for (const c of t.constraints ?? []) {
        for (const col of c.columns ?? []) if (!cols.has(col)) stale.push(`${t.name}.${c.name ?? c.kind} names ${col}`);
      }
    }
    expect(stale).toEqual([]);
  });

  it("the one index a rename really did move is recorded on the NEW name", () => {
    // Named rather than counted: the general assertion above also passes if the
    // index is dropped altogether, and production has it.
    const t = artifact.tables.find((x) => x.name === "supply_chain_data")!;
    const idx = (t.indexes ?? []).find((i) => i.name === "idx_supply_chain_data_plant");
    expect(idx, "20250822025432 renamed `plant` to `plant_name`; the index came with it").toBeDefined();
    expect(idx!.columns).toEqual(["plant_name"]);
  });
});

/** Every inline `CHECK (...)` a live CREATE TABLE or ADD COLUMN writes. */
function inlineChecksInMigrations() {
  const out: { migration: string; table: string; text: string }[] = [];
  const TABLE_CONSTRAINT = /^(CONSTRAINT\b|PRIMARY\s+KEY\b|UNIQUE\b|FOREIGN\s+KEY\b|CHECK\b|EXCLUDE\b)/i;
  for (const [file, sql] of files) {
    if (aborted.has(file)) continue;          // its transaction rolled back
    for (const stmt of splitStatements(sql)) {
      const s = squash(stmt);
      const m = /^CREATE\s+TABLE\s+(IF\s+NOT\s+EXISTS\s+)?/i.exec(s);
      if (!m) continue;
      const id = readQualifiedName(s, m[0].length);
      if (!id || (id.schema && id.schema !== "public")) continue;
      const body = parenBody(s, id.end);
      if (!body) continue;
      for (const def of splitTopLevel(body.body)) {
        if (TABLE_CONSTRAINT.test(def)) continue;
        const at = /\bCHECK\s*\(/i.exec(def);
        if (!at) continue;
        const b = parenBody(def, at.index);
        if (b) out.push({ migration: file, table: id.name, text: squash(b.body) });
      }
    }
  }
  return out;
}

describe("WP 6.2 · D59 · an inline column CHECK is a constraint the artifact records", () => {
  const inMigrations = inlineChecksInMigrations();

  it("the migrations do write inline CHECKs — otherwise this is vacuous", () => {
    expect(inMigrations.length).toBeGreaterThan(40);
  });

  it("every one of them reaches the artifact", () => {
    // `20260916000014` writes every NEW check table-level to walk around this.
    // That is a convention, not a gate, and it does nothing for the ones already
    // written — so the rule is asserted over the whole history, not the tail.
    const recorded = new Set(
      artifact.tables.flatMap((t) =>
        (t.constraints ?? [])
          .filter((c) => c.kind === "CHECK")
          .map((c) => `${t.name}::${squash(c.definition).replace(/^CHECK\s*\(/i, "").replace(/\)$/, "")}`),
      ),
    );
    // EXCEPT the ones a later migration REPLACED, and the name is how it did it.
    // PostgreSQL calls an unnamed column CHECK `<table>_<column>_check`, and
    // that is not trivia: `ai_chat_events.event_kind` is widened five times by
    // `DROP CONSTRAINT IF EXISTS ai_chat_events_event_kind_check` + `ADD
    // CONSTRAINT` of the same name, and `proposals.agent_id` and
    // `.artifact_type` four more times each. A CHECK recorded with NO name
    // matches no DROP — so the first draft of this fix kept the ORIGINAL,
    // NARROWEST vocabulary alongside the final one, and the base build failed
    // on the duplicate name. That failure is the lucky outcome; the unlucky one
    // is a rehearsed database that refuses values production accepts.
    const dropped = new Set<string>();
    for (const [, sql] of files) {
      for (const m of sql.matchAll(/DROP\s+CONSTRAINT\s+(?:IF\s+EXISTS\s+)?"?([a-z_][a-z0-9_]*)"?/gi)) {
        dropped.add(m[1].toLowerCase());
      }
    }
    const autoName = (table: string, text: string) => {
      const col = /^\s*([a-z_][a-z0-9_]*)/i.exec(text)?.[1]?.toLowerCase();
      return col ? `${table}_${col}_check` : "";
    };
    const missing = inMigrations
      .filter((c) => artifact.tables.some((t) => t.name === c.table))     // the table still exists
      .filter((c) => !recorded.has(`${c.table}::${c.text}`))
      .filter((c) => !dropped.has(autoName(c.table, c.text)))
      .map((c) => `${c.table} · CHECK (${c.text.slice(0, 70)}) · ${c.migration}`);
    expect(
      [...new Set(missing)],
      "§4 D59 — the rehearsed database will not refuse what production refuses, " +
        "and the generated page will not publish a rule that rejects a user's upload (§5 T1).",
    ).toEqual([]);
  });

  it("a superseded inline CHECK is REPLACED, not kept alongside its replacement", () => {
    // The consequence of the naming, stated where a reader will look for it.
    // `ai_chat_events.event_kind` must hold ONE check, and it must be the last
    // vocabulary the migrations wrote — not the first.
    const t = artifact.tables.find((x) => x.name === "ai_chat_events")!;
    const checks = (t.constraints ?? []).filter((c) => c.kind === "CHECK");
    expect(checks.map((c) => c.name)).toEqual(["ai_chat_events_event_kind_check"]);
    expect(checks[0].definition, "the FIRST vocabulary survived, so the DROP matched nothing").toContain("plan.step");
  });

  it("`ingest_files` carries the three §4 D59 names by hand", () => {
    const t = artifact.tables.find((x) => x.name === "ingest_files")!;
    const checks = (t.constraints ?? []).filter((c) => c.kind === "CHECK").map((c) => squash(c.definition));
    expect(checks).toEqual([
      "CHECK (source_kind IN ('csv', 'orbit-mrp', 'api'))",
      "CHECK (byte_size >= 0)",
      "CHECK (content_sha256 ~ '^[0-9a-f]{64}$')",
    ]);
  });

  it("`rehearsal-schema.mjs` emits a CHECK, or recording one achieves nothing", () => {
    // The consumer half, asserted against the source because running it needs a
    // database and this gate must not. `emitConstraints` passes every
    // constraint's `definition` through, keys first — a CHECK is in the second
    // pass — so the only way to lose them again is to filter by kind.
    const src = readFileSync(join(ROOT, "scripts", "data-contract", "rehearsal-schema.mjs"), "utf8");
    const emit = src.slice(src.indexOf("function emitConstraints"), src.indexOf("function emitIndexes"));
    expect(/\(t\.constraints \|\| \[\]\)\.filter\(pass\)/.test(emit)).toBe(true);
    expect(/kind === "CHECK"/.test(emit), "emitConstraints has grown a CHECK-specific branch — re-read it").toBe(false);
  });
});

describe("WP 6.2 · D49's other two indexes · a rejected statement aborts its file", () => {
  it("a CREATE INDEX in a NON-aborted migration names a column the table has EVER had", () => {
    // The general rule, and the one that makes the two-defects reading
    // load-bearing rather than a note. If a file survives the abort detector, it
    // ran; if it ran, every index in it was creatable.
    //
    // JUDGED AGAINST EVERY NAME THE TABLE HAS EVER CARRIED, not against the
    // final schema — and the first draft of this test made exactly the mistake
    // the introspector had just been fixed for. `20250816052311` indexes
    // `supply_chain_data(plant)`, which was right until `20250822025432`
    // renamed it. A column that appears in NO definition of the table in the
    // whole history is the honest statement of "PostgreSQL could not have
    // created this, at any point", and it needs no replay to establish.
    const everHad = new Map<string, Set<string>>();
    const remember = (table: string, col: string) => {
      if (!everHad.has(table)) everHad.set(table, new Set());
      everHad.get(table)!.add(col);
    };
    const TABLE_CONSTRAINT = /^(CONSTRAINT\b|PRIMARY\s+KEY\b|UNIQUE\b|FOREIGN\s+KEY\b|CHECK\b|EXCLUDE\b)/i;
    for (const [, sql] of files) {
      for (const stmt of splitStatements(sql)) {
        const s = squash(stmt);
        let m = /^CREATE\s+TABLE\s+(IF\s+NOT\s+EXISTS\s+)?/i.exec(s);
        if (m) {
          const id = readQualifiedName(s, m[0].length);
          const body = id && parenBody(s, id.end);
          if (!id || !body) continue;
          for (const def of splitTopLevel(body.body)) {
            if (TABLE_CONSTRAINT.test(def)) continue;
            const c = readQualifiedName(def, 0);
            if (c) remember(id.name, c.name);
          }
          continue;
        }
        m = /^ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?/i.exec(s);
        if (!m) continue;
        const id = readQualifiedName(s, m[0].length);
        if (!id) continue;
        for (const action of splitTopLevel(s.slice(id.end).trim())) {
          const a = squash(action);
          const add = /^ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?/i.exec(a);
          if (add) { const c = readQualifiedName(a, add[0].length); if (c) remember(id.name, c.name); continue; }
          const renTable = /^RENAME\s+TO\s+/i.exec(a);
          if (renTable) {
            // A TABLE rename carries every column with it, and the third draft
            // of this test did not follow it — so it accused
            // `20260916000012`'s `ingest_runs(link_id)`, a column
            // `erp_sync_runs` had carried since `20260829120000`. D52 again,
            // in the gate for D49.
            const to = readQualifiedName(a, renTable[0].length);
            if (to) for (const c of everHad.get(id.name) ?? []) remember(to.name, c);
            continue;
          }
          const ren = /^RENAME\s+COLUMN\s+/i.exec(a);
          if (ren) {
            const from = readQualifiedName(a, ren[0].length);
            const toAt = from && /\bTO\s+/i.exec(a.slice(from.end));
            const to = toAt && readQualifiedName(a, from!.end + toAt.index + toAt[0].length);
            if (from) remember(id.name, from.name);
            if (to) remember(id.name, to.name);
          }
        }
      }
    }

    const bad: string[] = [];
    for (const [file, sql] of files) {
      if (aborted.has(file)) continue;
      for (const stmt of splitStatements(sql)) {
        const s = squash(stmt);
        const m = /^CREATE\s+(UNIQUE\s+)?INDEX\s+(CONCURRENTLY\s+)?(IF\s+NOT\s+EXISTS\s+)?/i.exec(s);
        if (!m) continue;
        const onAt = /\bON\b/i.exec(s.slice(m[0].length));
        if (!onAt) continue;
        const tid = readQualifiedName(s, m[0].length + onAt.index + onAt[0].length);
        if (!tid || !everHad.has(tid.name)) continue;   // a foreign schema, or a table no migration defines
        const cols = parenBody(s, tid.end);
        if (!cols) continue;
        const have = everHad.get(tid.name)!;
        for (const expr of splitTopLevel(cols.body)) {
          const c = bareColumn(squash(expr));
          if (c && !have.has(c)) bad.push(`${file}: ${tid.name}(${c})`);
        }
      }
    }
    expect(
      bad,
      "PostgreSQL raises 42703 on each of these, so the file's transaction rolled " +
        "back and NOTHING in it ran — yet the artifact records its statements as applied.",
    ).toEqual([]);
  });

  it("the two files that do carry one are recorded as aborted, with the reason", () => {
    // Named, because the assertion above is also satisfied by deleting the
    // detector and the two files together.
    for (const file of [
      "20250909153130_bbce47b2-3ba2-4830-b460-ad2b043905c5.sql",
      "20250914113723_c82f2d6b-60a9-4190-81ae-bc9a8c227c91.sql",
    ]) {
      const row = artifact.aborted_migrations.find((a) => a.migration === file);
      expect(row, `${file} creates an index on a column its table does not have`).toBeDefined();
      expect(row!.why).toMatch(/42703/);
    }
  });

  it("WP 3.3's seven unique indexes are NOT accused — the order between the two abort kinds", () => {
    // The first draft of the detector read the rejected-statement evidence from
    // a replay in which the corroboration evidence had not yet been applied, and
    // accused `20260916000018` — the whole of `natural-key` (I4). Its index
    // reads `inbound_logistics(plant_name, …)`, and before `20250820145017` is
    // excluded that table still carries the aborted file's `plant_id`. The index
    // was right; the schema it was judged against never existed.
    expect(aborted.has("20260916000018_natural_key_unique.sql")).toBe(false);
    const t = artifact.tables.find((x) => x.name === "inbound_logistics")!;
    expect(t.columns.map((c) => c.name)).toContain("plant_name");
  });
});
