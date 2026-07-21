// B8 Network Cartographer v2 golden suite, deterministic tier (ai-agents.md
// §18.2 v2 nc-11..nc-16, §7.4 tier 1): the product-level decomposition —
// the registered r_{p,m} rate methods (observed-consumption, IO technical
// coefficient from the checked-in seed slice, spend ÷ unit-price implied),
// the 1e-9 rate recomputation gates, the mass-balance validator (a refusal
// naming the imbalance, never a silently adjusted rate), the held-out
// real-BOM back-test with per-row misses and method demotion, the
// CARTOGRAPHER_PRODUCT_LEVEL kill switch (off ⇒ byte-identical v1), and the
// full map→estimate→apply run ending in the G16 run-readiness contract:
// gate green, org-correct, self-verified through list_projects /
// get_project_dataset_status / the ONE shared grader (blueprint §12).
// No LLM, no network, no database.

import { assert, assertEquals, assertStringIncludes } from "./harness/asserts.ts";
import { makeAgentRpcs, makeStubDb, type Row, type StubDb } from "./harness/stub_db.ts";
import { executeTool, type ToolContext, type ToolEnvelope } from "../tools.ts";
import {
  buildCartographerPrompt,
  cartographerToolDeclarationList,
} from "../cartographerTools.ts";
import {
  backTestRateMethod,
  checkMassBalance,
  findRateMethod,
  MASS_BALANCE_TOLERANCE,
  RATE_ESTIMATOR_METHODS,
  type EstimatorInputs,
} from "../../_shared/estimators.ts";
import { loadGateDataset, runValidationGate } from "../../_shared/validationGate.ts";
import { ApplyFailure } from "../../agent-apply/itemMasterApply.ts";
import { applyNetworkMapDiff } from "../../agent-apply/networkMapDiffApply.ts";

const PROJECT = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";

interface Fixture {
  id: string;
  description: string;
  project_snapshot: Record<string, Row[]>;
  utterance: string;
  evidence_ids?: Record<string, string[]>;
  // deno-lint-ignore no-explicit-any
  expect: Record<string, any>;
  retired_reason: string | null;
}

async function loadFixture(id: string): Promise<Fixture> {
  return JSON.parse(
    await Deno.readTextFile(new URL(`./fixtures/network-cartographer/${id}.json`, import.meta.url)),
  );
}

function makeCtx(fixture: Fixture): { ctx: ToolContext; db: StubDb } {
  const tables = structuredClone(fixture.project_snapshot) as Record<string, Row[]>;
  const db = makeStubDb(tables, makeAgentRpcs(tables));
  const ctx: ToolContext = {
    projectId: PROJECT,
    userId: USER,
    supabase: db as unknown as ToolContext["supabase"],
    draft: {
      userEmail: "a@example.com",
      threadId: "33333333-3333-4333-8333-333333333333",
      modelCode: "gemini-2.5-flash",
      providerCode: "gemini",
      canProposals: true,
      utterance: fixture.utterance,
    },
  };
  return { ctx, db };
}

/** Fixture snapshot → the grader dataset shape (the same mapping
 * loadGateDataset performs over live tables). */
function snapshotInputs(fixture: Fixture): EstimatorInputs {
  const s = structuredClone(fixture.project_snapshot) as Record<string, Row[]>;
  return {
    dataset: {
      materials: s.materials ?? [],
      products: s.products ?? [],
      suppliers: s.suppliers ?? [],
      inbound: s.inbound_logistics ?? [],
      outbound: s.outbound_logistics ?? [],
      bom: s.bom_single_level ?? [],
    },
    defaults: {},
  };
}

function withProductLevel<T>(fn: () => Promise<T>): Promise<T> {
  Deno.env.set("AGENT_ENABLED_IDS", "network-cartographer");
  Deno.env.set("CARTOGRAPHER_PRODUCT_LEVEL", "true");
  return fn().finally(() => {
    Deno.env.delete("AGENT_ENABLED_IDS");
    Deno.env.delete("CARTOGRAPHER_PRODUCT_LEVEL");
  });
}

