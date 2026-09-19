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

/**
 * The seven stress-test presets a user can actually click — WP 5.2j, §4 D111.
 *
 * `deriveStressTests` above reads `scsim/scsim/stress/battery.py`, which is a
 * Python LIBRARY API: `run_st1`/`run_st2` are imported by the engine's own test
 * and by `scsim/__init__.py`, and by nothing in `src/`, `sim-worker/` or
 * `supabase/functions/`. It is a real artifact and it is not a product feature,
 * which is the whole of §4 D111.
 *
 * What the product offers is this literal — `STRESS_TESTS` in
 * `src/components/sim/StressTestCard.tsx`, rendered by `StressTestDrawer` on
 * Simulation Lab (desktop and mobile) and launched by `SimulationLab`'s
 * `launchStress`, which creates a scenario carrying the preset's
 * `disruption_schedule`. The schedule IS the description, so it is rendered
 * rather than summarised.
 *
 * ── AND WHETHER A PRESET REACHES THE ENGINE IS DERIVED, NOT ASSUMED ───────
 *
 * A scenario's `disruption_schedule` reaches scsim through
 * `scsim/scsim/io/project_map.py`'s `_map_events`, which resolves each entry's
 * `target` against the project's own supplier ids or the focal plant and SKIPS
 * everything else with a mapping warning. The presets ship fixed placeholder
 * targets — `supplier:primary`, `material:critical`, `customer:all` — that no
 * real project's ids match, so most of them map to nothing.
 *
 * That fact cannot be read out of either file on its own: it is what the two
 * say TOGETHER. So the mapper's rule is restated here — the same shape as
 * `ingest_normalize_at_promotion()` restating a normalization SQL cannot
 * import — and `assertMapperUnchanged` pins it to the exact predicate and skip
 * branch it mirrors. If either moves, this throws instead of publishing a
 * classification the engine no longer performs.
 */
const MAPPER_ANCHORS = [
  // `_is_plant_target` — the only target class the mapper accepts by name.
  `return raw.lower().startswith("plant:") or stripped.lower() == "plant"`,
  // The strip: everything before the last colon is discarded.
  `target = raw.rsplit(":", 1)[1] if ":" in raw else raw`,
  // The skip branch, and the warning the user sees when it fires.
  `if target not in sup_ids and not is_plant:`,
  `"unsupported target skipped (material/edge land later in M7)"`,
  // The cap: events beyond the fifth are dropped with a warning.
  `for entry in schedule[:5]:`,
  // Partial magnitudes become a capacity cut; a full one does not.
  `if magnitude < 100.0:`,
];

function assertMapperUnchanged(root) {
  const src = readFileSync(join(root, "scsim", "scsim", "io", "project_map.py"), "utf8");
  for (const anchor of MAPPER_ANCHORS) {
    if (!src.includes(anchor)) {
      throw new Error(
        "chains: scsim's `_map_events` no longer contains\n  " + anchor + "\n" +
          "The stress-preset classification in this file mirrors that rule. Re-read " +
          "the mapper and update both, rather than publishing a page that says a " +
          "preset reaches the engine when it may no longer.",
      );
    }
  }
  return src;
}

/**
 * Apply the mapper's rule to one preset target.
 *
 *   `plant`       — `_is_plant_target` accepts it; it always reaches the engine
 *   `supplier-id` — accepted only if the project has a supplier with this id
 *   `unsupported` — skipped with a mapping warning, on every project
 *
 * The third class is the one the manual has to say out loud, and the second is
 * the one it must not overstate: `supplier:primary` resolves for a project
 * whose supplier really is called `primary`, and for no other.
 */
function classifyTarget(raw) {
  const stripped = raw.includes(":") ? raw.slice(raw.lastIndexOf(":") + 1) : raw;
  if (raw.toLowerCase().startsWith("plant:") || stripped.toLowerCase() === "plant") return "plant";
  // The mapper's remaining door is `target in sup_ids`. A preset target that
  // names a node, material, customer or edge cannot pass it whatever the
  // project holds, because the prefix is stripped before the comparison and
  // what is left is a placeholder word.
  const prefix = raw.includes(":") ? raw.slice(0, raw.lastIndexOf(":")) : "";
  if (prefix === "supplier") return "supplier-id";
  return "unsupported";
}

