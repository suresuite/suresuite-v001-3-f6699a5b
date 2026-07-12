#!/usr/bin/env node
// End-to-end proof that the deployed simulation server works AND that data +
// policy transfer is faithful — run from CI (verify-sim-e2e.yml), using ONLY
// the app's own identity (the public anon key from the frontend source), so a
// green run here means the deployed app's exact path works:
//
//   sim-command (gate → queued row → Upstash) → Fly worker (scsim engine)
//   → simulation_runs / run_replications writes → Supabase Realtime → client.
//
// Asserts, on the user's REAL project:
//   1. anon can SELECT simulation_runs + run_replications (data plane)
//   2. dispatch → queued → running → done, code_version = scsim-*
//   3. per-replication rows land, count == rep_count_target
//   4. realtime postgres_changes events arrive for BOTH tables while the run
//      streams (proves supabase_realtime publication + anon grants together)
//   5. mapping_warnings is empty or info-only (data fidelity — nothing the
//      engine had to default silently)
//   6. the run's policy_hash equals the saved policy_versions.policy_hash
//      (policy fidelity — the exact saved configuration drove the run)
//   7. reuse-or-rerun (G17/§9.2 read-path): re-dispatching the identical run
//      answers 409 reuse_available naming the completed run — never a silent
//      recompute, never a silent skip
//   8. single-run inspection mode (G17/§9.5.1): a 1-rep run with
//      payload.inspection=true persists per-item weekly series to
//      run_item_series (materials: on_hand/in_transit/orders; products:
//      demand/production/fulfillment/backlog/lost_units), while the multi-rep
//      run persisted none
//   9. dataset export data (G17/W2): snapshot_dataset's canonical rows match
//      the committed reference dataset (scripts/tron_ver2/dataset.json) when
//      the project IS the TRON reference, and current_graph_hash agrees
//  10. (optional) experiment.cancel flips a second run to cancelled
//
// Env: PROJECT_ID (optional), REPLICATIONS (200), HORIZON_DAYS (365),
//      TEST_CANCEL (true), TEST_INSPECTION (true), TIMEOUT_MINUTES (40),
//      ALLOW_MAPPING_WARNINGS (false)

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

// Single source for URL + anon key: the frontend client itself.
const clientTs = readFileSync(
  join(repoRoot, "src/integrations/supabase/client.ts"),
  "utf8",
);
const SUPABASE_URL = clientTs.match(/SUPABASE_URL = "([^"]+)"/)?.[1];
const ANON_KEY = clientTs.match(/SUPABASE_PUBLISHABLE_KEY = "([^"]+)"/)?.[1];
if (!SUPABASE_URL || !ANON_KEY) {
  console.error("could not parse SUPABASE_URL / anon key from client.ts");
  process.exit(2);
}

const REPLICATIONS = Number(process.env.REPLICATIONS || 200);
const HORIZON_DAYS = Number(process.env.HORIZON_DAYS || 365);
const TEST_CANCEL = (process.env.TEST_CANCEL ?? "true") === "true";
const TEST_INSPECTION = (process.env.TEST_INSPECTION ?? "true") === "true";
const TIMEOUT_MS = Number(process.env.TIMEOUT_MINUTES || 40) * 60_000;
const ALLOW_WARN = (process.env.ALLOW_MAPPING_WARNINGS ?? "false") === "true";

const headers = {
  apikey: ANON_KEY,
  Authorization: `Bearer ${ANON_KEY}`,
  "Content-Type": "application/json",
};

const failures = [];
const pass = (msg) => console.log(`  ✓ ${msg}`);
const fail = (msg) => {
  console.error(`  ✗ ${msg}`);
  failures.push(msg);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function rest(path, init = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { ...headers, ...(init.headers ?? {}) },
  });
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: res.status, body };
}

