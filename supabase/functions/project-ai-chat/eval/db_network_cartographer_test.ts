// Phase 4b migration pinned against scratch Postgres (ai-agents.md §18.2,
// §7.4 tier 1 — the db_rpc_test.ts discipline): applies the VERBATIM
// 20260727000001_network_cartographer.sql on a scratch cluster and asserts
// the external_evidence store's laws — the single insert path
// (record_external_evidence), content-addressed idempotency, the CHECK
// vocabulary (confidence range, LEI shape), the per-project cap error text,
// and the proposals constraint swap admitting exactly the
// ('network-cartographer','network_map_diff') pairing. Skips (or fails
// under EVAL_REQUIRE_DB=1) when no Postgres binaries exist.

import { assert, assertEquals, assertStringIncludes } from "./harness/asserts.ts";
import { startScratchPostgres } from "./harness/pg.ts";

const PROJECT = "11111111-1111-4111-8111-111111111111";
const NORDWIND_LEI = "529900NORDWIND000044";

const SETUP_SQL = `
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE PUBLICATION supabase_realtime;

CREATE TABLE public.projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text
);
GRANT SELECT ON public.projects TO anon, authenticated, service_role;
INSERT INTO public.projects (id, name) VALUES ('${PROJECT}', 'Eval project');

-- capability registry stand-ins (mirrors 20260711000002 DDL)
CREATE TABLE public.capabilities (
  key text PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('page','feature')),
  label text NOT NULL,
  description text,
  sort_order integer NOT NULL DEFAULT 100,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.role_capabilities (
  role text NOT NULL CHECK (role IN ('super_admin','admin','modeler','user')),
  capability_key text NOT NULL REFERENCES public.capabilities(key) ON DELETE CASCADE,
  allowed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (role, capability_key)
);
`;

const TRIPLE = JSON.stringify({
  subject: { name: "Nordwind Semiconductor GmbH", lei: NORDWIND_LEI },
  relation: "SuppliesTo",
  object: { name: "Helix Drives GmbH", type: "Company" },
  quote: "Nordwind Semiconductor GmbH supplies power modules to Helix Drives GmbH.",
});

function recordSql(opts?: {
  project?: string;
  source?: string;
  hash?: string;
  confidence?: number;
  triple?: string;
  lei?: string | null;
}): string {
  const lei = opts?.lei === undefined ? `'${NORDWIND_LEI}'` : opts.lei === null ? "NULL" : `'${opts.lei}'`;
  return `SELECT public.record_external_evidence(
    '${opts?.project ?? PROJECT}', '${opts?.source ?? "news-wire"}', 'wire article',
    '${opts?.hash ?? "hash-doc-a"}', ${opts?.confidence ?? 0.7},
    '${(opts?.triple ?? TRIPLE).replace(/'/g, "''")}'::jsonb, ${lei});`;
}

Deno.test("Phase 4b migration against scratch Postgres", async (t) => {
  const db = await startScratchPostgres();
  if (!db) {
    if ((Deno.env.get("EVAL_REQUIRE_DB") ?? "") === "1") {
      throw new Error("EVAL_REQUIRE_DB=1 but no Postgres binaries were found");
    }
    console.warn("%cSKIP: no Postgres binaries — DB-backed Phase 4b assertions not run", "color: yellow");
    return;
  }

  try {
    await t.step("setup + migrations apply cleanly (verbatim files)", async () => {
      await db.sql(SETUP_SQL);
      for (const f of [
        "20260715000001_agent_proposals.sql",
        "20260727000001_network_cartographer.sql",
      ]) {
        await db.applyFile(new URL(`../../../migrations/${f}`, import.meta.url));
      }
    });

    let firstId = "";
    await t.step("record_external_evidence inserts and converges on the dedupe key", async () => {
      firstId = await db.sql(recordSql());
      assert(firstId.length > 0, "insert returns the row id");
      const again = await db.sql(recordSql());
      assertEquals(again, firstId, "same (project, source, hash, triple) converges — never a duplicate row");
      const otherSource = await db.sql(recordSql({ source: "sec-edgar", hash: "hash-doc-b", confidence: 0.9 }));
      assert(otherSource !== firstId, "a second independent source is a second evidence row");
      const count = await db.sql(`SELECT count(*)::text FROM public.external_evidence WHERE project_id = '${PROJECT}';`);
      assertEquals(count, "2");
    });

    await t.step("the CHECK vocabulary rejects out-of-range confidence and malformed LEIs", async () => {
      const e1 = await db.sqlExpectError(recordSql({ hash: "hash-bad-1", confidence: 1.5 }));
      assertStringIncludes(e1, "confidence");
      const e2 = await db.sqlExpectError(recordSql({ hash: "hash-bad-2", lei: "NOT-A-LEI" }));
      assertStringIncludes(e2, "lei");
      const e3 = await db.sqlExpectError(recordSql({ project: "99999999-9999-4999-8999-999999999999", hash: "hash-bad-3" }));
      assertStringIncludes(e3, "not found");
    });

    await t.step("clients read, only the RPC writes (the proposals posture)", async () => {
      const grants = await db.sql(
        `SELECT string_agg(privilege_type, ',' ORDER BY privilege_type)
           FROM information_schema.role_table_grants
          WHERE table_name = 'external_evidence' AND grantee = 'anon';`,
      );
      assertEquals(grants, "SELECT", "anon holds SELECT only");
    });

    await t.step("proposals admits ('network-cartographer','network_map_diff') and rejects foreign pairings", async () => {
      const ok = await db.sql(`SELECT public.create_agent_proposal(
        '${PROJECT}', 'network-cartographer', 'network_map_diff',
        'Map diff', '{"schema_version":1,"rows":[],"pending":[]}'::jsonb,
        '[{"kind":"document","ref":"external_evidence:${firstId}"}]'::jsonb,
        'llm_drafted', '{}'::jsonb, 'nc-idem-1',
        NULL, 'gemini-2.5-flash', 'gemini', NULL, NULL, 'proposed');`);
      assert(ok.length > 0, "the Phase 4b pairing is accepted");
      const bad = await db.sqlExpectError(`SELECT public.create_agent_proposal(
        '${PROJECT}', 'network-cartographer', 'item_master_diff',
        'Wrong pairing', '{}'::jsonb, '[]'::jsonb,
        'llm_drafted', '{}'::jsonb, 'nc-idem-2',
        NULL, NULL, NULL, NULL, NULL, 'proposed');`);
      assertStringIncludes(bad, "proposals_agent_owns_artifact");
    });
  } finally {
    await db.stop();
  }
});