export function deriveStressPresets(root) {
  assertMapperUnchanged(root);
  const src = readFileSync(join(root, "src", "components", "sim", "StressTestCard.tsx"), "utf8");
  const block = /export const STRESS_TESTS:\s*StressTest\[\]\s*=\s*\[([\s\S]*?)\n\];/.exec(src);
  if (!block) {
    throw new Error(
      "chains: `STRESS_TESTS` was not found in src/components/sim/StressTestCard.tsx. " +
        "Fix the scan rather than shipping a page that documents presets the drawer " +
        "does not offer.",
    );
  }
  const entry =
    /id:\s*"([^"]+)",\s*label:\s*"([^"]+)",\s*scenario:\s*\{\s*name:\s*"([^"]+)",\s*description:\s*"((?:[^"\\]|\\.)*)",\s*disruption_schedule:\s*\[([\s\S]*?)\],\s*\},/g;
  const event =
    /\{\s*target:\s*"([^"]+)",\s*target_type:\s*"([^"]+)",\s*start_day:\s*(-?\d+),\s*duration_days:\s*(-?\d+),\s*magnitude_pct:\s*(-?\d+)\s*\}/g;
  const presets = [];
  let m;
  while ((m = entry.exec(block[1]))) {
    const events = [];
    event.lastIndex = 0;
    let e;
    while ((e = event.exec(m[5]))) {
      events.push({
        target: e[1],
        targetType: e[2],
        startDay: Number(e[3]),
        durationDays: Number(e[4]),
        magnitudePct: Number(e[5]),
        resolves: classifyTarget(e[1]),
      });
    }
    if (events.length === 0) {
      throw new Error(`chains: preset "${m[1]}" parsed with no disruption events`);
    }
    presets.push({
      id: m[1],
      label: m[2],
      // The scenario the click creates is named this, so a reader can find it
      // in their own scenario list.
      scenarioName: m[3],
      description: m[4].replace(/\\"/g, '"'),
      events,
      // A preset reaches the engine when at least one of its events does, on
      // every project. `supplier-id` is deliberately NOT counted: it reaches
      // the engine only on a project whose supplier is called `primary`.
      reachesEngine: events.some((x) => x.resolves === "plant"),
    });
  }
  if (presets.length < 5) {
    throw new Error(`chains: parsed ${presets.length} stress presets; the drawer offers more`);
  }
  return presets;
}

/**
 * The files the product ships and the manual never pointed at — WP 5.2j, §4 D110.
 *
 * `UploadWizard.tsx`'s `templateTypes` pairs every dataset the wizard offers
 * with the template a user downloads and the guide it links. That pairing is
 * DECLARED, so the manual's links derive from it and a template renamed in the
 * wizard cannot leave a dead link on a documentation page — which is the whole
 * reason this is a generator's job and not a typist's.
 *
 * Two facts the derivation carries that no page stated before it existed:
 * `node_list` has `templateFile: ''` — deliberately no template, because the
 * user works from data they downloaded — and `deep_tier_json` offers a `.json`
 * file rather than a CSV.
 *
 * `docsAssets.test.ts` asserts every path here resolves to a file that exists
 * under `public/`. A 404 from a documentation page is worse than no link.
 */
export function deriveUploadAssets(root) {
  const src = readFileSync(join(root, "src", "components", "UploadWizard.tsx"), "utf8");
  const block = /const templateTypes:\s*TemplateType\[\]\s*=\s*\[([\s\S]*?)\n\s{2}\];/.exec(src);
  if (!block) {
    throw new Error(
      "chains: `templateTypes` was not found in src/components/UploadWizard.tsx. " +
        "Fix the scan rather than shipping table pages with no template link.",
    );
  }
  const entry =
    /id:\s*'([^']+)',\s*name:\s*'([^']+)',\s*description:\s*'((?:[^'\\]|\\.)*)',\s*templateFile:\s*'([^']*)',\s*(?:\/\/[^\n]*\n\s*)?guideFile:\s*'([^']*)'/g;
  const datasets = [];
  let m;
  while ((m = entry.exec(block[1]))) {
    datasets.push({
      id: m[1],
      name: m[2],
      description: m[3].replace(/\\'/g, "'"),
      // '' is a declaration, not a gap: node_list deliberately ships no
      // template. Rendered as null so a page branches on it rather than
      // emitting href="".
      templateFile: m[4] || null,
      guideFile: m[5] || null,
    });
  }
  // D57's vacuity rule: a scan that silently matched nothing would publish a
  // manual with every template link quietly missing and no gate red.
  if (datasets.length < 10) {
    throw new Error(
      `chains: parsed ${datasets.length} wizard datasets; templateTypes declares fourteen. ` +
        "The literal's shape has changed — fix the scan.",
    );
  }
  return datasets;
}

/**
 * The Colab notebook `/developer` offers, and the one page that should link it.
 *
 * Read from `DeveloperApi.tsx` rather than from the folder listing: a file in
 * `public/notebooks/` that the product does not offer is not something the
 * manual should send a reader to, and the href is what proves it is offered.
 */
export function deriveApiNotebook(root) {
  const src = readFileSync(join(root, "src", "pages", "DeveloperApi.tsx"), "utf8");
  const m = /["'`](\/notebooks\/[A-Za-z0-9._-]+\.ipynb)["'`]/.exec(src);
  if (!m) {
    throw new Error(
      "chains: no /notebooks/*.ipynb href in src/pages/DeveloperApi.tsx. Either the " +
        "notebook is no longer offered — in which case the manual must stop linking " +
        "it — or the scan needs fixing.",
    );
  }
  return m[1];
}

/**
 * The public API's error catalog and its default limits — WP 5.2j.
 *
 * §6.3 marks section 14 **G**. `deriveApiRoutes` gives the routes; a client
 * author also needs to know what can come back and how much they may ask for,
 * and both are declared in the same dispatcher: every failure is an `ApiError`
 * constructed with a status and a stable machine code, and the per-environment
 * ceilings are one literal.
 *
 * Read rather than written for the reason §4 D21 and D22 name: an error a
 * client branches on is exactly the kind of fact that gets renamed in the
 * server and left standing in the manual. A code the dispatcher stopped
 * throwing disappears from this page on the next regenerate.
 *
 * Grouped by code rather than listed per throw site: `read_failed` is raised
 * from nine places with nine messages, and a reader branching on the code cares
 * that it exists and what it means, not how many `.select()` calls can produce
 * it.
 */
export function deriveApiErrors(root) {
  const src = readFileSync(join(root, "supabase", "functions", "api", "index.ts"), "utf8");
  // Two construction sites, because the dispatcher has two. Most failures are
  // `new ApiError(status, "code", "message")`; every 401 goes through a local
  // `fail("code", "message")` that adds the key-guessing throttle first, and a
  // scan that saw only the first form would publish an API with no
  // authentication errors at all.
  const thrown =
    /(?:new ApiError\(\s*(\d{3})|(fail)\()\s*,?\s*"([a-z0-9_]+)",\s*(?:"((?:[^"\\]|\\.)*)"|`((?:[^`\\]|\\.)*)`)/g;
  const byCode = new Map();
  let m;
  while ((m = thrown.exec(src))) {
    const status = m[2] === "fail" ? 401 : Number(m[1]);
    const code = m[3];
    // A template literal's `${...}` is a runtime value; the shape is what a
    // reader needs, so the placeholder is kept rather than guessed at.
    const message = (m[4] ?? m[5] ?? "").replace(/\\"/g, '"').replace(/\\`/g, "`");
    const seen = byCode.get(code);
    if (seen) {
      seen.sites += 1;
      continue;
    }
    byCode.set(code, { code, status, message, sites: 1 });
  }
  const errors = [...byCode.values()].sort((a, b) => a.status - b.status || a.code.localeCompare(b.code));
  if (errors.length < 20) {
    throw new Error(`chains: parsed ${errors.length} API error codes; the dispatcher throws more`);
  }
  if (!errors.some((e) => e.status === 401)) {
    throw new Error(
      "chains: no 401 in the API error catalog. Every request that fails authentication " +
        "produces one, so the scan has stopped seeing the `fail()` form.",
    );
  }
  return errors;
}

export function deriveApiLimits(root) {
  const src = readFileSync(join(root, "supabase", "functions", "api", "index.ts"), "utf8");
  const block = /const DEFAULT_LIMITS = \{([\s\S]*?)\n\} as const;/.exec(src);
  if (!block) {
    throw new Error(
      "chains: DEFAULT_LIMITS was not found in supabase/functions/api/index.ts. Fix the " +
        "scan rather than publishing a rate limit the server does not enforce.",
    );
  }
  const row = /(\w+):\s*\{\s*rpm:\s*(\d+),\s*rpd:\s*(\d+),\s*max_concurrent_runs:\s*(\d+)\s*\}/g;
  const envs = [];
  let m;
  while ((m = row.exec(block[1]))) {
    envs.push({ env: m[1], rpm: Number(m[2]), rpd: Number(m[3]), maxConcurrentRuns: Number(m[4]) });
  }
  if (envs.length < 2) {
    throw new Error(`chains: parsed ${envs.length} key environments; the dispatcher declares two`);
  }
  const scalar = (name, re) => {
    const s = re.exec(src);
    if (!s) throw new Error(`chains: ${name} not found in the public API dispatcher`);
    return s;
  };
  const body = scalar("MAX_BODY_BYTES", /const MAX_BODY_BYTES = (\d+) \* (\d+);/);
  const ttl = scalar("IDEMPOTENCY_TTL_MS", /const IDEMPOTENCY_TTL_MS = (\d+) \* (\d+) \* (\d+) \* (\d+);/);
  const authThrottle = scalar("IP_401_LIMIT_PER_MIN", /const IP_401_LIMIT_PER_MIN = (\d+);/);
  const page = scalar("page size", /Math\.max\(1,\s*Math\.min\((\d+),\s*Number\.isFinite\(rawLimit\)\s*\?\s*Math\.floor\(rawLimit\)\s*:\s*(\d+)\)\)/);
  return {
    envs,
    maxBodyKb: (Number(body[1]) * Number(body[2])) / 1024,
    idempotencyTtlHours:
      (Number(ttl[1]) * Number(ttl[2]) * Number(ttl[3]) * Number(ttl[4])) / (60 * 60 * 1000),
    failedAuthsPerMinutePerIp: Number(authThrottle[1]),
    maxPageSize: Number(page[1]),
    defaultPageSize: Number(page[2]),
  };
}

/**
 * The per-item weekly series an inspection run produces — WP 5.2j.
 *
 * `run_item_series` is deferred in `coverage.yaml`, so the contract describes
 * none of this and the manual had nothing to render: the page named zero of the
 * measures a reader sees on the chart. They are declared twice and neither copy
 * is the whole fact, so both are read and joined here.
 *
 *   · `scsim/scsim/core/engine.py` says WHICH ITEM KIND each measure belongs to
 *     — its keys are `material.on_hand`, `product.backlog` and so on, and that
 *     prefix is the reason a material shows three lines and a product five.
 *   · `ItemSeriesExplorer.tsx`'s `SERIES_LABEL` says what the READER sees in the
 *     legend, which is the name §6.1 rule 1 says must lead.
 *
 * A measure the engine writes with no label, or a label for a measure the
 * engine does not write, throws: the first renders as a raw key on the chart and
 * the second is a legend entry for a line that never appears, and both are
 * things nobody would notice from either file alone.
 */
export function deriveItemSeries(root) {
  const engine = readFileSync(join(root, "scsim", "scsim", "core", "engine.py"), "utf8");
  const block = /item_series = \{([\s\S]*?)\n\s{8}\}/.exec(engine);
  if (!block) {
    throw new Error(
      "chains: the `item_series` dict was not found in scsim/scsim/core/engine.py. " +
        "Fix the scan rather than shipping a page that names no measure at all, " +
        "which is what the page did before this existed.",
    );
  }
  const pairs = [];
  const row = /"(material|product)\.(\w+)":/g;
  let m;
  while ((m = row.exec(block[1]))) pairs.push({ kind: m[1], key: m[2] });

  const ui = readFileSync(join(root, "src", "components", "sim", "ItemSeriesExplorer.tsx"), "utf8");
  const labelBlock = /const SERIES_LABEL: Record<string, string> = \{([\s\S]*?)\n\};/.exec(ui);
  if (!labelBlock) {
    throw new Error("chains: `SERIES_LABEL` was not found in src/components/sim/ItemSeriesExplorer.tsx");
  }
  const labels = new Map();
  const lrow = /(\w+):\s*"([^"]+)"/g;
  while ((m = lrow.exec(labelBlock[1]))) labels.set(m[1], m[2]);

  const series = pairs.map(({ kind, key }) => {
    const label = labels.get(key);
    if (!label) {
      throw new Error(
        `chains: the engine writes "${kind}.${key}" and ItemSeriesExplorer has no label for it. ` +
          "It renders on the chart as a raw key — add the label rather than documenting one.",
      );
    }
    return { kind, key, label };
  });
  const written = new Set(series.map((s) => s.key));
  for (const key of labels.keys()) {
    if (!written.has(key)) {
      throw new Error(
        `chains: ItemSeriesExplorer labels "${key}" and the engine never writes it — a legend ` +
          "entry for a line that cannot appear. Remove the label or fix the scan.",
      );
    }
  }
  if (series.length < 5) {
    throw new Error(`chains: parsed ${series.length} item series; the engine writes more`);
  }
  return series;
}

/**
 * What a replication row actually carries, against what the results table looks
 * for — WP 5.2j.
 *
 * §6.3 marks "Reading your results" **G\***, generated from the engine registry,
 * and the KPI page does render the engine's own dictionary. The results SCREEN
 * does not read that dictionary: `KpiStatTable` maps over `KPI_DISPLAY` in
 * `src/lib/sim/kpiDisplay.ts` and looks each key up on the replication rows, so
 * a measure the engine emits under a different name simply never gets a row.
 *
 * That is §4 D21 at the results layer — one quantity, two names, and the name
 * the screen uses is not the name the engine writes. It cannot be seen from
 * either file: `kpiDisplay.ts` is a plausible list of supply-chain measures and
 * `compute.py` is a plausible set of engine outputs. Only the JOIN shows that
 * two of thirteen display rows can ever appear.
 *
 * So the join is computed here and the page renders it. If somebody aligns the
 * two lists, the page says so on the next regenerate without being edited.
 */
export function deriveRunKpis(root) {
  const compute = readFileSync(join(root, "scsim", "scsim", "kpi", "compute.py"), "utf8");
  const rowBlock = /row: dict\[str, float\] = \{([\s\S]*?)\n\s{4}\}/.exec(compute);
  if (!rowBlock) {
    throw new Error(
      "chains: the per-replication KPI row was not found in scsim/scsim/kpi/compute.py. " +
        "Fix the scan rather than publishing a claim about which measures a run carries.",
    );
  }
  const emitted = [];
  const key = /"(\w+)":/g;
  let m;
  while ((m = key.exec(rowBlock[1]))) emitted.push({ key: m[1], always: true });

  // The cost breakdown is a loop, not a literal: `row[f"cost_{name}"]`.
  if (/row\[f"cost_\{name\}"\] = costs\[name\]/.test(compute)) {
    const ctx = readFileSync(join(root, "scsim", "scsim", "core", "context.py"), "utf8");
    const costs = /COST_COMPONENTS: tuple\[str, \.\.\.\] = \(([\s\S]*?)\n\)/.exec(ctx);
    if (!costs) throw new Error("chains: COST_COMPONENTS not found in scsim/scsim/core/context.py");
    const comp = /"(\w+)"/g;
    while ((m = comp.exec(costs[1]))) emitted.push({ key: `cost_${m[1]}`, always: true });
  }

  // The disruption measures exist only on a run that had an event.
  const eventBlock = /if events:([\s\S]*?)\n    return row/.exec(compute);
  if (eventBlock) {
    const ekey = /row\["(\w+)"\]/g;
    while ((m = ekey.exec(eventBlock[1]))) emitted.push({ key: m[1], always: false });
  }
  if (emitted.length < 15) {
    throw new Error(`chains: parsed ${emitted.length} engine KPI keys; a replication row carries more`);
  }

  const display = readFileSync(join(root, "src", "lib", "sim", "kpiDisplay.ts"), "utf8");
  const dBlock = /export const KPI_DISPLAY: KpiDisplay\[\] = \[([\s\S]*?)\n\];/.exec(display);
  if (!dBlock) throw new Error("chains: KPI_DISPLAY not found in src/lib/sim/kpiDisplay.ts");
  const rows = [];
  const drow = /\{\s*key:\s*"(\w+)",\s*label:\s*"([^"]+)"/g;
  while ((m = drow.exec(dBlock[1]))) rows.push({ key: m[1], label: m[2] });
  if (rows.length < 5) throw new Error(`chains: parsed ${rows.length} KPI_DISPLAY rows`);

  const emittedKeys = new Set(emitted.map((e) => e.key));
  return {
    emitted,
    display: rows.map((r) => ({ ...r, emitted: emittedKeys.has(r.key) })),
  };
}