async function simCommand(cmd) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/sim-command`, {
    method: "POST",
    headers,
    body: JSON.stringify({ ...cmd, client_ts: Date.now() }),
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

// ── 1. resolve the real project + its latest saved policy version ───────────
console.log("── resolving project & policy version");
let projectId = process.env.PROJECT_ID || null;
let version = null;
{
  const q = projectId ? `&project_id=eq.${projectId}` : "";
  const { status, body } = await rest(
    `policy_versions?select=id,project_id,policy_hash,label,created_at&order=created_at.desc&limit=1${q}`,
  );
  if (status !== 200 || !Array.isArray(body) || body.length === 0) {
    console.error(
      `no readable policy_versions row (HTTP ${status}) — save a policy version in the app first`,
    );
    process.exit(2);
  }
  version = body[0];
  projectId = version.project_id;
}
console.log(
  `  project ${projectId}\n  policy version ${version.id} (${version.label ?? "no label"})\n  policy_hash ${version.policy_hash}`,
);

// ── 2. data-plane preflight: anon SELECT on both run tables ─────────────────
// Retried for a few minutes: a migrations run triggered by the same push may
// still be applying, and PostgREST's schema cache can lag a fresh column.
console.log("── data-plane preflight (anon grants)");
{
  let runs = null;
  for (let attempt = 1; attempt <= 8; attempt++) {
    runs = await rest("simulation_runs?select=id,status,gate_skipped&limit=1");
    if (runs.status === 200) break;
    console.log(`  … attempt ${attempt}/8: HTTP ${runs.status} — waiting 30s for migrations/schema reload`);
    await sleep(30_000);
  }
  runs.status === 200
    ? pass("anon SELECT simulation_runs (incl. gate_skipped column)")
    : fail(`anon SELECT simulation_runs → HTTP ${runs.status}: ${JSON.stringify(runs.body)}`);
  const reps = await rest("run_replications?select=run_id,rep_index&limit=1");
  reps.status === 200
    ? pass("anon SELECT run_replications")
    : fail(`anon SELECT run_replications → HTTP ${reps.status}: ${JSON.stringify(reps.body)}`);
  if (failures.length) {
    console.error("data plane broken — apply supabase-migrations.yml first");
    process.exit(1);
  }
}

// ── 3. find-or-create the auto validation scenario (same as the UI) ─────────
console.log("── preparing scenario");
const SCENARIO_NAME = "Policy validation (auto)";
let scenarioId = null;
{
  const found = await rest(
    `scenarios?select=id&project_id=eq.${projectId}&name=eq.${encodeURIComponent(SCENARIO_NAME)}&limit=1`,
  );
  if (found.status === 200 && found.body.length > 0) {
    scenarioId = found.body[0].id;
  } else {
    const created = await rest("scenarios", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        project_id: projectId,
        name: SCENARIO_NAME,
        description: "",
        horizon_days: HORIZON_DAYS,
        replications: REPLICATIONS,
        seed: 1,
      }),
    });
    if (created.status !== 201) {
      console.error(`scenario create failed HTTP ${created.status}: ${JSON.stringify(created.body)}`);
      process.exit(1);
    }
    scenarioId = created.body[0].id;
  }
  const patched = await rest(`scenarios?id=eq.${scenarioId}`, {
    method: "PATCH",
    body: JSON.stringify({
      replications: REPLICATIONS,
      seed: 1,
      horizon_days: HORIZON_DAYS,
      primary_kpi: "fill_rate",
      disruption_schedule: [],
      recovery_overrides: {},
    }),
  });
  if (patched.status >= 300) {
    console.error(`scenario patch failed HTTP ${patched.status}: ${JSON.stringify(patched.body)}`);
    process.exit(1);
  }
  console.log(`  scenario ${scenarioId} → ${REPLICATIONS} reps × ${HORIZON_DAYS} days`);
}

// ── 4. realtime subscription — the exact same shape the UI uses ─────────────
console.log("── subscribing to realtime (same channels as the UI)");
const sb = createClient(SUPABASE_URL, ANON_KEY);
let runEvents = 0;
let repEvents = 0;
const channel = sb
  .channel(`verify:${scenarioId}`)
  .on(
    "postgres_changes",
    { event: "*", schema: "public", table: "simulation_runs", filter: `scenario_id=eq.${scenarioId}` },
    () => runEvents++,
  )
  .on(
    "postgres_changes",
    { event: "*", schema: "public", table: "run_replications" },
    () => repEvents++,
  );
const subscribed = await new Promise((resolve) => {
  const timer = setTimeout(() => resolve(false), 15_000);
  channel.subscribe((status) => {
    if (status === "SUBSCRIBED") {
      clearTimeout(timer);
      resolve(true);
    }
  });
});
subscribed ? pass("realtime channel SUBSCRIBED") : fail("realtime channel did not reach SUBSCRIBED in 15s");

// ── 5. dispatch the run ──────────────────────────────────────────────────────
console.log("── dispatching experiment.run via sim-command");
const t0 = Date.now();
const dispatch = await simCommand({
  project_id: projectId,
  scenario_id: scenarioId,
  kind: "experiment.run",
  payload: { policy_version_id: version.id, acknowledge_warnings: true },
});
if (dispatch.status === 422) {
  console.error(
    `required-data gate rejected the run (${dispatch.body?.validation}):\n` +
      (dispatch.body?.findings ?? []).map((f) => `    [${f.severity}] ${f.message}`).join("\n"),
  );
  process.exit(1);
}
if (dispatch.status !== 202 || !dispatch.body?.run_id) {
  console.error(`dispatch failed HTTP ${dispatch.status}: ${JSON.stringify(dispatch.body)}`);
  process.exit(1);
}
const runId = dispatch.body.run_id;
pass(`dispatched → run ${runId}`);

// ── 6. poll to terminal state, recording status transitions ─────────────────
console.log("── waiting for the worker (status transitions below)");
const seen = new Set();
let run = null;
while (Date.now() - t0 < TIMEOUT_MS) {
  const { status, body } = await rest(
    `simulation_runs?select=*&id=eq.${runId}&limit=1`,
  );
  if (status === 200 && body.length === 1) {
    run = body[0];
    if (!seen.has(run.status)) {
      seen.add(run.status);
      console.log(
        `  [${((Date.now() - t0) / 1000).toFixed(0)}s] status=${run.status} reps ${run.rep_count_done}/${run.rep_count_target} (realtime: ${runEvents} run / ${repEvents} rep events)`,
      );
    }
    if (["done", "failed", "cancelled"].includes(run.status)) break;
  }
  await sleep(5000);
}

// ── 7. assertions ────────────────────────────────────────────────────────────
console.log("── assertions");
if (!run) {
  fail("run row never became readable");
} else {
  run.status === "done"
    ? pass(`run finished: done in ${((Date.now() - t0) / 1000).toFixed(0)}s`)
    : fail(`run ended as '${run.status}' (${run.error_message ?? "no error message"}) — queued-forever means the worker isn't consuming`);
}
if (run?.status === "done") {
  const cv = run.code_version ?? "";
  cv.startsWith("scsim-")
    ? pass(`code_version ${cv} (scsim engine, not legacy/stub)`)
    : fail(`code_version '${cv}' — expected scsim-*`);

  // Optional exact-version pin: proves the worker runs the engine at THIS
  // ref (a stale worker silently ignores newly added mapping fields).
  const expected = process.env.EXPECTED_CODE_VERSION || "";
  if (expected) {
    cv === expected
      ? pass(`code_version matches this ref (${expected})`)
      : fail(`code_version ${cv} != expected ${expected} — worker not redeployed with this engine`);
  }

  run.rep_count_done === REPLICATIONS
    ? pass(`rep_count_done ${run.rep_count_done} == requested ${REPLICATIONS}`)
    : fail(`rep_count_done ${run.rep_count_done} != requested ${REPLICATIONS}`);

  const reps = await rest(
    `run_replications?select=rep_index&run_id=eq.${runId}&order=rep_index.asc`,
  );
  const n = Array.isArray(reps.body) ? reps.body.length : 0;
  n === REPLICATIONS
    ? pass(`run_replications rows ${n} == ${REPLICATIONS}`)
    : fail(`run_replications rows ${n} != ${REPLICATIONS}`);

  const aggKeys = Object.keys(run.aggregate_kpis ?? {});
  const ciKeys = Object.keys(run.ci_half_widths ?? {});
  aggKeys.length > 0 && ciKeys.length > 0
    ? pass(`aggregate KPIs (${aggKeys.length}) + CI half-widths (${ciKeys.length}) present`)
    : fail("aggregate_kpis / ci_half_widths missing");

  // fidelity: mapping warnings — every field the engine defaulted/derived
  const mw = run.mapping_warnings ?? [];
  console.log(`  engine mapping report: ${mw.length} entr${mw.length === 1 ? "y" : "ies"}`);
  for (const w of mw) console.log(`    [${w.level}] ${w.entity}.${w.field}: ${w.reason}`);
  const bad = mw.filter((w) => w.level === "warn" || w.level === "error");
  if (bad.length === 0) {
    pass("mapping_warnings empty / info-only — project data transferred with no silent defaulting");
  } else if (ALLOW_WARN) {
    console.log(`  ! ${bad.length} warn/error mapping entr(ies) allowed by ALLOW_MAPPING_WARNINGS`);
  } else {
    fail(`${bad.length} warn/error mapping entr(ies) — data did NOT fully transfer (see report above)`);
  }

  // fidelity: policy hash round-trip
  run.policy_hash === version.policy_hash
    ? pass(`policy_hash round-trip: run ${run.policy_hash.slice(0, 12)}… == saved version`)
    : fail(`policy_hash mismatch: run ${run.policy_hash} != version ${version.policy_hash}`);

  run.gate_skipped
    ? fail("gate_skipped=true — the §8.1 gate could not grade this dispatch")
    : pass("required-data gate graded the dispatch (gate_skipped=false)");
}