function withV1Only<T>(fn: () => Promise<T>): Promise<T> {
  Deno.env.set("AGENT_ENABLED_IDS", "network-cartographer");
  Deno.env.delete("CARTOGRAPHER_PRODUCT_LEVEL");
  return fn().finally(() => Deno.env.delete("AGENT_ENABLED_IDS"));
}

function assertFailure(env: ToolEnvelope, code: string, reasonIncludes?: string) {
  assertEquals(env.kind, "text", `failure envelopes are text (got ${env.kind}: ${JSON.stringify(env.data)})`);
  assertEquals(env.meta?.note, code, `error code (got: ${env.data})`);
  if (reasonIncludes) assertStringIncludes(String(env.data), reasonIncludes);
}

const approx = (a: number, b: number, what: string) =>
  assert(Math.abs(a - b) <= 1e-9, `${what}: ${a} !~ ${b}`);

interface RateCell {
  product: string;
  material: string;
  method: string;
  rate: number;
  low: number;
  high: number;
  basis: string;
  dataset: string;
  vintage: string;
  status: string;
}

function rateCells(env: ToolEnvelope): RateCell[] {
  assertEquals(env.kind, "table", `rate estimates return a table (got ${env.kind}: ${env.data})`);
  const data = env.data as { columns: string[]; rows: unknown[][] };
  assertEquals(
    data.columns,
    ["product_id", "material_id", "method", "rate", "low", "high", "basis", "dataset", "vintage", "status", "assumptions"],
    "§18.2 v2 rate-candidate column contract",
  );
  return data.rows.map((r) => ({
    product: String(r[0]),
    material: String(r[1]),
    method: String(r[2]),
    rate: Number(r[3]),
    low: Number(r[4]),
    high: Number(r[5]),
    basis: String(r[6]),
    dataset: String(r[7]),
    vintage: String(r[8]),
    status: String(r[9]),
  }));
}

// ── nc-11 ──

Deno.test("nc-11-flag-off-product-level: v2 ops refused with the v1 message; tool refused naming the flag; stored v2 payloads do not apply", async () => {
  const fixture = await loadFixture("nc-11-flag-off-product-level");
  const { ctx, db } = makeCtx(fixture);
  await withV1Only(async () => {
    // The v2 op is rejected with the BYTE-IDENTICAL v1 message.
    const draft = await executeTool("draft_network_map_diff", {
      rows: [{
        op: "add_bom_line",
        supplier_name: "Nordwind Semiconductor GmbH",
        product_id: "PRD-INV",
        material_id: "MAT-PM",
        rate_method: "rate_io_technical_coefficient@1",
        rate: 1,
        rate_low: 1,
        rate_high: 1,
        evidence_ids: ["eeeeeeee-0000-4000-8000-000000000001"],
      }],
    }, ctx);
    assertFailure(draft, fixture.expect.draft_error_code, fixture.expect.draft_reason_includes);
    assertEquals(db.tables.proposals?.length ?? 0, fixture.expect.proposals, "no proposal");

    // The v2 read tool refuses, naming the flag.
    const rates = await executeTool("get_bom_rate_estimates", {}, ctx);
    assertFailure(rates, fixture.expect.tool_error_code, fixture.expect.tool_reason_includes);

    // Tool surface: v1's four; five only under the flag.
    assertEquals(cartographerToolDeclarationList().length, fixture.expect.v1_declarations, "flag off ⇒ v1 surface");
    Deno.env.set("CARTOGRAPHER_PRODUCT_LEVEL", "true");
    try {
      assertEquals(cartographerToolDeclarationList().length, fixture.expect.v2_declarations, "flag on ⇒ +get_bom_rate_estimates");
    } finally {
      Deno.env.delete("CARTOGRAPHER_PRODUCT_LEVEL");
    }

    // Prompt template: byte-identical v1 without the v2 block.
    const promptArgs = {
      projectId: PROJECT,
      utterance: "map",
      sourcesJson: "[]",
      evidenceJson: "[]",
      entitiesJson: "[]",
    };
    assert(
      !buildCartographerPrompt(promptArgs).includes("PRODUCT-LEVEL DECOMPOSITION"),
      "flag off ⇒ no v2 prompt block",
    );
    assertStringIncludes(
      buildCartographerPrompt({ ...promptArgs, rateMethodsJson: "[]" }),
      "PRODUCT-LEVEL DECOMPOSITION",
    );

    // A stored v2 payload does not apply once the flag is off (§9 kill-switch
    // discipline — flags gate existence, not just drafting).
    let failed: ApplyFailure | null = null;
    try {
      await applyNetworkMapDiff(db, {
        projectId: PROJECT,
        payload: {
          schema_version: 2,
          rows: [{
            op: "add_bom_line",
            supplier_name: "Nordwind Semiconductor GmbH",
            product_id: "PRD-INV",
            material_id: "MAT-PM",
            rate_method: "rate_io_technical_coefficient@1",
            rate: 1,
            rate_low: 1,
            rate_high: 1,
            evidence_ids: ["eeeeeeee-0000-4000-8000-000000000001"],
          }],
        },
        grounding: {},
        userId: USER,
        userEmail: null,
      });
    } catch (e) {
      failed = e as ApplyFailure;
    }
    assert(failed instanceof ApplyFailure, "apply throws ApplyFailure");
    assertEquals(failed!.code, fixture.expect.apply_error_code);
    assertStringIncludes(failed!.message, fixture.expect.apply_reason_includes);
  });
});

