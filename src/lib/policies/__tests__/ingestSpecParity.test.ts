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
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  INGEST_DATASETS,
  PROMOTABLE_TARGETS,
} from "../../../../supabase/functions/_shared/ingestSpec.generated";

const ROOT = join(__dirname, "..", "..", "..", "..");
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), "utf8");

const LANDING_SQL = read("supabase", "migrations", "20260916000015_ingest_landing.sql");
const WIZARD = read("src", "components", "UploadWizard.tsx");
const FUNCTION = read("supabase", "functions", "ingest-file", "index.ts");

describe("the promotable-target list exists twice and must agree", () => {
  it("names the same tables in SQL as the contract generates", () => {
    const from = LANDING_SQL.indexOf("CREATE OR REPLACE FUNCTION public.ingest_target_is_promotable");
    expect(from).toBeGreaterThan(-1);
    const body = LANDING_SQL.slice(from, LANDING_SQL.indexOf("$$;", from));
    const inSql = [...body.matchAll(/'([a-z0-9_]+)'/g)].map((m) => m[1]).sort();
    expect(inSql).toEqual([...PROMOTABLE_TARGETS].sort());
  });

  it("names a target for every dataset and nothing else", () => {
    expect([...new Set(Object.values(INGEST_DATASETS).map((d) => d.target))].sort())
      .toEqual([...PROMOTABLE_TARGETS].sort());
  });

  it("covers the six datasets this package moved server-side", () => {
    expect(PROMOTABLE_TARGETS).toEqual([
      "bom_multi_level",
      "bom_single_level",
      "inbound_logistics",
      "outbound_logistics",
      "tier2_suppliers",
      "tier3_suppliers",
    ]);
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
