// Phase 4c migration pinned against scratch Postgres (ai-agents.md §18.2 v2,
// §7.4 tier 1 — the db_rpc_test.ts discipline): applies the VERBATIM
// 20260728000001_cartographer_product_level.sql on a scratch cluster and
// asserts the two assign RPCs' laws — assign_bom_line's rate > 0 CHECK (the
// engine's BomLine.rate hard constraint), the WHERE-NOT-EXISTS idempotency
// of lane + supply_chain_data edge on both paths, the structural
// (economics-NULL) outbound lane, and project_not_found. Skips (or fails
// under EVAL_REQUIRE_DB=1) when no Postgres binaries exist.

import { assert, assertEquals, assertStringIncludes } from "./harness/asserts.ts";
import { startScratchPostgres } from "./harness/pg.ts";

const PROJECT = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";

const SETUP_SQL = `
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE public.projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text,
  plant_name text,
  organization text
);
INSERT INTO public.projects (id, name, plant_name, organization)
VALUES ('${PROJECT}', 'Eval project', 'Alpine Assembly Graz', 'demo-org');

CREATE TABLE public.bom_single_level (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL,
  plant_name text,
  product_id text,
  material_id text,
  consumption_rate numeric
);
CREATE TABLE public.outbound_logistics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL,
  plant_name text,
  product_id text,
  customer_id text,
  volume numeric,
  time_unit text,
  unit_price numeric
);
CREATE TABLE public.supply_chain_data (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL,
  plant_name text,
  data_source text,
  from_location text,
  to_location text,
  material_consumption_rate numeric,
  sourcing_ratio numeric,
  weighted numeric,
  uploaded_by uuid,
  organization text
);
`;

const bomSql = (rate: string, product = "PRD-INV", material = "MAT-PM") =>
  `SELECT public.assign_bom_line('${PROJECT}', '${product}', '${material}', ${rate}, '${USER}', 'a@example.com');`;
const outboundSql = (product = "PRD-INV", customer = "ext-veyron-logistics") =>
  `SELECT public.assign_outbound_customer('${PROJECT}', '${product}', '${customer}', '${USER}', 'a@example.com');`;

Deno.test("Phase 4c migration against scratch Postgres", async (t) => {
  const db = await startScratchPostgres();
  if (!db) {
    if ((Deno.env.get("EVAL_REQUIRE_DB") ?? "") === "1") {
      throw new Error("EVAL_REQUIRE_DB=1 but no Postgres binaries were found");
    }
    console.warn("%cSKIP: no Postgres binaries — DB-backed Phase 4c assertions not run", "color: yellow");
    return;
  }

  try {
    await t.step("setup + migration apply cleanly (verbatim file)", async () => {
      await db.sql(SETUP_SQL);
      await db.applyFile(
        new URL("../../../migrations/20260728000001_cartographer_product_level.sql", import.meta.url),
      );
    });

    await t.step("assign_bom_line writes lane + 'bom' edge once (WHERE-NOT-EXISTS idempotent)", async () => {
      await db.sql(bomSql("1.0666666666666667"));
      await db.sql(bomSql("1.0666666666666667")); // retry converges
      await db.sql(bomSql("9.9")); // even a different rate never duplicates the pair
      const rows = await db.sql(
        `SELECT count(*)::text || '|' || min(consumption_rate)::text
           FROM public.bom_single_level
          WHERE project_id = '${PROJECT}' AND product_id = 'PRD-INV' AND material_id = 'MAT-PM';`,
      );
      assertEquals(rows, "1|1.0666666666666667", "one BOM row; the FIRST rate stands (never overwritten)");
      const edges = await db.sql(
        `SELECT count(*)::text FROM public.supply_chain_data
          WHERE project_id = '${PROJECT}' AND data_source = 'bom'
            AND from_location = 'MAT-PM' AND to_location = 'PRD-INV';`,
      );
      assertEquals(edges, "1", "one 'bom' edge (from = material, to = product)");
      const plant = await db.sql(
        `SELECT plant_name FROM public.bom_single_level WHERE project_id = '${PROJECT}' LIMIT 1;`,
      );
      assertEquals(plant, "Alpine Assembly Graz", "the project's plant is stamped");
    });

    await t.step("assign_bom_line rejects rate <= 0 (BomLine.rate hard constraint) and unknown projects", async () => {
      const zero = await db.sqlExpectError(bomSql("0", "PRD-INV", "MAT-X"));
      assertStringIncludes(zero, "must be > 0");
      const negative = await db.sqlExpectError(bomSql("-1", "PRD-INV", "MAT-X"));
      assertStringIncludes(negative, "must be > 0");
      const noProject = await db.sqlExpectError(
        `SELECT public.assign_bom_line('99999999-9999-4999-8999-999999999999', 'P', 'M', 1, '${USER}', NULL);`,
      );
      assertStringIncludes(noProject, "project_not_found");
      const none = await db.sql(
        `SELECT count(*)::text FROM public.bom_single_level WHERE material_id = 'MAT-X';`,
      );
      assertEquals(none, "0", "refused calls write nothing");
    });

    await t.step("assign_outbound_customer writes a STRUCTURAL lane (economics NULL) + 'outbound' edge, idempotent", async () => {
      await db.sql(outboundSql());
      await db.sql(outboundSql()); // retry converges
      const lane = await db.sql(
        `SELECT count(*)::text || '|' ||
                coalesce(min(volume)::text, 'NULL') || '|' ||
                coalesce(min(unit_price)::text, 'NULL')
           FROM public.outbound_logistics
          WHERE project_id = '${PROJECT}' AND product_id = 'PRD-INV'
            AND customer_id = 'ext-veyron-logistics';`,
      );
      assertEquals(lane, "1|NULL|NULL", "one lane; volume and unit_price stay NULL — never estimated");
      const edges = await db.sql(
        `SELECT count(*)::text FROM public.supply_chain_data
          WHERE project_id = '${PROJECT}' AND data_source = 'outbound'
            AND from_location = 'PRD-INV' AND to_location = 'ext-veyron-logistics';`,
      );
      assertEquals(edges, "1", "one 'outbound' edge (from = product, to = customer)");
    });

    await t.step("grants: the assign RPCs are executable by the app roles", async () => {
      for (const fn of ["assign_bom_line", "assign_outbound_customer"]) {
        const grants = await db.sql(
          `SELECT count(*)::text FROM information_schema.routine_privileges
            WHERE routine_name = '${fn}' AND grantee IN ('anon','authenticated','service_role')
              AND privilege_type = 'EXECUTE';`,
        );
        assert(Number(grants) >= 3, `${fn} granted to the app roles`);
      }
    });
  } finally {
    await db.stop();
  }
});