// ── nc-12 ──

Deno.test("nc-12-rate-methods: the three registered r_{p,m} methods recompute with {value, low, high, basis}; mismatch and missing interval are refused", async () => {
  const fixture = await loadFixture("nc-12-rate-methods");
  const { ctx, db } = makeCtx(fixture);
  await withProductLevel(async () => {
    const cells = rateCells(await executeTool("get_bom_rate_estimates", {}, ctx));
    const byMethod = new Map(cells.map((c) => [c.method, c]));
    assertEquals(cells.length, 3, "three methods ground the (PRD-INV, MAT-PM) pair");
    for (const c of cells) {
      assertEquals(c.product, "PRD-INV");
      assertEquals(c.material, "MAT-PM");
      assert(c.low <= c.rate && c.rate <= c.high, "interval law: low <= rate <= high");
      assertEquals(c.status, "ok");
    }

    const obs = byMethod.get(fixture.expect.observed.method)!;
    approx(obs.rate, fixture.expect.observed.value, "observed value (flow ÷ output)");
    approx(obs.low, fixture.expect.observed.low, "observed low");
    approx(obs.high, fixture.expect.observed.high, "observed high");
    assertEquals(obs.basis, fixture.expect.observed.basis, "complete-data quotient rides direct_sum");

    const io = byMethod.get(fixture.expect.io.method)!;
    approx(io.rate, fixture.expect.io.value, "io value (a × u_p/c_m)");
    approx(io.low, fixture.expect.io.low, "io low");
    approx(io.high, fixture.expect.io.high, "io high");
    assertEquals(io.basis, fixture.expect.io.basis);
    assertStringIncludes(io.dataset, fixture.expect.io.dataset_includes, "§18.5 law 2: dataset named verbatim");
    assertEquals(io.vintage, fixture.expect.io.vintage, "§18.5 law 2: vintage named");

    const spend = byMethod.get(fixture.expect.spend.method)!;
    approx(spend.rate, fixture.expect.spend.value, "spend-implied value");
    approx(spend.low, fixture.expect.spend.low, "spend low");
    approx(spend.high, fixture.expect.spend.high, "spend high");

    // A rate off by 0.01 fails recomputation — not_grounded naming it.
    const mismatch = await executeTool("draft_network_map_diff", {
      rows: [{
        op: "add_bom_line",
        supplier_name: "Nordwind Semiconductor GmbH",
        product_id: "PRD-INV",
        material_id: "MAT-PM",
        rate_method: fixture.expect.io.method,
        rate: fixture.expect.io.value + 0.01,
        rate_low: fixture.expect.io.low,
        rate_high: fixture.expect.io.high,
        evidence_ids: fixture.evidence_ids!.produces,
      }],
    }, ctx);
    assertFailure(mismatch, fixture.expect.mismatch_error_code, fixture.expect.mismatch_reason_includes);

    // The interval is REQUIRED on every rate (§18.1 law applied to r_{p,m}).
    const noInterval = await executeTool("draft_network_map_diff", {
      rows: [{
        op: "add_bom_line",
        supplier_name: "Nordwind Semiconductor GmbH",
        product_id: "PRD-INV",
        material_id: "MAT-PM",
        rate_method: fixture.expect.io.method,
        rate: fixture.expect.io.value,
        evidence_ids: fixture.evidence_ids!.produces,
      }],
    }, ctx);
    assertFailure(noInterval, fixture.expect.missing_interval_code, fixture.expect.missing_interval_reason_includes);

    assertEquals(db.tables.proposals?.length ?? 0, fixture.expect.proposals, "no proposal");
  });
});