// ── 7b. reuse-or-rerun (G17 — the §9.2 run-cache read path) ─────────────────
// The scenario row is untouched since the main dispatch, so re-dispatching
// the identical (policy, dataset, scenario, seed spec) run must answer 409
// reuse_available naming the completed run — and force_rerun must bypass it.
if (run?.status === "done") {
  console.log("── reuse-or-rerun check (repeat dispatch of the identical run)");
  const again = await simCommand({
    project_id: projectId,
    scenario_id: scenarioId,
    kind: "experiment.run",
    payload: { policy_version_id: version.id, acknowledge_warnings: true },
  });
  if (again.status === 409 && again.body?.reuse_available) {
    pass("repeat dispatch → 409 reuse_available (no silent recompute)");
    const cand = again.body?.reuse_candidate ?? {};
    cand.run_id === runId
      ? pass(`reuse candidate is the completed run (${String(cand.run_id).slice(0, 8)}…, ${cand.rep_count_done} reps, ${cand.code_version})`)
      : fail(`reuse candidate ${cand.run_id} != completed run ${runId}`);
  } else {
    fail(`repeat dispatch → HTTP ${again.status} (expected 409 reuse_available): ${JSON.stringify(again.body).slice(0, 200)}`);
    // A 202 dispatched a redundant run — cancel it so it doesn't burn compute.
    if (again.status === 202 && again.body?.run_id) {
      await simCommand({ project_id: projectId, kind: "experiment.cancel", payload: { run_id: again.body.run_id } });
    }
  }
}

