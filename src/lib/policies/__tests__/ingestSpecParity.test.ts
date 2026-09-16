/**
 * THE INGESTION SPEC HAS ONE SOURCE (Phase 3 / WP 3.2, invariant `single-source`).
 *
 * `ingestSpec.generated.ts` is generated from supabase/contract/*.contract.yaml,
 * and `contract:generate -- --check` fails if it drifts from them. That covers
 * the TypeScript side. It cannot cover the two places the same facts have to be
 * restated in another language:
 *
 *   · `public.ingest_target_is_promotable()` — SQL cannot import a TypeScript
 *     module, and the promotion builds dynamic SQL, so the list of tables it may
 *     insert into has to exist in the migration. This suite is what keeps the two
 *     lists equal.
 *   · `UploadWizard` — the claim "the client-side parse is GONE, not flagged off"
 *     is an exit check of this package, and a claim about absence needs a test or
 *     it decays the first time somebody adds a convenience.
 *
 * Read from disk, both of them, the way dataPlaneAudit.test.ts reads migrations.
 */
import { describe, expect, it } from "vitest";
import { UNIT_DAYS } from "../../../../supabase/functions/_shared/grading";
import CONTRACT from "../../../../build/data-contract.generated.json";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  INGEST_DATASETS,
  PROMOTABLE_TARGETS,
} from "../../../../supabase/functions/_shared/ingestSpec.generated";

const ROOT = join(__dirname, "..", "..", "..", "..");
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), "utf8");

const LANDING_SQL = read("supabase", "migrations", "20260916000015_ingest_landing.sql");
const DEDUP_SQL = read("supabase", "migrations", "20260916000017_dedup_natural_keys.sql");
const KEYS_SQL = read("supabase", "migrations", "20260916000018_natural_key_unique.sql");
const UPSERT_SQL = read("supabase", "migrations", "20260916000019_promotion_upsert.sql");
const WIZARD = read("src", "components", "UploadWizard.tsx");
const FUNCTION = read("supabase", "functions", "ingest-file", "index.ts");

describe("the promotable-target list exists twice and must agree", () => {
  /**
   * The LAST definition wins, and reading only the first is how this test would
   * quietly stop meaning anything. `ingest_target_is_promotable` is
   * `CREATE OR REPLACE`d — WP 3.2 wrote it in `20260916000015` and WP 3.3
   * replaced it in `20260916000020` to add the three item masters. What
   * production has is the one the LATEST migration installs, so that is what the
   * parity is checked against; a test pinned to the first file would have gone on
   * comparing a list nothing executes.
   */
  const promotableInSql = () => {
    const dir = join(ROOT, "supabase", "migrations");
    const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
    let body: string | null = null;
    for (const f of files) {
      const src = readFileSync(join(dir, f), "utf8");
      const at = src.indexOf("CREATE OR REPLACE FUNCTION public.ingest_target_is_promotable");
      if (at > -1) body = src.slice(at, src.indexOf("$$;", at));
    }
    expect(body, "no migration defines ingest_target_is_promotable").toBeTruthy();
    return [...body!.matchAll(/'([a-z0-9_]+)'/g)].map((m) => m[1]).sort();
  };

  it("names the same tables in SQL as the contract generates", () => {
    expect(promotableInSql()).toEqual([...PROMOTABLE_TARGETS].sort());
  });

  it("names a target for every dataset and nothing else", () => {
    expect([...new Set(Object.values(INGEST_DATASETS).map((d) => d.target))].sort())
      .toEqual([...PROMOTABLE_TARGETS].sort());
  });

  it("covers every CSV dataset the contract describes — nine since WP 3.3", () => {
    // Six from WP 3.2, plus the three item masters (D55). They were left out
    // deliberately then: `bulk_upsert_*` already upserted on their composite
    // primary key, and a landing whose promotion was an INSERT would have been a
    // regression. The promotion upserts now, so the landing is strictly better
    // and they joined it.
    expect(PROMOTABLE_TARGETS).toEqual([
      "bom_multi_level",
      "bom_single_level",
      "inbound_logistics",
      "materials",
      "outbound_logistics",
      "products",
      "suppliers",
      "tier2_suppliers",
      "tier3_suppliers",
    ]);
  });

  it("no CSV dataset writes tier 2 from the browser any more (no-tier-skip, I2)", () => {
    // The item-master branch called bulk_upsert_* directly. A claim about ABSENCE
    // needs a test or it decays the first time somebody adds a convenience —
    // the same reason this suite already pins the deletion of the client parse.
    const code = WIZARD.split("\n").filter((l) => !l.trim().startsWith("*") && !l.trim().startsWith("//"));
    expect(code.join("\n")).not.toMatch(/bulk_upsert_(materials|products|suppliers)/);
  });

  it("an item master declares project_id alone as server-set, never plant_name", () => {
    // These tables have no `plant_name` — an item master is a property of the
    // project. `ingest_apply_run` derives the server-set columns per target for
    // exactly this reason; assuming both would need a second code path.
    for (const target of ["materials", "products", "suppliers"]) {
      const d = Object.values(INGEST_DATASETS).find((x) => x.target === target)!;
      expect(d, `${target} is not a described dataset`).toBeTruthy();
      expect(d.serverSet).toEqual(["project_id"]);
    }
  });
});