// ── nc-13 ──

Deno.test("nc-13-product-decomposition: one proposal carries supplier + link + BOM line (estimated rate, server-stamped sources) + structural outbound lane; provisional lines never enter", async () => {
  const fixture = await loadFixture("nc-13-product-decomposition");
  const { ctx, db } = makeCtx(fixture);
  await withProductLevel(async () => {
    const draftArgs = {
      rows: [
        { op: "add_supplier", supplier_name: "Nordwind Semiconductor GmbH", evidence_ids: fixture.evidence_ids!.supplies },
        { op: "add_supply_link", supplier_name: "Nordwind Semiconductor GmbH", material_id: "MAT-PM", evidence_ids: fixture.evidence_ids!.produces },
        {
          op: "add_bom_line",
          supplier_name: "Nordwind Semiconductor GmbH",
          product_id: "PRD-INV",
          material_id: "MAT-PM",
          rate_method: fixture.expect.io.method,
          rate: fixture.expect.io.value,
          rate_low: fixture.expect.io.low,
          rate_high: fixture.expect.io.high,
          evidence_ids: fixture.evidence_ids!.produces,
        },
        {
          op: "add_outbound_lane",
          supplier_name: "Alpine Motors AG",
          product_id: "PRD-INV",
          customer_name: "Veyron Logistics Ltd",
          evidence_ids: fixture.evidence_ids!.outbound,
        },
      ],
      title: "Decompose the inverter supply into product-level structure",
    };
    const draft = await executeTool("draft_network_map_diff", draftArgs, ctx);
    assertEquals(draft.kind, "proposal", `draft filed (got ${draft.kind}: ${draft.data})`);
    const proposalId = String((draft.data as Record<string, unknown>).proposal_id);
    const stored = db.tables.proposals.find((p) => String(p.id) === proposalId)!;
    assertEquals(stored.provenance, fixture.expect.proposal.provenance, "extraction + pairing are llm_drafted, honestly");
    const payload = stored.payload as { schema_version: number; rows: Array<Record<string, unknown>> };
    assertEquals(payload.schema_version, fixture.expect.proposal.schema_version, "v2 payloads say so");
    assertEquals(payload.rows.length, fixture.expect.proposal.rows);

    const bomRow = payload.rows.find((r) => r.op === "add_bom_line")!;
    approx(Number(bomRow.rate), fixture.expect.io.value, "stored rate = recomputed value");
    approx(Number(bomRow.rate_low), fixture.expect.io.low, "stored low");
    approx(Number(bomRow.rate_high), fixture.expect.io.high, "stored high");
    assertEquals(String(bomRow.rate_basis), fixture.expect.proposal.rate_basis);
    assertEquals(String(bomRow.rate_method), fixture.expect.io.method);
    const sources = bomRow.rate_sources as Array<{ dataset: string }>;
    assert(
      sources.some((s) => s.dataset.includes(fixture.expect.proposal.rate_sources_dataset_includes)),
      "the matched seed row's dataset is server-stamped on the row",
    );
    assertEquals(String(bomRow.status), "verified", "the material evidence is verified");

    const outRow = payload.rows.find((r) => r.op === "add_outbound_lane")!;
    assertEquals(String(outRow.customer_id), fixture.expect.proposal.customer_id, "customer id derived server-side");
    assert(outRow.rate === undefined, "outbound lanes carry NO estimated economics");

    const refs = ((stored.citations ?? []) as Array<Record<string, unknown>>).map((c) => String(c.ref));
    for (const want of fixture.expect.proposal.citation_refs_include) {
      assert(refs.includes(want), `citation ref ${want}`);
    }

    // §4.5 duplicate path converges.
    const again = await executeTool("draft_network_map_diff", draftArgs, ctx);
    assertEquals(again.kind, "proposal");
    assertEquals(String((again.data as Record<string, unknown>).proposal_id), proposalId, "idempotent proposal id");
    assertEquals(again.meta?.note, "duplicate");

    // A BOM line citing a provisional (1-source) triple never enters.
    const provisional = await executeTool("draft_network_map_diff", {
      rows: [{
        op: "add_bom_line",
        supplier_name: "Baltic Cathode Works",
        product_id: "PRD-INV",
        material_id: "MAT-CTH",
        rate_method: fixture.expect.io_cth.method,
        rate: fixture.expect.io_cth.value,
        rate_low: fixture.expect.io_cth.low,
        rate_high: fixture.expect.io_cth.high,
        evidence_ids: fixture.evidence_ids!.provisional,
      }],
    }, ctx);
    assertFailure(provisional, fixture.expect.provisional_error_code, fixture.expect.provisional_reason_includes);
    assertEquals(db.tables.proposals.length, 1, "only the verified proposal exists");
  });
});

