// The resolution chains, as a fact a page can render — WP 5.2c.
//
// ── WHY A BUNDLER STEP RATHER THAN A SECOND DERIVATION ────────────────────
//
// `src/lib/policies/resolutionChains.ts` DERIVES every grid field's chain from
// the contract, the engine registry and the engine sources — 38 of them, eleven
// of which break, each with a `file:line` per claim (§4 D90, D91). §6.3's
// policy pages have to show that, and the alternative to reading it is writing
// it down again: "~120 hand-written chains are true on the day they are typed",
// which is the sentence WP 6.1 opens with and the defect D21 and D22 are.
//
// So this module runs the REAL derivation. `resolutionChains.ts` is TypeScript
// and the generators are plain node ESM, so esbuild — already a dependency, and
// already how this repository turns TypeScript into something node runs —
// bundles it to a temporary module which is then imported and called with
// exactly the sources `resolutionChains.test.ts` passes. One derivation, two
// readers: the ratchet that fails when a chain breaks, and the manual that
// tells a user which of their cells changes a run.
//
// The result is written into `reference.generated.ts`'s neighbourhood by
// `generate.mjs`, so it is covered by the drift gate that already exists:
// `contract:generate -- --check` fails when the committed artifact and a fresh
// derivation disagree, and CI runs it on every pull request.

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";

/**
 * Bundle `resolutionChains.ts` and hand back its exports.
 *
 * Bundled rather than type-stripped: the module imports `./columnSpecs` and
 * `./stages` without file extensions, which node's own resolver refuses and a
 * bundler does not care about. Failing loudly matters here — a generator that
 * quietly produced an empty chain set would publish a policy section claiming
 * every field resolves.
 *
 * CommonJS, and therefore `require()`, so the whole derivation stays
 * SYNCHRONOUS: `generate.mjs` is a sync pipeline whose output feeds a drift
 * comparison, and turning it async to load one module would touch every caller
 * of `generate()` for no benefit the reader of this file can see.
 */
export function loadChainModule(root) {
  const dir = mkdtempSync(join(tmpdir(), "chains-"));
  const out = join(dir, "resolutionChains.cjs");
  const r = spawnSync(
    "npx",
    [
      "esbuild",
      join(root, "src", "lib", "policies", "resolutionChains.ts"),
      "--bundle",
      "--format=cjs",
      "--platform=node",
      "--log-level=error",
      `--outfile=${out}`,
    ],
    { cwd: root, encoding: "utf8", shell: process.platform === "win32" },
  );
  if (r.status !== 0) {
    rmSync(dir, { recursive: true, force: true });
    throw new Error(`chains: esbuild could not bundle resolutionChains.ts\n${r.stderr ?? ""}`);
  }
  return { file: out, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

/**
 * The sources the classifier reads.
 *
 * Identical to `resolutionChains.test.ts`'s, and that is not a coincidence to
 * be tidied away: §4 D91 is what happened when this list held `project_map.py`
 * alone — four fields were reported "read by nothing" while the frozen legacy
 * engine reads them, and one dead field passed as live. The list is the scan's
 * honesty, so the ratchet and the manual must be looking at the same tree or
 * the manual will publish a different answer from the one CI enforces.
 */
export function engineSources(root) {
  const read = (...p) => readFileSync(join(root, ...p), "utf8");
  const legacyEngine = Object.fromEntries(
    ["engine.py", "policies.py", "datamap.py", "worker.py", "scsim_bridge.py"].map((f) => [
      `sim-worker/sim_worker/${f}`,
      read("sim-worker", "sim_worker", f),
    ]),
  );
  const appSrc = Object.fromEntries(
    [
      ["src/hooks/useStageRows.tsx", ["src", "hooks", "useStageRows.tsx"]],
      ["src/components/policies/StagePolicyTable.tsx", ["src", "components", "policies", "StagePolicyTable.tsx"]],
      ["src/lib/policies/resolveEffective.ts", ["src", "lib", "policies", "resolveEffective.ts"]],
    ].map(([label, parts]) => [label, read(...parts)]),
  );
  return { projectMap: read("scsim", "scsim", "io", "project_map.py"), legacyEngine, appSrc };
}

const pick = ({ klass, evidence }) => ({ breakClass: klass, breakEvidence: evidence });

/** Derive every chain, plus the resolver's order. Synchronous by construction. */
export function deriveChains(root, contract, registry) {
  const { file, cleanup } = loadChainModule(root);
  try {
    const mod = createRequire(import.meta.url)(file);
    const chains = mod.allChains(contract, registry, engineSources(root));
    if (chains.length < 30) {
      // An empty or truncated derivation is the vacuous-gate shape (D57): a
      // policy section that claims every chain resolves because it found none.
      throw new Error(`chains: derived ${chains.length} chains; the grid has far more than that`);
    }
    // `Chain` carries the break SENTENCE and not the shape that produced it,
    // because the ratchet only needs the sentence. A page needs the shape: five
    // remedies, and "read only by the frozen engine" is a different message to
    // a user from "the engine recomputes this and ignores what you typed"
    // (§4 D91). So the classification is re-read here from the same function
    // the sentence came from, never re-derived by eye.
    const doors = mod.engineDoors(registry, engineSources(root));
    const classified = chains.map((c) =>
      c.breaks.length
        ? { ...c, ...pick(mod.classifyBreak(c.field, doors)) }
        : { ...c, breakClass: null, breakEvidence: [] },
    );
    return {
      chains: classified,
      order: mod.RESOLUTION_ORDER,
      orderSource: mod.RESOLUTION_ORDER_SOURCE,
    };
  } finally {
    cleanup();
  }
}

/**
 * The stress-test battery, read from the engine rather than mined from the
 * archive — WP 5.2d.
 *
 * ── WHY THIS IS A TEXT SCAN, AND WHY THAT IS SAID OUT LOUD ────────────────
 *
 * §6.6 lists "the ST-1…ST-7 stress-test descriptions" as narrative worth mining
 * from the archived manual. Mining is what produced §4 D22: a hand copy that
 * drifted from the engine within a quarter. The archived copy already carries
 * statuses the engine does not ("planned · M7" against seven entries), so the
 * copy was the wrong source before anybody read it.
 *
 * The right source is `registry_export.py`, which is the single source of truth
 * for what the engine declares (§3, blueprint §6.2) — and `ST_DEFINITIONS` is
 * NOT in it. Regenerating that export needs `pydantic` and a session that can
 * reach PyPI, which §4 D94 records as unavailable here.
 *
 * So this parses the Python dict literal directly. That is exactly the weakest
 * of §4 D90's three doors — "a quoted string in a Python file is the only
 * evidence" — and the page says so in its footer rather than presenting it as
 * generated from a contract. It is still strictly better than the alternative:
 * a scan goes red when the literal moves, and a mined copy goes quietly wrong.
 *
 * WHICH ONES RUN is derived, not read: a test is runnable when a function in
 * the same module calls `_run_battery(..., "ST-n", ...)`. The docstring claims
 * the same thing and a docstring is prose.
 */
export function deriveStressTests(root) {
  const src = readFileSync(join(root, "scsim", "scsim", "stress", "battery.py"), "utf8");
  const block = /ST_DEFINITIONS:\s*dict\[str,\s*str\]\s*=\s*\{([\s\S]*?)\n\}/.exec(src);
  if (!block) {
    throw new Error(
      "chains: ST_DEFINITIONS not found in scsim/scsim/stress/battery.py. The " +
        "literal has moved or been renamed — fix the scan rather than shipping " +
        "an empty stress-test page.",
    );
  }
  const tests = [];
  const entry = /"(ST-\d+)":\s*"((?:[^"\\]|\\.)*)"/g;
  let m;
  while ((m = entry.exec(block[1]))) {
    const id = m[1];
    // A call site, not a docstring: `_run_battery(scenario, "ST-1", cells)`.
    const runnable = new RegExp(`_run_battery\\([^)]*["']${id}["']`).test(src);
    // The engine author's ✅ shorthand for "this one is implemented" is
    // stripped, and only that: `runnable` above carries the same fact, derived
    // from a call site rather than from a glyph, so nothing is lost. It goes
    // because the mobile UI spec (§3.5) forbids emoji in product copy and this
    // string IS product copy the moment the manual renders it — the audit
    // flagged the generated module on the commit that first embedded it. The
    // mathematical marks in these descriptions (×, Δ, φ, ∩) stay: they are
    // functional notation, not decoration.
    const description = m[2].replace(/\\"/g, '"').replace(/\s*[\u{2705}\u{274C}\u{FE0F}]/gu, "");
    tests.push({ id, description, runnable });
  }
  if (tests.length < 5) {
    throw new Error(`chains: parsed ${tests.length} stress tests; the battery declares more than that`);
  }
  return tests;
}