// ── 7c. single-run inspection mode (G17/§9.5.1 — per-item weekly series) ────
if (TEST_INSPECTION && run?.status === "done") {
  console.log("── single-run inspection mode (1 rep, payload.inspection=true)");
  // The multi-rep run must have persisted NO per-item rows.
  const multiItems = await rest(`run_item_series?select=item_id&run_id=eq.${runId}&limit=1`);
  if (multiItems.status !== 200) {
    fail(`anon SELECT run_item_series → HTTP ${multiItems.status} (migration 20260720000001 applied?)`);
  } else {
    (multiItems.body ?? []).length === 0
      ? pass("multi-rep run persisted no run_item_series rows (single-rep evidence only)")
      : fail("multi-rep run unexpectedly persisted run_item_series rows");
  }

  const INSPECTION_SEED = 7;
  const patched = await rest(`scenarios?id=eq.${scenarioId}`, {
    method: "PATCH",
    body: JSON.stringify({ replications: 1, seed: INSPECTION_SEED }),
  });
  if (patched.status >= 300) {
    fail(`inspection scenario patch failed HTTP ${patched.status}`);
  } else {
    const d3 = await simCommand({
      project_id: projectId,
      scenario_id: scenarioId,
      kind: "experiment.run",
      payload: { policy_version_id: version.id, acknowledge_warnings: true, inspection: true },
    });
    if (d3.status !== 202 || !d3.body?.run_id) {
      fail(`inspection dispatch failed HTTP ${d3.status}: ${JSON.stringify(d3.body).slice(0, 200)}`);
    } else {
      const inspRunId = d3.body.run_id;
      pass(`inspection run dispatched → ${inspRunId}`);
      let insp = null;
      const tIns = Date.now();
      while (Date.now() - tIns < 10 * 60_000) {
        const { status, body } = await rest(`simulation_runs?select=*&id=eq.${inspRunId}&limit=1`);
        if (status === 200 && body.length === 1) {
          insp = body[0];
          if (["done", "failed", "cancelled"].includes(insp.status)) break;
        }
        await sleep(5000);
      }
      if (insp?.status !== "done") {
        fail(`inspection run ended as '${insp?.status ?? "unknown"}' (${insp?.error_message ?? "no error"})`);
      } else {
        pass(`inspection run done in ${((Date.now() - tIns) / 1000).toFixed(0)}s (1 replication, seed ${INSPECTION_SEED})`);
        const idx = await rest(`run_item_series?select=kind,item_id&run_id=eq.${inspRunId}&order=item_id`);
        const items = Array.isArray(idx.body) ? idx.body : [];
        const mats = items.filter((i) => i.kind === "material");
        const prods = items.filter((i) => i.kind === "product");
        mats.length > 0 && prods.length > 0
          ? pass(`run_item_series persisted: ${prods.length} product(s) + ${mats.length} material(s)`)
          : fail(`run_item_series rows missing (materials ${mats.length}, products ${prods.length})`);
        const horizonWeeks = Math.min(520, Math.max(52, Math.round(HORIZON_DAYS / 7)));
        if (mats.length > 0) {
          const one = await rest(
            `run_item_series?select=series&run_id=eq.${inspRunId}&kind=eq.material&item_id=eq.${encodeURIComponent(mats[0].item_id)}&limit=1`,
          );
          const series = one.body?.[0]?.series ?? {};
          const keys = Object.keys(series).sort().join(",");
          keys === "in_transit,on_hand,orders"
            ? pass(`material series keys: ${keys}`)
            : fail(`material series keys '${keys}' != in_transit,on_hand,orders`);
          const len = Array.isArray(series.on_hand) ? series.on_hand.length : 0;
          len === horizonWeeks
            ? pass(`material weekly series length ${len} == horizon ${horizonWeeks} weeks`)
            : fail(`material weekly series length ${len} != horizon ${horizonWeeks}`);
        }
        if (prods.length > 0) {
          const one = await rest(
            `run_item_series?select=series&run_id=eq.${inspRunId}&kind=eq.product&item_id=eq.${encodeURIComponent(prods[0].item_id)}&limit=1`,
          );
          const series = one.body?.[0]?.series ?? {};
          const keys = Object.keys(series).sort().join(",");
          keys === "backlog,demand,fulfillment,lost_units,production"
            ? pass(`product series keys: ${keys}`)
            : fail(`product series keys '${keys}' != backlog,demand,fulfillment,lost_units,production`);
        }
      }
    }
    // Leave the scenario as the baseline expects it.
    await rest(`scenarios?id=eq.${scenarioId}`, {
      method: "PATCH",
      body: JSON.stringify({ replications: REPLICATIONS, seed: 1 }),
    });
  }
}