// ── nc-14 ──

Deno.test("nc-14-mass-balance-violation: the validator refuses BEFORE drafting, naming the imbalance; the rate is never silently adjusted", async () => {
  const fixture = await loadFixture("nc-14-mass-balance-violation");
  const { ctx, db } = makeCtx(fixture);
  await withProductLevel(async () => {
    const draft = await executeTool("draft_network_map_diff", {
      rows: [{
        op: "add_bom_line",
        supplier_name: "Nordwind Semiconductor GmbH",
        product_id: "PRD-INV",
        material_id: "MAT-PM",
        rate_method: fixture.expect.io.method,
        rate: fixture.expect.io.value,
        rate_low: fixture.expect.io.low,
        rate_high: fixture.expect.io.high,
        evidence_ids: fixture.evidence_ids!.produces,
      }],
    }, ctx);
    assertEquals(draft.meta?.note, fixture.expect.error_code, `mass-balance refusal (got: ${draft.data})`);
    for (const want of fixture.expect.reason_includes) {
      assertStringIncludes(String(draft.data), want);
    }
    assertEquals(db.tables.proposals?.length ?? 0, fixture.expect.proposals, "no proposal");

    // The validator itself is pure and names the numbers.
    const inputs = snapshotInputs(fixture);
    const violations = checkMassBalance(inputs, [
      { product_id: "PRD-INV", material_id: "MAT-PM", rate: fixture.expect.io.value },
    ]);
    assertEquals(violations.length, 1);
    assertEquals(violations[0].material_id, "MAT-PM");
    assertEquals(violations[0].tolerance, MASS_BALANCE_TOLERANCE);
    assert(
      violations[0].required_weekly > violations[0].available_weekly * (1 + MASS_BALANCE_TOLERANCE),
      "the violation is beyond the declared tolerance",
    );
  });
});

// ── nc-15 ──