/**
 * The weekly series a replication row carries, and the one the utilization
 * heatmap looks for — WP 5.2j.
 *
 * Same join, one layer down. `ReplicationSeedExplorer` declares four series and
 * gets all four. `UtilizationHeatmap` reads `time_series.utilization`, which no
 * engine writes — so it renders its own empty state on every run, forever, and
 * the empty state reads as though a run could be made to produce it.
 */
export function deriveReplicationSeries(root) {
  const engine = readFileSync(join(root, "scsim", "scsim", "core", "engine.py"), "utf8");
  const extra = /extra_series=\{([\s\S]*?)\n\s{8}\}/.exec(engine);
  if (!extra) throw new Error("chains: `extra_series` not found in scsim/scsim/core/engine.py");
  // `fill_rate` is the series the bridge always writes, beside the extras.
  const bridge = readFileSync(join(root, "sim-worker", "sim_worker", "scsim_bridge.py"), "utf8");
  if (!/ts = \{"fill_rate":/.test(bridge)) {
    throw new Error(
      "chains: the bridge no longer writes `fill_rate` as the base weekly series. " +
        "Re-read it rather than publishing a list of series a run may not carry.",
    );
  }
  const written = ["fill_rate"];
  const k = /"(\w+)":/g;
  let m;
  while ((m = k.exec(extra[1]))) written.push(m[1]);

  const ui = readFileSync(join(root, "src", "components", "sim", "ReplicationSeedExplorer.tsx"), "utf8");
  const sBlock = /export const REPLICATION_SERIES = \[([\s\S]*?)\n\] as const;/.exec(ui);
  if (!sBlock) throw new Error("chains: REPLICATION_SERIES not found in ReplicationSeedExplorer.tsx");
  const offered = [];
  const orow = /\{\s*key:\s*"(\w+)",\s*label:\s*"([^"]+)",\s*unit:\s*"([^"]*)"/g;
  while ((m = orow.exec(sBlock[1]))) offered.push({ key: m[1], label: m[2], unit: m[3] });

  const heatmap = readFileSync(join(root, "src", "components", "sim", "UtilizationHeatmap.tsx"), "utf8");
  const wants = /\?\.(\w+) as\s*\|\s*Record<string, number\[\]>/.exec(heatmap)?.[1]
    ?? /\)\?\.(\w+) as/.exec(heatmap)?.[1]
    ?? null;
  if (!wants) {
    throw new Error(
      "chains: could not read which series UtilizationHeatmap looks for. Re-read the " +
        "component rather than dropping the claim that it never finds one.",
    );
  }
  return {
    written,
    offered: offered.map((o) => ({ ...o, written: written.includes(o.key) })),
    heatmapWants: wants,
    heatmapEverRenders: written.includes(wants),
  };
}