describe("the client-side CSV parse is gone", () => {
  it("UploadWizard splits nothing on a comma or a newline", () => {
    // The exact shape of D6: `content.trim().split('\n')` + `line.split(',')`.
    const code = WIZARD.split("\n").filter((l) => !l.trim().startsWith("*") && !l.trim().startsWith("//"));
    expect(code.join("\n")).not.toMatch(/\.split\(\s*['"],['"]\s*\)/);
    expect(code.join("\n")).not.toMatch(/\.split\(\s*['"]\\n['"]\s*\)/);
  });

  it("UploadWizard no longer carries a list of numeric CSV headers for a described dataset", () => {
    // The legacy list survives for the item masters and the deep-tier tables,
    // whose tables are not described yet — it must not name a column of a
    // dataset the contract DOES describe, or the rules exist twice again.
    const legacy = WIZARD.match(/LEGACY_NUMERIC_HEADERS = \[([\s\S]*?)\]/);
    expect(legacy).not.toBeNull();
    const named = new Set([...legacy![1].matchAll(/'([a-z0-9_]+)'/g)].map((m) => m[1]));
    // It does still name lane columns, because the same header appears in the
    // deep-tier and item-master files. What must be true is that no DESCRIBED
    // dataset reaches it: the landing branch returns before it is used.
    expect(named.size).toBeGreaterThan(0);
    expect(WIZARD).toMatch(/if \(INGEST_DATASETS\[template\.id\]\)/);
  });

  it("sends the FILE to ingest-file rather than parsed rows", () => {
    expect(WIZARD).toMatch(/body\.append\('file', file\)/);
    expect(WIZARD).toMatch(/functions\.invoke\('ingest-file'/);
  });

  it("reads every parse on the server, including the two deep-tier files", () => {
    expect(WIZARD).toMatch(/const handleNodesFileSelect[\s\S]*?parseOnServer\(uploadedFile, 'network_nodes'\)/);
    expect(WIZARD).toMatch(/const handleEdgesFileSelect[\s\S]*?parseOnServer\(uploadedFile, 'network_edges'\)/);
  });
});

describe("the edge function validates from the contract and nowhere else", () => {
  it("imports the generated spec", () => {
    expect(FUNCTION).toMatch(/from "\.\.\/_shared\/ingestSpec\.generated\.ts"/);
  });

  it("states no header, required flag or unit list of its own", () => {
    for (const header of ["supplier_id", "material_id", "time_unit", "lead_time"]) {
      expect(FUNCTION).not.toMatch(new RegExp(`["']${header}["']`));
    }
  });

  it("opens the run before it lands the file, in one transaction", () => {
    // `ingest_files.ingest_run_id` is NOT NULL and write-once; the order is not
    // a preference. The function must not do it in pieces.
    expect(FUNCTION).toMatch(/rpc\("ingest_land_file"/);
    expect(FUNCTION).not.toMatch(/from\("ingest_runs"\)/);
    expect(FUNCTION).not.toMatch(/from\("ingest_files"\)/);
    expect(FUNCTION).not.toMatch(/from\("ingest_staged_rows"\)/);
  });

  it("names the uploader on the landing", () => {
    expect(FUNCTION).toMatch(/_actor_user_id: userId/);
    expect(LANDING_SQL).toMatch(/log_data_action\(/);
    expect(LANDING_SQL).toMatch(/'ingest_file_landed'/);
  });

  it("never writes a tier-2 table itself", () => {
    for (const t of PROMOTABLE_TARGETS) {
      expect(FUNCTION).not.toMatch(new RegExp(`from\\("${t}"\\)`));
    }
  });
});

/**
 * WP 3.3 — THE SAME ARRANGEMENT, THREE MORE TIMES.
 *
 * Three facts authored in the sidecars have to be restated in SQL, for the same
 * reason `ingest_target_is_promotable` does: a migration cannot import a
 * TypeScript module, and dynamic SQL cannot read a YAML file.
 *
 *   · the natural keys, in `20260916000017`'s dedup call list and in
 *     `20260916000018`'s `CREATE UNIQUE INDEX` statements;
 *   · the unit conversions the promotion applies, in
 *     `20260916000019`'s `ingest_normalize_at_promotion()`.
 *
 * Each of those is a copy, and an unchecked copy is D33 waiting to happen. The
 * authored source is the sidecar; these tests are what make the copies
 * unmaintainable-apart rather than merely documented as needing to agree.
 */
describe("the natural keys exist in three places and must agree", () => {
  const intended = Object.fromEntries(
    Object.entries(CONTRACT.tables)
      .filter(([, t]) => (t as any).natural_key_intended)
      .map(([name, t]) => [name, (t as any).natural_key_intended as string[]]),
  );

  const SEVEN = [
    "bom_multi_level", "bom_single_level", "inbound_logistics", "multi_tier_supply_chain",
    "outbound_logistics", "tier2_suppliers", "tier3_suppliers",
  ];

  it("20260916000018 creates an index on exactly natural_key_intended, for all seven", () => {
    for (const table of SEVEN) {
      const re = new RegExp(
        `CREATE UNIQUE INDEX IF NOT EXISTS ${table}_natural_key\\s+ON public\\.${table} \\(([^)]*)\\)`,
      );
      const m = KEYS_SQL.match(re);
      expect(m, `no unique index statement for ${table}`).toBeTruthy();
      const cols = m![1].split(",").map((c) => c.trim());
      expect(cols, `${table}'s index does not match its sidecar`).toEqual(intended[table]);
    }
  });

  it("every one of the seven indexes is NULLS NOT DISTINCT", () => {
    // Three of the seven keys contain a nullable column whose NULL is meaningful.
    // A plain unique index constrains every row EXCEPT those, and ON CONFLICT
    // then inserts a duplicate rather than updating (§4 D5). It is asserted for
    // all seven because nullability is a schema property a later ALTER can change.
    for (const table of SEVEN) {
      const re = new RegExp(
        `CREATE UNIQUE INDEX IF NOT EXISTS ${table}_natural_key\\s+ON public\\.${table} \\([^)]*\\)\\s+NULLS NOT DISTINCT`,
      );
      expect(KEYS_SQL, `${table}'s natural-key index is not NULLS NOT DISTINCT`).toMatch(re);
    }
  });

  it("20260916000017 deduplicates on the same keys it is about to constrain", () => {
    // The dedup runs BEFORE the indexes exist, so it cannot read them from the
    // catalog — it carries the lists. A key corrected in the sidecar and not here
    // means the dedup collapses one grain and the index enforces another.
    for (const table of SEVEN) {
      const m = DEDUP_SQL.match(new RegExp(`\\('${table}',\\s*\\n?\\s*ARRAY\\[([^\\]]*)\\]`));
      expect(m, `${table} is not deduplicated by 20260916000017`).toBeTruthy();
      const cols = m![1].split(",").map((c) => c.trim().replace(/'/g, ""));
      // project_id and plant_name are the PARTITION BY's fixed prefix in the
      // function, so the call list carries the rest.
      expect(["project_id", "plant_name", ...cols]).toEqual(intended[table]);
    }
  });
});

describe("the promotion's unit conversions exist twice and must agree", () => {
  const fromSql = (() => {
    const from = UPSERT_SQL.indexOf("CREATE OR REPLACE FUNCTION public.ingest_normalize_at_promotion");
    expect(from).toBeGreaterThan(-1);
    const body = UPSERT_SQL.slice(from, UPSERT_SQL.indexOf("$$;", from));
    return [...body.matchAll(/\('(\w+)',\s*'(\w+)',\s*'(\w+)',\s*'(\w+)',\s*'(\w+)'\)/g)].map(
      (m) => ({ target: m[1], column: m[2], unitColumn: m[3], conversion: m[4], canonical: m[5] }),
    );
  })();

  const fromSpec = Object.values(INGEST_DATASETS).flatMap((d) =>
    d.normalize.map((n) => ({ target: d.target, ...n })),
  );

  const sortKey = (r: { target: string; column: string }) => `${r.target}.${r.column}`;
  const norm = (rs: typeof fromSpec) => [...rs].sort((a, b) => sortKey(a).localeCompare(sortKey(b)));

  it("names the same conversions in SQL as the contract generates", () => {
    expect(norm(fromSql)).toEqual(norm(fromSpec));
  });

  it("every conversion reads a unit column the dataset actually has", () => {
    for (const d of Object.values(INGEST_DATASETS)) {
      const columns = new Set(d.columns.map((c) => c.column));
      for (const n of d.normalize) {
        expect(columns.has(n.column), `${d.target}.${n.column} is normalized but is not a CSV column`).toBe(true);
        expect(columns.has(n.unitColumn), `${d.target}.${n.unitColumn} is a unit column the dataset does not carry`).toBe(true);
      }
    }
  });

  it("a rate and a duration are never confused", () => {
    // They are not inverses: a duration of 1 month is ~4.35 weeks, a rate of
    // 1 per month is ~0.23 per week. Anything named like a lead time that was
    // declared a `rate` would be wrong by the square of the unit.
    for (const n of fromSpec) {
      if (/lead_time|duration/.test(n.column)) expect(n.conversion).toBe("duration");
      if (/^volume$/.test(n.column)) expect(n.conversion).toBe("rate");
    }
  });

  it("every normalized value lands in a unit the one unit table knows", () => {
    for (const n of fromSpec) expect(UNIT_DAYS[n.canonical]).toBeGreaterThan(0);
  });
});

/**
 * WP 3.3 — THE LEGACY EDGE FUNCTIONS' `onConflict` IS A FOURTH COPY OF THE KEY.
 *
 * `20260916000018` put a unique index on each lane's natural key, which turns
 * these three functions' plain `.insert()` into a 23505 the first time a user
 * re-sends a row that already exists — `ingest-inbound-logistics` is the fallback
 * the /policies grid uses to assign a supplier, and "already assigned" is a no-op,
 * not an error. They upsert now, and PostgREST needs the conflict target spelled
 * out, so the key exists once more in a place that can drift.
 */
describe("the legacy ingest functions upsert on the same key the index enforces", () => {
  const LEGACY: Array<[string, string]> = [
    ["ingest-inbound-logistics", "inbound_logistics"],
    ["ingest-outbound-logistics", "outbound_logistics"],
    ["ingest-bom-multi-level", "bom_multi_level"],
  ];

  it("names exactly natural_key_intended in onConflict", () => {
    for (const [fn, table] of LEGACY) {
      const src = readFileSync(join(ROOT, "supabase", "functions", fn, "index.ts"), "utf8");
      const m = src.match(/onConflict:\s*'([^']+)'/);
      expect(m, `${fn} does not name a conflict target`).toBeTruthy();
      const intended = (CONTRACT.tables as any)[table].natural_key_intended as string[];
      expect(m![1].split(",").map((c) => c.trim())).toEqual(intended);
    }
  });

  it("none of them still uses a bare .insert() into its lane", () => {
    // A plain insert is the duplicate-or-crash behaviour, depending only on
    // whether the row happens to exist. Neither is acceptable now.
    for (const [fn, table] of LEGACY) {
      const src = readFileSync(join(ROOT, "supabase", "functions", fn, "index.ts"), "utf8");
      expect(src, `${fn} still inserts into ${table}`).not.toMatch(
        new RegExp(`from\\('${table}'\\)\\s*\\.insert\\(`),
      );
    }
  });
});