// ── 7d. dataset snapshot vs the committed reference (G17/W2) ────────────────
console.log("── dataset snapshot (verifiable-export source) check");
{
  const snapId = await rest("rpc/snapshot_dataset", {
    method: "POST",
    body: JSON.stringify({ p_project_id: projectId }),
  });
  if (snapId.status >= 300 || !snapId.body) {
    fail(`snapshot_dataset RPC failed HTTP ${snapId.status}`);
  } else {
    const ver = await rest(
      `dataset_versions?select=id,graph_hash,snapshot&id=eq.${snapId.body}&limit=1`,
    );
    const row = ver.body?.[0];
    if (!row?.snapshot) {
      fail(`dataset_versions snapshot not readable (HTTP ${ver.status})`);
    } else {
      const cur = await rest("rpc/current_graph_hash", {
        method: "POST",
        body: JSON.stringify({ p_project_id: projectId }),
      });
      cur.body === row.graph_hash
        ? pass(`current_graph_hash matches the snapshot (${String(row.graph_hash).slice(0, 12)}…)`)
        : fail(`current_graph_hash ${cur.body} != snapshot graph_hash ${row.graph_hash}`);

      // When this project IS the committed TRON reference, the canonical rows
      // must match it — the dataset export is verifiable outside the app.
      try {
        const refDs = JSON.parse(
          readFileSync(join(repoRoot, "scripts/tron_ver2/dataset.json"), "utf8"),
        );
        const snapProdIds = new Set((row.snapshot.products ?? []).map((p) => p.product_id));
        const refProdIds = new Set(refDs.products.map((p) => p.product_id));
        const isTron =
          snapProdIds.size === refProdIds.size &&
          [...refProdIds].every((id) => snapProdIds.has(id));
        if (isTron) {
          const counts = [
            ["suppliers", refDs.suppliers.length],
            ["materials", refDs.materials.length],
            ["products", refDs.products.length],
            ["inbound", refDs.inbound.length],
            ["bom", refDs.bom.length],
            ["outbound", refDs.outbound.length],
          ];
          for (const [key, expectN] of counts) {
            const n = (row.snapshot[key] ?? []).length;
            n === expectN
              ? pass(`snapshot ${key}: ${n} rows == committed dataset.json`)
              : fail(`snapshot ${key}: ${n} rows != committed ${expectN}`);
          }
          // Spot-check one economics value survives the round trip exactly.
          const refMat = refDs.materials.find((m) => m.cost != null);
          const snapMat = (row.snapshot.materials ?? []).find(
            (m) => m.material_id === refMat.material_id,
          );
          snapMat && Number(snapMat.cost) === Number(refMat.cost)
            ? pass(`spot check: material ${refMat.material_id} cost ${refMat.cost} matches`)
            : fail(`spot check: material ${refMat?.material_id} cost ${snapMat?.cost} != ${refMat?.cost}`);
        } else {
          console.log("  (project is not the TRON reference — skipping row-level comparison)");
        }
      } catch (e) {
        console.log(`  (reference comparison skipped: ${e.message})`);
      }
    }
  }
}