/**
 * The public API's routes, read from the function that serves them — WP 5.2g.
 *
 * §6.3 marks "Endpoints & schemas" as **G**, generated from the contract. The
 * data contract does not describe the HTTP surface — it describes tables — so
 * the nearest thing to a declaration is the `routes` table inside
 * `supabase/functions/api/index.ts`, which is what the dispatcher itself reads.
 * Generating from it means a route added, removed or re-scoped changes the
 * manual with nobody editing a page, and an endpoint list that silently drifts
 * from the server is the exact defect §4 D21 and D22 are.
 *
 * It is a parse of a TypeScript literal, which is the same weak door
 * `deriveStressTests` uses, for the same reason: no stronger declaration
 * exists. The page's footer says so. A version prefix is not in the literal —
 * the dispatcher strips `/v1` before matching — so the prefix is added here,
 * once, next to the fact that it is added.
 */
export function deriveApiRoutes(root) {
  const src = readFileSync(join(root, "supabase", "functions", "api", "index.ts"), "utf8");
  const block = /const routes:\s*Route\[\]\s*=\s*\[([\s\S]*?)\n\];/.exec(src);
  if (!block) {
    throw new Error(
      "chains: the `routes` table was not found in supabase/functions/api/index.ts. " +
        "Fix the scan rather than shipping an endpoint list the server does not serve.",
    );
  }
  const row =
    /method:\s*"(\w+)",\s*pattern:\s*new RegExp\(`\^([^`]*)\$`\),\s*scope:\s*"([^"]+)",\s*handler:\s*(\w+)/g;
  const routes = [];
  let m;
  while ((m = row.exec(block[1]))) {
    routes.push({
      method: m[1],
      // `(${UUID})` is a capture group for an id. Rendered as `{id}`, which is
      // what a reader types, rather than as the regular expression the server
      // matches with.
      path: `/v1${m[2].replace(/\(\$\{UUID\}\)/g, "{id}")}`,
      scope: m[3],
      handler: m[4],
    });
  }
  if (routes.length < 10) {
    throw new Error(`chains: parsed ${routes.length} API routes; the dispatcher declares more`);
  }
  return routes;
}