Deno.test("nc-15-backtest-holdout: observed BOM rates score each prior method per-row; coverage < 0.5 demotes; a demoted method cannot draft; the surviving one can", async () => {
  const fixture = await loadFixture("nc-15-backtest-holdout");
  const { ctx, db } = makeCtx(fixture);
  const inputs = snapshotInputs(fixture);

  // Per-method back-test stats + per-row misses (the §18.2 v2 report shape).
  const io = RATE_ESTIMATOR_METHODS.find((m) => m.id === "rate_io_technical_coefficient")!;
  const spend = RATE_ESTIMATOR_METHODS.find((m) => m.id === "rate_spend_implied")!;
  const ioBt = backTestRateMethod(io, inputs);
  assertEquals(ioBt.n, fixture.expect.io_backtest.n);
  assertEquals(ioBt.covered, fixture.expect.io_backtest.covered);
  assertEquals(ioBt.demoted, fixture.expect.io_backtest.demoted, "coverage 0/3 < 0.5 ⇒ demoted");
  assertEquals(ioBt.outliers.length, fixture.expect.io_backtest.outliers, "misses reported per-row");
  const spendBt = backTestRateMethod(spend, inputs);
  assertEquals(spendBt.n, fixture.expect.spend_backtest.n);
  assertEquals(spendBt.covered, fixture.expect.spend_backtest.covered);
  assertEquals(spendBt.demoted, fixture.expect.spend_backtest.demoted, "coverage 2/3 ⇒ survives");
  assertEquals(spendBt.outliers.length, fixture.expect.spend_backtest.outliers);
  assertEquals(spendBt.outliers[0].entity_id, "PRD-INV×MAT-RES", "the miss names its pair");

  // The fixture's back-test table rows (the PR artifact) are exactly what
  // the methods recompute: estimated interval vs actual, hit/miss.
  for (const row of fixture.expect.backtest_rows) {
    const [productId, materialId] = String(row.pair).split("×");
    const pair = { product_id: productId, material_id: materialId };
    const ioEst = io.estimate(pair, inputs)!;
    approx(ioEst.low, row.io[0], `${row.pair} io low`);
    approx(ioEst.high, row.io[1], `${row.pair} io high`);
    assertEquals(
      row.actual >= ioEst.low && row.actual <= ioEst.high,
      row.io_hit,
      `${row.pair} io hit/miss`,
    );
    const spendEst = spend.estimate(pair, inputs)!;
    approx(spendEst.low, row.spend[0], `${row.pair} spend low`);
    approx(spendEst.high, row.spend[1], `${row.pair} spend high`);
    assertEquals(
      row.actual >= spendEst.low && row.actual <= spendEst.high,
      row.spend_hit,
      `${row.pair} spend hit/miss`,
    );
  }

  // Hold-out by construction: no rate method reads the target pair's own
  // observed rate — perturbing it moves NO estimate.
  const perturbed = snapshotInputs(fixture);
  const pmLine = perturbed.dataset.bom.find((b) => String(b.material_id) === "MAT-PM")!;
  pmLine.consumption_rate = 99;
  const pair = { product_id: "PRD-INV", material_id: "MAT-PM" };
  approx(io.estimate(pair, perturbed)!.value, io.estimate(pair, inputs)!.value, "io hold-out invariance");
  approx(spend.estimate(pair, perturbed)!.value, spend.estimate(pair, inputs)!.value, "spend hold-out invariance");

  await withProductLevel(async () => {
    // Candidates for the open pair mark the demoted method.
    const cells = rateCells(await executeTool("get_bom_rate_estimates", {}, ctx));
    const ioCell = cells.find((c) => c.method === fixture.expect.io_stl.method && c.material === "MAT-STL")!;
    assertEquals(ioCell.status, "demoted", "demoted methods still appear, marked (the ce-09 discipline)");
    const spendCell = cells.find((c) => c.method === fixture.expect.spend_stl.method && c.material === "MAT-STL")!;
    assertEquals(spendCell.status, "ok");
    approx(spendCell.rate, fixture.expect.spend_stl.value, "surviving-method value");

    // Drafting via the demoted method is not_grounded naming the back-test.
    const demoted = await executeTool("draft_network_map_diff", {
      rows: [{
        op: "add_bom_line",
        supplier_name: "Kestrel Foundry Ltd",
        product_id: "PRD-INV",
        material_id: "MAT-STL",
        rate_method: fixture.expect.io_stl.method,
        rate: fixture.expect.io_stl.value,
        rate_low: fixture.expect.io_stl.low,
        rate_high: fixture.expect.io_stl.high,
        evidence_ids: fixture.evidence_ids!.produces,
      }],
    }, ctx);
    assertFailure(demoted, fixture.expect.demoted_error_code, fixture.expect.demoted_reason_includes);
    assertEquals(db.tables.proposals?.length ?? 0, 0, "no proposal via the demoted method");

    // The surviving method drafts.
    const ok = await executeTool("draft_network_map_diff", {
      rows: [{
        op: "add_bom_line",
        supplier_name: "Kestrel Foundry Ltd",
        product_id: "PRD-INV",
        material_id: "MAT-STL",
        rate_method: fixture.expect.spend_stl.method,
        rate: fixture.expect.spend_stl.value,
        rate_low: fixture.expect.spend_stl.low,
        rate_high: fixture.expect.spend_stl.high,
        evidence_ids: fixture.evidence_ids!.produces,
      }],
    }, ctx);
    assertEquals(ok.kind, "proposal", `surviving method drafts (got: ${ok.data})`);
    const stored = db.tables.proposals[0];
    const row = (stored.payload as { rows: Array<Record<string, unknown>> }).rows[0];
    assertEquals(String(row.supplier_id), fixture.expect.supplier_id, "LEI-anchored producer");
  });
});