// realtime proof (worker writes streamed while we watched)
runEvents > 0
  ? pass(`realtime delivered ${runEvents} simulation_runs event(s)`)
  : fail("no realtime events for simulation_runs — publication or anon SELECT missing");
repEvents > 0
  ? pass(`realtime delivered ${repEvents} run_replications event(s)`)
  : fail("no realtime events for run_replications — publication or anon SELECT missing");

// ── 8. cancel round-trip (optional) ─────────────────────────────────────────
if (TEST_CANCEL && run?.status === "done") {
  console.log("── cancel round-trip");
  // force_rerun: this is deliberately an identical dispatch — without the
  // flag the §9.2 reuse check would answer 409 instead of queueing.
  const d2 = await simCommand({
    project_id: projectId,
    scenario_id: scenarioId,
    kind: "experiment.run",
    payload: { policy_version_id: version.id, acknowledge_warnings: true, force_rerun: true },
  });
  if (d2.status !== 202 || !d2.body?.run_id) {
    fail(`cancel-test dispatch failed HTTP ${d2.status}`);
  } else {
    const rid2 = d2.body.run_id;
    await sleep(4000); // let it reach the worker
    const c = await simCommand({
      project_id: projectId,
      kind: "experiment.cancel",
      payload: { run_id: rid2 },
    });
    if (c.status !== 202) fail(`experiment.cancel HTTP ${c.status}`);
    let r2 = null;
    const tCancel = Date.now();
    while (Date.now() - tCancel < 120_000) {
      const { body } = await rest(`simulation_runs?select=status&id=eq.${rid2}&limit=1`);
      r2 = body?.[0]?.status ?? null;
      if (r2 === "cancelled" || r2 === "done" || r2 === "failed") break;
      await sleep(4000);
    }
    r2 === "cancelled"
      ? pass(`second run ${rid2} → cancelled`)
      : fail(`cancel test: run ended as '${r2}' (a fast run may finish before the cancel lands)`);
  }
}

await sb.removeChannel(channel);

console.log("\n════════ verification summary ════════");
if (failures.length === 0) {
  console.log(`ALL CHECKS PASSED — ${REPLICATIONS} reps × ${HORIZON_DAYS} days, server-side, streamed over realtime.`);
  process.exit(0);
}
console.error(`${failures.length} FAILURE(S):`);
for (const f of failures) console.error(`  ✗ ${f}`);
process.exit(1);