// ── nc-16 ──

Deno.test("nc-16-fresh-project-gate-green: map→estimate→apply seeds bom + inbound + outbound; the G16 contract self-verifies — gate green, org-visible, dataset complete, done", async () => {
  const fixture = await loadFixture("nc-16-fresh-project-gate-green");
  const { ctx, db } = makeCtx(fixture);
  await withProductLevel(async () => {
    const draft = await executeTool("draft_network_map_diff", {
      rows: [
        { op: "add_supplier", supplier_name: "Nordwind Semiconductor GmbH", evidence_ids: fixture.evidence_ids!.supplies },
        { op: "add_supply_link", supplier_name: "Nordwind Semiconductor GmbH", material_id: "MAT-PM", evidence_ids: fixture.evidence_ids!.produces },
        {
          op: "add_bom_line",
          supplier_name: "Nordwind Semiconductor GmbH",
          product_id: "PRD-INV",
          material_id: "MAT-PM",
          rate_method: fixture.expect.io.method,
          rate: fixture.expect.io.value,
          rate_low: fixture.expect.io.low,
          rate_high: fixture.expect.io.high,
          evidence_ids: fixture.evidence_ids!.produces,
        },
        {
          op: "add_outbound_lane",
          supplier_name: "Alpine Motors AG",
          product_id: "PRD-INV",
          customer_name: "Veyron Logistics Ltd",
          evidence_ids: fixture.evidence_ids!.outbound,
        },
      ],
      title: "Make the fresh project run-ready from verified evidence",
    }, ctx);
    assertEquals(draft.kind, "proposal", `draft filed (got: ${draft.data})`);
    const stored = db.tables.proposals[0];
    assertEquals(
      (stored.payload as { schema_version: number }).schema_version,
      fixture.expect.proposal.schema_version,
    );
    stored.status = "approved";

    const result = await applyNetworkMapDiff(db, {
      projectId: PROJECT,
      payload: stored.payload as Record<string, unknown>,
      grounding: stored.grounding as Record<string, unknown>,
      userId: USER,
      userEmail: "a@example.com",
    });
    assertEquals(result.added_suppliers, fixture.expect.apply.added_suppliers);
    assertEquals(result.added_links, fixture.expect.apply.added_links);
    assertEquals(result.added_bom_lines, fixture.expect.apply.added_bom_lines);
    assertEquals(result.added_outbound_lanes, fixture.expect.apply.added_outbound_lanes);

    // The seeded rows ride the EXISTING lifecycle: lane + edge + master.
    const bomRow = db.tables.bom_single_level.find(
      (b) => String(b.product_id) === "PRD-INV" && String(b.material_id) === "MAT-PM",
    )!;
    assert(bomRow, "bom_single_level row created");
    approx(Number(bomRow.consumption_rate), fixture.expect.io.value, "the recomputed rate is written");
    assert(
      db.tables.supply_chain_data.some(
        (e) => String(e.data_source) === "bom" && String(e.from_location) === "MAT-PM" && String(e.to_location) === "PRD-INV",
      ),
      "supply_chain_data 'bom' edge created",
    );
    const outLane = db.tables.outbound_logistics.find(
      (o) => String(o.customer_id) === fixture.expect.apply.customer_id,
    )!;
    assert(outLane, "structural outbound lane created");
    assertEquals(outLane.volume, undefined, "outbound economics are NEVER estimated — NULL for the firm's own data");
    assert(
      db.tables.supply_chain_data.some(
        (e) => String(e.data_source) === "outbound" && String(e.to_location) === fixture.expect.apply.customer_id,
      ),
      "supply_chain_data 'outbound' edge created",
    );
    assert(
      db.tables.inbound_logistics.some(
        (l) => String(l.supplier_id) === fixture.expect.proposal.supplier_id && String(l.material_id) === "MAT-PM",
      ),
      "inbound lane created via assign_material_supplier",
    );

    // The G16 self-verification (blueprint §12, verbatim): the three read
    // paths, recorded on the result.
    const v = result.verification!;
    assert(v, "v2 applies self-verify");
    assertEquals(v.org_visible, fixture.expect.verification.org_visible, "list_projects shows the project in-org");
    assertEquals(v.dataset?.completed, fixture.expect.verification.dataset_completed, "get_project_dataset_status complete");
    assertEquals(v.gate.blocks, fixture.expect.verification.gate_blocks, "the shared pre-run gate: ZERO blocks");
    assert(v.gate.green, "gate green");
    assertEquals(v.done, fixture.expect.verification.done, "done = the G16 contract, all three checks");

    // Independent confirmation through the SAME shared grader the
    // sim-command gate runs — Run & Validate shows zero blocks.
    const dataset = await loadGateDataset(db, PROJECT);
    const gate = runValidationGate({
      dataset,
      snapshotDefaults: {},
      disruptionSchedule: [],
      acknowledgeWarnings: false,
    });
    const blocks = gate ? gate.findings.filter((f) => f.severity === "block") : [];
    assertEquals(blocks.length, 0, "Run & Validate: zero blocking findings");

    // Idempotent retry: everything already present; verification still done.
    const retry = await applyNetworkMapDiff(db, {
      projectId: PROJECT,
      payload: stored.payload as Record<string, unknown>,
      grounding: stored.grounding as Record<string, unknown>,
      userId: USER,
      userEmail: "a@example.com",
    });
    assertEquals(retry.added_suppliers, 0);
    assertEquals(retry.added_links, 0);
    assertEquals(retry.added_bom_lines, 0);
    assertEquals(retry.added_outbound_lanes, 0);
    assertEquals(retry.already_present.length, fixture.expect.retry_already_present, "retry mutates nothing");
    assert(retry.verification!.done, "still done");
  });
});

// ── registry sanity: the rate methods are versioned and resolvable ──

Deno.test("rate-method registry: three methods, exact-version resolution, interval law on every estimate", () => {
  assertEquals(RATE_ESTIMATOR_METHODS.length, 3, "observed + spend-implied + io coefficient");
  for (const m of RATE_ESTIMATOR_METHODS) {
    assertEquals(m.target.table, "bom_single_level");
    assertEquals(m.target.field, "consumption_rate");
    assert(findRateMethod(`${m.id}@${m.version}`) === m, "ref resolves");
    assertEquals(findRateMethod(`${m.id}@${m.version + 1}`), undefined, "a bumped version fails loudly");
  }
});
