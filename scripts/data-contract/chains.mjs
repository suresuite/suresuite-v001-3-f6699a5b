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
import { existsSync, mkdtempSync, rmSync, readFileSync } from "node:fs";
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
 * The stress-test battery, read from the engine's own DECLARATION — §4 D106.
 *
 * ── WHAT CHANGED, AND WHY THE SCAN IS GONE ────────────────────────────────
 *
 * §6.6 lists "the ST-1…ST-7 stress-test descriptions" as narrative worth mining
 * from the archived manual. Mining is what produced §4 D22: a hand copy that
 * drifted from the engine within a quarter, and the archived copy already
 * carried statuses the engine does not ("planned · M7" against seven entries).
 *
 * WP 5.2d therefore parsed the `ST_DEFINITIONS` dict literal out of
 * `scsim/scsim/stress/battery.py` — which is exactly the weakest of §4 D90's
 * three doors, "a quoted string in a Python file is the only evidence". It said
 * so out loud, and it recorded the reason it could not do better: the right
 * source is `registry_export.py`, regenerating that export needs `pydantic`, and
 * §4 D94 recorded PyPI as unreachable from a work-package session.
 *
 * WP 6.2 found that premise false — PyPI is reachable — so `registry_export.py`
 * now declares the battery and this reads the declaration. The door moved from
 * D90's weakest to its strongest, and the scan is DELETED rather than kept as a
 * fallback: two readers of one fact is `single-source` (I1) broken, which is the
 * defect the contract exists to end.
 *
 * WHICH ONES RUN is still derived and is now derived by PYTHON: `entrypoint` is
 * the module-level callable `getattr` found, or null. A missing key means the
 * engine's own export dropped it, which is a failure and not a default.
 */
export function deriveStressTests(registry) {
  const declared = registry?.stress_tests;
  if (!Array.isArray(declared) || declared.length === 0) {
    throw new Error(
      "chains: the registry snapshot declares no `stress_tests`. Regenerate it " +
        "(`python scsim/scripts/gen_frontend_registry.py`) rather than shipping " +
        "an empty stress-test page — the battery is declared in " +
        "scsim/scsim/io/registry_export.py since WP 6.2 (§4 D106).",
    );
  }
  if (declared.length < 5) {
    throw new Error(
      `chains: the registry declares ${declared.length} stress test(s); the battery declares more than that`,
    );
  }
  return declared.map((t) => {
    if (!t.id || !t.description || !("entrypoint" in t)) {
      throw new Error(`chains: malformed stress_tests entry: ${JSON.stringify(t)}`);
    }
    return {
      id: t.id,
      description: t.description,
      // The boolean every consumer already reads, derived from the declaration
      // rather than restated beside it. `entrypoint` rides along because it says
      // WHERE the battery lives, which is the fact §4 D111 needs: these are
      // `scsim` library entry points, not a screen in this product.
      runnable: t.entrypoint !== null,
      entrypoint: t.entrypoint ?? null,
    };
  });
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

  // The scenario's objective, which drives the convergence plot and the stage
  // rail's own sub-label. Five choices, from the same legacy vocabulary.
  const setup = readFileSync(join(root, "src", "components", "sim", "ScenarioSetupForm.tsx"), "utf8");
  const oBlock = /const KPI_OPTIONS = \[([\s\S]*?)\n\];/.exec(setup);
  if (!oBlock) throw new Error("chains: KPI_OPTIONS not found in src/components/sim/ScenarioSetupForm.tsx");
  const objectives = [];
  const orow = /\{\s*value:\s*"(\w+)",\s*label:\s*"([^"]+)"\s*\}/g;
  while ((m = orow.exec(oBlock[1]))) objectives.push({ key: m[1], label: m[2] });
  if (objectives.length < 2) throw new Error(`chains: parsed ${objectives.length} scenario objectives`);

  const emittedKeys = new Set(emitted.map((e) => e.key));
  return {
    emitted,
    display: rows.map((r) => ({ ...r, emitted: emittedKeys.has(r.key) })),
    objectives: objectives.map((o) => ({ ...o, emitted: emittedKeys.has(o.key) })),
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

  // THE PANEL WAS REMOVED IN WP 6.3 (§4 D113) and this derivation reports the
  // removal rather than assuming it. Two states, both read from the tree: the file
  // exists and we say which series it looks for, or it is gone and the manual says
  // so. Deleting this read instead would leave the manual silently unable to
  // mention a panel that used to be there, and a reader who remembers it with no
  // explanation is worse off than one who is told.
  const heatmapPath = join(root, "src", "components", "sim", "UtilizationHeatmap.tsx");
  const heatmapRemoved = !existsSync(heatmapPath);
  let wants = null;
  if (!heatmapRemoved) {
    const heatmap = readFileSync(heatmapPath, "utf8");
    wants = /\?\.(\w+) as\s*\|\s*Record<string, number\[\]>/.exec(heatmap)?.[1]
      ?? /\)\?\.(\w+) as/.exec(heatmap)?.[1]
      ?? null;
    if (!wants) {
      throw new Error(
        "chains: could not read which series UtilizationHeatmap looks for. Re-read the " +
          "component rather than dropping the claim that it never finds one.",
      );
    }
  }
  return {
    written,
    offered: offered.map((o) => ({ ...o, written: written.includes(o.key) })),
    heatmapRemoved,
    heatmapWants: wants ?? "utilization",
    heatmapEverRenders: wants != null && written.includes(wants),
  };
}

/**
 * A scenario's own settings, as the setup form labels them — WP 5.2j.
 *
 * `scenarios` is deferred in `coverage.yaml` (WP 6.4), so the contract
 * describes none of its columns and the manual's scenario page could name no
 * setting at all. What exists instead is two declarations in the product, and
 * the useful thing is that they sit NEXT TO EACH OTHER:
 *
 *   · `ScenarioSetupForm.tsx` gives each field the label a reader sees, its
 *     unit, and its control — and in the same object literal names the default
 *     it compares against, `SCENARIO_ENGINE_DEFAULTS.<key>`.
 *   · `useScenarios.tsx` gives that default's value.
 *
 * So label → key → default is a join the source already makes, not one this
 * file invents. That satisfies §6.1 rule 1 — the reader's name leads, the
 * stored name is translation — without a sidecar, and it goes red rather than
 * stale when the form changes.
 */
export function deriveScenarioSetup(root) {
  const hook = readFileSync(join(root, "src", "hooks", "useScenarios.tsx"), "utf8");
  const dBlock = /SCENARIO_ENGINE_DEFAULTS = \{([\s\S]*?)\n\} satisfies/.exec(hook);
  if (!dBlock) {
    throw new Error(
      "chains: SCENARIO_ENGINE_DEFAULTS not found in src/hooks/useScenarios.tsx. Fix the " +
        "scan rather than shipping a scenario page that states no default.",
    );
  }
  const defaults = {};
  const drow = /^\s{2}(\w+):\s*(.+?),?\s*$/gm;
  let m;
  while ((m = drow.exec(dBlock[1]))) defaults[m[1]] = m[2].replace(/,$/, "").trim();

  const form = readFileSync(join(root, "src", "components", "sim", "ScenarioSetupForm.tsx"), "utf8");
  const groups = [];
  const gRe = /const (\w+): ParamGroup = \{\s*\n\s*name: "([^"]+)",([\s\S]*?)\n  \};/g;
  while ((m = gRe.exec(form))) {
    const body = m[3];
    const fields = [];
    // Each field is `{ label: "…", [unit: …,] provenance: prov(local.X !== SCENARIO_ENGINE_DEFAULTS.X …`
    const fRe =
      /label:\s*"([^"]+)",\s*(?:unit:\s*(?:"([^"]*)"|(\w+)),\s*)?provenance:[\s\S]*?SCENARIO_ENGINE_DEFAULTS\.(\w+)/g;
    let f;
    while ((f = fRe.exec(body))) {
      const key = f[4];
      fields.push({
        label: f[1],
        // `unitLabel` is the project's chosen planning unit, resolved at
        // render time — named rather than pinned to one word, because the
        // screen really does change it.
        unit: f[2] ?? (f[3] === "unitLabel" ? "the project's planning unit" : f[3] ?? null),
        key,
        default: defaults[key] ?? null,
      });
    }
    if (fields.length) groups.push({ name: m[2], fields });
  }
  const total = groups.reduce((n, g) => n + g.fields.length, 0);
  if (groups.length < 2 || total < 6) {
    throw new Error(
      `chains: parsed ${groups.length} scenario setup group(s) and ${total} field(s); the form ` +
        "declares more. Fix the scan rather than publishing half a settings reference.",
    );
  }
  for (const g of groups) {
    for (const f of g.fields) {
      if (f.default === null) {
        throw new Error(
          `chains: the setup form compares "${f.label}" against SCENARIO_ENGINE_DEFAULTS.${f.key} ` +
            "and that key has no default. One of the two literals has moved.",
        );
      }
    }
  }
  return groups;
}

/**
 * The recovery levers a scenario offers, against the ones the engine maps —
 * WP 5.2j.
 *
 * `DisruptionRecoveryPane` offers six strategies, each with a label, a
 * description and its own parameters. `project_map.py` turns a response into an
 * engine plugin, and it does not turn all six into anything: a lever the engine
 * has no branch for is saved on the scenario, shown as enabled, and changes no
 * number in the run.
 *
 * The policy grid has ALREADY been corrected for exactly this — `schemas.ts`'s
 * `MULTI_SELECT_OPTIONS.response` carries a comment saying it is "restricted to
 * the responses the scsim engine maps to policies" and lists a DIFFERENT six.
 * So the fact is known in one screen's source and not the other's, which is why
 * the manual joins all three rather than trusting either.
 *
 * `plugin` is the engine plugin a lever reaches, or null. Two levers reaching
 * the SAME plugin is a fact too, and one the pane's own labels hide.
 */
export function deriveRecoveryLevers(root) {
  const map = readFileSync(join(root, "scsim", "scsim", "io", "project_map.py"), "utf8");
  const start = map.indexOf('responses = set(recovery.get("response") or [])');
  if (start < 0) {
    throw new Error(
      "chains: the recovery-response block was not found in scsim/scsim/io/project_map.py. " +
        "Fix the scan rather than publishing a claim about which levers reach the engine.",
    );
  }
  const region = map.slice(start);
  const plugins = new Map();
  // `if "x" in responses:` / `if responses & {"a", "b"}:` … `out["plugin"]`
  const branch = /if\s+(?:strategy[^\n]*\n\s*or\s+)?(?:"([a-z_]+)" in responses|responses & \{([^}]*)\})[^\n]*:\n([\s\S]{0,1200}?)out\["(\w+)"\]/g;
  let m;
  while ((m = branch.exec(region))) {
    const keys = m[1] ? [m[1]] : [...m[2].matchAll(/"([a-z_]+)"/g)].map((x) => x[1]);
    for (const k of keys) if (!plugins.has(k)) plugins.set(k, m[4]);
  }
  if (plugins.size < 3) {
    throw new Error(`chains: parsed ${plugins.size} engine recovery branches; the mapper has more`);
  }

  const pane = readFileSync(join(root, "src", "components", "sim", "DisruptionRecoveryPane.tsx"), "utf8");
  const orderBlock = /const strategyOrder: RecoveryResponseKey\[\] = \[([\s\S]*?)\n\s{2}\];/.exec(pane);
  if (!orderBlock) throw new Error("chains: `strategyOrder` not found in DisruptionRecoveryPane.tsx");
  const order = [...orderBlock[1].matchAll(/"([a-z_]+)"/g)].map((x) => x[1]);

  const descBlock = /const STRATEGY_DESCRIPTIONS: Record<RecoveryResponseKey, string> = \{([\s\S]*?)\n\};/.exec(pane);
  if (!descBlock) throw new Error("chains: `STRATEGY_DESCRIPTIONS` not found in DisruptionRecoveryPane.tsx");
  const desc = new Map([...descBlock[1].matchAll(/(\w+):\s*"((?:[^"\\]|\\.)*)"/g)].map((x) => [x[1], x[2]]));

  const score = readFileSync(join(root, "src", "lib", "sim", "recoveryScore.ts"), "utf8");
  const labelBlock = /export const RESPONSE_LABELS: Record<RecoveryResponseKey, string> = \{([\s\S]*?)\n\};/.exec(score);
  if (!labelBlock) throw new Error("chains: `RESPONSE_LABELS` not found in src/lib/sim/recoveryScore.ts");
  const labels = new Map([...labelBlock[1].matchAll(/(\w+):\s*"([^"]+)"/g)].map((x) => [x[1], x[2]]));

  // Each lever's own parameters, with units and defaults.
  const paramBlock =
    /const STRATEGY_PARAMS: Partial<Record<RecoveryResponseKey, StrategyParamDef\[\]>> = \{([\s\S]*?)\n\};/.exec(pane);
  if (!paramBlock) throw new Error("chains: `STRATEGY_PARAMS` not found in DisruptionRecoveryPane.tsx");
  const params = new Map();
  const perLever = /(\w+):\s*\[([\s\S]*?)\n\s{2}\],/g;
  while ((m = perLever.exec(paramBlock[1]))) {
    const rows = [
      ...m[2].matchAll(
        /key:\s*"(\w+)",\s*label:\s*"([^"]+)",\s*unit:\s*"([^"]*)",\s*default:\s*([\d.]+)(?:,\s*step:\s*"[^"]*")?(?:,\s*hint:\s*"((?:[^"\\]|\\.)*)")?/g,
      ),
    ].map((x) => ({ key: x[1], label: x[2], unit: x[3], default: Number(x[4]), hint: x[5] ?? null }));
    params.set(m[1], rows);
  }

  // The grid's already-corrected list, for the third column.
  const schemas = readFileSync(join(root, "src", "lib", "policies", "schemas.ts"), "utf8");
  const gridBlock = /response: \[([\s\S]*?)\n\s{2}\],/.exec(schemas);
  if (!gridBlock) throw new Error("chains: `MULTI_SELECT_OPTIONS.response` not found in schemas.ts");
  const grid = [...gridBlock[1].matchAll(/"([a-z_]+)"/g)].map((x) => x[1]);

  const levers = order.map((key) => {
    const label = labels.get(key);
    if (!label) throw new Error(`chains: the recovery pane offers "${key}" and RESPONSE_LABELS has no label for it`);
    return {
      key,
      label,
      description: desc.get(key) ?? null,
      plugin: plugins.get(key) ?? null,
      inGrid: grid.includes(key),
      params: params.get(key) ?? [],
    };
  });
  // Responses the ENGINE maps that the scenario pane never offers — filtered to
  // the ones a scenario can actually hold. The mapper also branches on
  // `expedite_freight`, which is not in `RecoveryResponse`, so no saved
  // scenario or policy can ever contain it: a dead branch, not a missing
  // control, and listing it as one would send a reader looking for a toggle.
  const enumBlock = /export const RecoveryResponse = z\.enum\(\[([\s\S]*?)\n\]\);/.exec(schemas);
  if (!enumBlock) throw new Error("chains: `RecoveryResponse` enum not found in schemas.ts");
  const valid = new Set([...enumBlock[1].matchAll(/"([a-z_]+)"/g)].map((x) => x[1]));
  const paneKeys = new Set(order);
  const engineOnly = [...plugins.entries()]
    .filter(([k]) => !paneKeys.has(k) && valid.has(k))
    .map(([key, plugin]) => ({ key, plugin, inGrid: grid.includes(key) }));

  if (levers.length < 4) throw new Error(`chains: parsed ${levers.length} recovery levers; the pane offers more`);
  return { levers, engineOnly };
}

/**
 * The assistant's three declared vocabularies — WP 5.2j.
 *
 * `chat_threads`, `chat_messages` and `chat_folders` are deferred in the
 * contract, so §9's pages had no generated fact to render and were among the
 * thinnest in the manual. What IS declared, in three places:
 *
 *   · the five PERSONAS in the picker (`src/lib/chat/agents.ts`) — and the
 *     module's own header says a persona is a system-prompt preamble and
 *     nothing else, which is the single most useful sentence a reader of that
 *     picker could have;
 *   · the interaction MODES (`ModeSwitch.tsx`), including the disabled `Auto`
 *     position and the unlock conditions its tooltip states verbatim;
 *   · the nine specialist AGENTS the server's router selects from
 *     (`supabase/functions/project-ai-chat/router.ts`), each with the mission
 *     sentence the classifier prompt itself uses.
 *
 * The third is the one no page could have guessed at: the picker's five names
 * map onto NONE of the nine, and the router chooses from what you asked rather
 * than from what you picked.
 */
export function deriveAssistant(root) {
  const personaSrc = readFileSync(join(root, "src", "lib", "chat", "agents.ts"), "utf8");
  const pBlock = /export const AGENTS: AgentSpec\[\] = \[([\s\S]*?)\n\];/.exec(personaSrc);
  if (!pBlock) throw new Error("chains: `AGENTS` not found in src/lib/chat/agents.ts");
  const personas = [
    ...pBlock[1].matchAll(
      /id:\s*"([\w-]+)",\s*name:\s*"([^"]+)",\s*blurb:\s*"((?:[^"\\]|\\.)*)",[\s\S]{0,200}?(?:requiresProject:\s*(true|false),)?\s*\},/g,
    ),
  ].map((m) => ({
    id: m[1],
    name: m[2],
    blurb: m[3].replace(/\\"/g, '"'),
    requiresProject: m[4] !== "false",
  }));
  if (personas.length < 3) throw new Error(`chains: parsed ${personas.length} chat personas`);

  const modeSrc = readFileSync(join(root, "src", "components", "chat", "ModeSwitch.tsx"), "utf8");
  const mBlock = /const POSITIONS: Array<\{[^}]*\}> = \[([\s\S]*?)\n\];/.exec(modeSrc);
  if (!mBlock) throw new Error("chains: `POSITIONS` not found in src/components/chat/ModeSwitch.tsx");
  const modes = [
    ...mBlock[1].matchAll(/id:\s*"(\w+)",\s*label:\s*"([^"]+)",\s*hint:\s*"((?:[^"\\]|\\.)*)"/g),
  ].map((m) => ({ id: m[1], label: m[2], hint: m[3].replace(/\\"/g, '"'), live: true }));
  const autoBlock = /export const AUTO_TOOLTIP =\s*([\s\S]*?);\n/.exec(modeSrc);
  if (!autoBlock) throw new Error("chains: `AUTO_TOOLTIP` not found in ModeSwitch.tsx");
  // A multi-line concatenation of string literals; join them the way the
  // tooltip does, so the manual states the unlock conditions VERBATIM rather
  // than paraphrasing a commitment.
  const autoTooltip = [...autoBlock[1].matchAll(/"((?:[^"\\]|\\.)*)"/g)]
    .map((m) => m[1].replace(/\\"/g, '"'))
    .join("");
  if (autoTooltip.length < 40) throw new Error("chains: AUTO_TOOLTIP parsed too short to be the real text");
  const defaultMode = /export const DEFAULT_THREAD_MODE: ThreadMode = "(\w+)"/.exec(modeSrc)?.[1] ?? null;
  if (!defaultMode) throw new Error("chains: DEFAULT_THREAD_MODE not found in ModeSwitch.tsx");

  const routerSrc = readFileSync(
    join(root, "supabase", "functions", "project-ai-chat", "router.ts"),
    "utf8",
  );
  const rBlock = /export const AGENT_ROSTER: Record<AgentSlug, \{ mission: string; intents: string\[\] \}> = \{([\s\S]*?)\n\};/.exec(
    routerSrc,
  );
  if (!rBlock) throw new Error("chains: `AGENT_ROSTER` not found in project-ai-chat/router.ts");
  const agents = [
    ...rBlock[1].matchAll(/"?([\w-]+)"?:\s*\{\s*mission:\s*\n?\s*((?:\s*"(?:[^"\\]|\\.)*"\s*\+?)+),/g),
  ].map((m) => ({
    slug: m[1],
    mission: [...m[2].matchAll(/"((?:[^"\\]|\\.)*)"/g)]
      .map((x) => x[1].replace(/\\"/g, '"'))
      .join(""),
  }));
  if (agents.length < 5) {
    throw new Error(`chains: parsed ${agents.length} specialist agents; the roster declares more`);
  }
  for (const a of agents) {
    if (!a.mission) throw new Error(`chains: specialist agent "${a.slug}" parsed with no mission`);
  }
  return { personas, modes, autoTooltip, defaultMode, agents };
}

/**
 * The proposal lifecycle, the memory vocabulary and the plan states — WP 5.2j.
 *
 * All three tables are deferred in `coverage.yaml` under the "control plane, no
 * simulation value" group, which is the right call for the DATA contract and
 * left §9's pages with nothing to render. But the facts a reader needs are not
 * column descriptions: they are the CHECK constraints — which agent may file
 * which kind of artifact, what states a proposal can be in, how long it lives.
 *
 * Those are in `build/schema.introspected.json`, which replays every migration,
 * so this reads the CURRENT constraint rather than the migration that first
 * wrote it. That matters here more than anywhere: the agent-to-artifact pairing
 * was five pairs when it was created and is nine now, and a page written from
 * the original migration would be four agents short.
 */
function introspected(root) {
  const raw = readFileSync(join(root, "build", "schema.introspected.json"), "utf8");
  const j = JSON.parse(raw);
  if (!Array.isArray(j.tables) || j.tables.length < 10) {
    throw new Error("chains: build/schema.introspected.json has no table list — re-run contract:introspect");
  }
  return j;
}

/** `CHECK (col IN ('a','b'))` → ['a','b'], from the table's own constraints. */
function checkValues(table, column) {
  const c = (table.constraints ?? []).find((x) =>
    new RegExp(`CHECK\\s*\\(\\s*${column} IN`).test(String(x.definition ?? "")),
  );
  if (!c) {
    throw new Error(
      `chains: ${table.name}.${column} has no CHECK … IN constraint. The page that renders it ` +
        "states a closed vocabulary; publishing an empty one would be worse than none.",
    );
  }
  return [...String(c.definition).matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

/** `DEFAULT now() + interval '14 days'` → "14 days", or null. */
function intervalDefault(table, column) {
  const col = (table.columns ?? []).find((c) => c.name === column);
  const m = /interval\s*'([^']+)'/.exec(String(col?.default ?? ""));
  return m ? m[1] : null;
}

export function deriveIntelligence(root) {
  const j = introspected(root);
  const table = (name) => {
    const t = j.tables.find((x) => x.name === name);
    if (!t) throw new Error(`chains: the introspected schema has no table "${name}"`);
    return t;
  };

  const proposals = table("proposals");
  const pairing = (proposals.constraints ?? []).find((c) =>
    String(c.definition ?? "").includes("(agent_id, artifact_type) IN"),
  );
  if (!pairing) {
    throw new Error(
      "chains: the proposals agent-owns-artifact constraint is gone. It is the fact that says " +
        "which specialist may file which kind of change — do not publish the page without it.",
    );
  }
  const pairs = [...String(pairing.definition).matchAll(/\('([\w-]+)',\s*'([\w-]+)'\)/g)].map((m) => ({
    agent: m[1],
    artifact: m[2],
  }));
  if (pairs.length < 5) throw new Error(`chains: parsed ${pairs.length} agent/artifact pairs`);

  const memory = table("project_memory");
  const contentCap = /char_length\(content\) <= (\d+)/.exec(
    (memory.constraints ?? []).map((c) => String(c.definition ?? "")).join(" "),
  )?.[1];
  if (!contentCap) throw new Error("chains: project_memory has no content length cap");

  const plans = table("chat_plans");

  return {
    proposal: {
      pairs,
      statuses: checkValues(proposals, "status"),
      provenance: checkValues(proposals, "provenance"),
      expiresAfter: intervalDefault(proposals, "expires_at"),
    },
    memory: {
      kinds: checkValues(memory, "kind"),
      statuses: checkValues(memory, "status"),
      contentCap: Number(contentCap),
    },
    plan: {
      statuses: checkValues(plans, "status"),
      expiresAfter: intervalDefault(plans, "expires_at"),
    },
  };
}


/**
 * Budgets, usage and entitlements — WP 5.2j.
 *
 * The four AI tables are deferred in `coverage.yaml` for the right reason (no
 * simulation value), and their CHECK constraints are still the vocabulary a
 * reader needs: a budget has a SCOPE and a PERIOD, and a recorded call has a
 * STATUS. `user_ai_permissions` has a sidecar, so its columns come from the
 * contract and are not repeated here.
 */
export function deriveAiGovernance(root) {
  const j = introspected(root);
  const table = (name) => {
    const t = j.tables.find((x) => x.name === name);
    if (!t) throw new Error(`chains: the introspected schema has no table "${name}"`);
    return t;
  };
  const budgets = table("ai_budgets");
  const usage = table("ai_usage_logs");
  const models = table("ai_models");
  const cost = models.columns.filter((c) => /cost_per_1k$/.test(c.name)).map((c) => c.name);
  if (cost.length < 2) {
    throw new Error("chains: ai_models no longer carries per-1k input and output costs");
  }
  return {
    budgetScopes: checkValues(budgets, "scope"),
    budgetPeriods: checkValues(budgets, "period"),
    budgetCeilings: budgets.columns
      .map((c) => c.name)
      .filter((n) => ["budget_usd", "token_limit", "rpm", "rpd"].includes(n)),
    usageStatuses: checkValues(usage, "status"),
    usageRecorded: usage.columns
      .map((c) => c.name)
      .filter((n) =>
        ["prompt_tokens", "completion_tokens", "total_tokens", "cost_usd", "latency_ms", "error_code"].includes(n),
      ),
    modelCostColumns: cost,
  };
}

/**
 * The policy presets, and the project facts they derive from — WP 5.2j.
 *
 * `policy_presets` is deferred in `coverage.yaml`, so the page describing them
 * had no column reference and (correctly) wrote none. What it also had no way
 * to say is the thing that matters most about a preset: **it is not a fixed set
 * of values.** Each one is a `derive(ctx)` function reading the project's own
 * measured facts — supplier lead-time mean and spread, demand mean, the
 * top-volume supplier — so "Resilient" on one project is different numbers from
 * "Resilient" on another, and every value it proposes carries its own `why`.
 *
 * Read from the preset modules themselves: the slug, the name, the description,
 * whether it ships with the product, and WHICH context facts its derivation
 * reads. That last one is the fact a reader needs and no other source has.
 */
export function derivePresets(root) {
  const dir = join(root, "src", "lib", "policies", "presets");
  const index = readFileSync(join(dir, "index.ts"), "utf8");
  const order = /export const ALL_PRESETS: PresetDefinition\[\] = \[([\s\S]*?)\n\];/.exec(index);
  if (!order) throw new Error("chains: `ALL_PRESETS` not found in src/lib/policies/presets/index.ts");
  // The export order IS the order the dialog offers them in.
  const names = [...order[1].matchAll(/\b(\w+),/g)].map((m) => m[1]);
  const files = new Map(
    [...index.matchAll(/import \{ (\w+) \} from "\.\/([\w_]+)";/g)].map((m) => [m[1], m[2]]),
  );
  const presets = [];
  for (const name of names) {
    const file = files.get(name);
    if (!file) throw new Error(`chains: ALL_PRESETS names "${name}" and nothing imports it`);
    const src = readFileSync(join(dir, `${file}.ts`), "utf8");
    const head =
      /slug:\s*"([\w-]+)",\s*name:\s*"([^"]+)",\s*description:\s*"((?:[^"\\]|\\.)*)",\s*is_system:\s*(true|false)/.exec(
        src,
      );
    if (!head) throw new Error(`chains: preset "${file}" has no slug/name/description/is_system head`);
    // Which measured project facts the derivation reads. `ctx.x` and nothing
    // else — the values it computes from them are per-project and belong on a
    // screen, not in a manual.
    const reads = [...new Set([...src.matchAll(/\bctx\.(\w+)/g)].map((m) => m[1]))].sort();
    presets.push({
      slug: head[1],
      name: head[2],
      description: head[3].replace(/\\"/g, '"'),
      isSystem: head[4] === "true",
      derivesFrom: reads,
      families: [...new Set([...src.matchAll(/^\s{6}(\w+): \{$/gm)].map((m) => m[1]))],
    });
  }
  if (presets.length < 4) throw new Error(`chains: parsed ${presets.length} policy presets`);
  if (presets.every((p) => p.derivesFrom.length === 0)) {
    throw new Error(
      "chains: no preset reads a project fact. Either the derivation stopped being " +
        "project-aware — in which case the page's central claim must change — or the scan broke.",
    );
  }
  return presets;
}

/**
 * The model-validation card's own vocabulary — WP 5.2j.
 *
 * `model_validations` is deferred in `coverage.yaml`, and the page describing it
 * said the four-way binding between a verdict and what produced it "is not built
 * yet". The table carries `policy_version_id`, `policy_hash`, `dataset_version_id`,
 * `graph_hash`, `scenario_hash`, `scenario_fingerprint`, `engine_fingerprint` and
 * `evidence_run_id` — so on this one table the binding exists, and the manual was
 * telling readers it did not.
 *
 * `binding` is derived rather than listed so the claim cannot survive the columns
 * being removed, and the derivation throws if the card stops carrying a
 * fingerprint for any of the four components.
 */
export function deriveValidationCard(root) {
  const j = introspected(root);
  const t = j.tables.find((x) => x.name === "model_validations");
  if (!t) throw new Error("chains: the introspected schema has no `model_validations` table");
  const has = (name) => t.columns.some((c) => c.name === name);
  const binding = [
    { component: "dataset", columns: ["dataset_version_id", "graph_hash"] },
    { component: "policy", columns: ["policy_version_id", "policy_hash"] },
    { component: "scenario", columns: ["scenario_hash", "scenario_fingerprint"] },
    { component: "engine", columns: ["engine_fingerprint"] },
  ].map((b) => ({ ...b, columns: b.columns.filter(has) }));
  for (const b of binding) {
    if (b.columns.length === 0) {
      throw new Error(
        `chains: model_validations no longer records the ${b.component} it was validated against. ` +
          "The page states the four-way binding as a fact — re-read the table before changing it.",
      );
    }
  }
  return {
    binding,
    verdicts: checkValues(t, "verdict"),
    bases: checkValues(t, "basis"),
    statuses: checkValues(t, "status"),
    warmupMethods: checkValues(t, "warmup_method"),
    hasEvidenceRun: has("evidence_run_id"),
    adopts: t.columns
      .map((c) => c.name)
      .filter((n) => ["adopted_warmup_days", "recommended_replications"].includes(n)),
  };
}

/**
 * What a project deletion actually reaches — WP 5.2j.
 *
 * `exporting-and-deleting` said *"the relationships between tables are declared
 * in the database, so a deletion follows them rather than relying on anybody
 * remembering which tables were involved"*. Half of that is true. The other half
 * is `delete-project/index.ts`, which deletes a HAND-WRITTEN LIST of tables by
 * name before removing the project row — precisely the remembering the sentence
 * said was not happening.
 *
 * Neither mechanism is wrong. What no page could say is the JOIN: how many
 * project-scoped tables cascade, how many are swept by the list, which are
 * deliberately detached instead of deleted, and whether anything is in neither
 * set. The last number is the one worth publishing, because a table in neither
 * set keeps its rows after the project that owned them is gone.
 */
export function deriveProjectDeletion(root) {
  const j = introspected(root);
  const scoped = j.tables.filter((t) => t.columns.some((c) => c.name === "project_id"));
  if (scoped.length < 20) {
    throw new Error(`chains: only ${scoped.length} tables carry project_id; the scan has broken`);
  }
  const fkTo = (t) => t.columns.find((c) => c.name === "project_id")?.references ?? null;

  const src = readFileSync(join(root, "supabase", "functions", "delete-project", "index.ts"), "utf8");
  if (!/deleteTableByProjectId\(/.test(src)) {
    throw new Error(
      "chains: delete-project no longer sweeps tables by name. Re-read it — the page states " +
        "which tables are swept explicitly and which rely on a cascade.",
    );
  }
  const swept = new Set([
    ...[...src.matchAll(/deleteTableByProjectId\('(\w+)'\)/g)].map((m) => m[1]),
    ...[...src.matchAll(/deleteByIds\('(\w+)'/g)].map((m) => m[1]),
    // The disruption children are deleted by their profile id, not by project.
    ...[...src.matchAll(/^\s+'(disruption_scenario_\w+)',$/gm)].map((m) => m[1]),
  ]);
  if (swept.size < 5) throw new Error(`chains: parsed ${swept.size} swept tables in delete-project`);

  const cascade = [];
  const detached = [];
  const sweptOnly = [];
  const neither = [];
  for (const t of scoped) {
    const r = fkTo(t);
    const onDelete = r && r.table === "projects" ? String(r.on_delete ?? "").toUpperCase() : null;
    if (onDelete === "CASCADE") cascade.push(t.name);
    else if (onDelete === "SET NULL") detached.push(t.name);
    else if (swept.has(t.name)) sweptOnly.push(t.name);
    else neither.push(t.name);
  }
  return {
    projectScoped: scoped.length,
    cascade: cascade.length,
    detached: detached.sort(),
    sweptOnly: sweptOnly.sort(),
    neither: neither.sort(),
    /** The response is 202 before any row is touched — see the function. */
    asynchronous: /status: 202/.test(src) && /Deletion started/.test(src),
  };
}

/**
 * The administrative routes, and the single capability that gates all of them —
 * WP 5.2j.
 *
 * `admin-screens` listed seven paths by hand and the router declares nine: it
 * was missing the dashboard at `/admin` and the per-user page at
 * `/admin/users/:userId` — which is where the AI allow-list actually is, so the
 * page pointed at the wrong screen for its own worked example.
 *
 * The gate is the fact that hand list could never carry. `PAGE_CAPABILITIES`
 * declares ONE key for this whole area, and `pageKeyForPath` matches a path to
 * the longest declared key it starts with — so `/admin/usage` resolves to
 * `/admin` and every screen is gated by the same grant. Administrative access
 * is all-or-nothing, and no amount of reading the seven-row table would say so.
 */
export function deriveAdminScreens(root) {
  const app = readFileSync(join(root, "src", "App.tsx"), "utf8");
  const routes = [...app.matchAll(/<Route path="(\/admin[^"]*)"[\s\S]{0,200}?<(Admin\w+)\s/g)].map(
    (m) => ({ path: m[1], component: m[2] }),
  );
  if (routes.length < 5) {
    throw new Error(
      `chains: parsed ${routes.length} /admin routes from src/App.tsx; the router declares more. ` +
        "Fix the scan rather than publishing a partial list of administrative screens.",
    );
  }
  const caps = readFileSync(join(root, "src", "lib", "capabilities.generated.ts"), "utf8");
  const pageBlock = /export const PAGE_CAPABILITIES: CapabilityMeta\[\] = \[([\s\S]*?)\n\];/.exec(caps);
  if (!pageBlock) throw new Error("chains: PAGE_CAPABILITIES not found in capabilities.generated.ts");
  const pageKeys = [...pageBlock[1].matchAll(/key: '([^']+)'/g)].map((m) => m[1]);
  // The same longest-prefix rule `pageKeyForPath` uses.
  const gateFor = (path) =>
    pageKeys
      .filter((k) => (k === "/" ? path === "/" : path === k || path.startsWith(k + "/")))
      .sort((a, b) => b.length - a.length)[0] ?? null;
  const gates = new Set(routes.map((r) => gateFor(r.path)).filter(Boolean));
  if (gates.size === 0) {
    throw new Error("chains: no page capability gates any /admin route — re-read pageKeyForPath");
  }
  return {
    routes: routes.map((r) => ({ ...r, gate: gateFor(r.path) })),
    gates: [...gates].sort(),
    pageCapabilities: pageKeys.length,
  };
}

/**
 * How wide the READ rules actually are — WP 5.2j.
 *
 * `who-can-see-your-data` already computes the tables whose rules ALL permit
 * every row, and reports three. That measure answers "is this table
 * unprotected", and it is not the question a reader asks. `inbound_logistics`
 * carries a restrictive write rule beside `FOR SELECT USING (true)` granted to
 * `authenticated` AND `anon` — so it is not in the three, and every row of it is
 * readable by anyone holding the key the browser bundle ships.
 *
 * §4 D28 already records the class and its standing decision (document, do not
 * change, until there is an auth model — WP 7.1). What no page had was the READ
 * number, so the manual's most consequential page reported 3 where a reader's
 * question answers 12.
 *
 * `reference.generated.ts` counts policies and cannot carry this: it records how
 * many policies have no predicate, not which COMMAND they are for or which role
 * holds them. Both are in the introspected schema.
 */
export function deriveReadExposure(root) {
  const j = introspected(root);
  const contract = JSON.parse(readFileSync(join(root, "build", "data-contract.generated.json"), "utf8"));
  const described = Object.keys(contract.tables ?? {});
  if (described.length < 20) throw new Error("chains: the generated contract describes too few tables to trust");

  const open = [];
  for (const name of described) {
    const t = j.tables.find((x) => x.name === name);
    if (!t?.rls) continue;
    const roles = new Set();
    let unrestrictedRead = false;
    for (const p of t.rls.policies ?? []) {
      const cmd = String(p.command ?? "").toUpperCase();
      if (cmd !== "SELECT" && cmd !== "ALL") continue;
      if (String(p.using ?? "").trim() !== "true") continue;
      unrestrictedRead = true;
      for (const r of p.roles ?? []) roles.add(r);
      if ((p.roles ?? []).length === 0) roles.add("public");
    }
    if (unrestrictedRead) open.push({ table: name, roles: [...roles].sort() });
  }
  // A scan that found none would let the page print a reassurance. §4 D28
  // measured 27 tables with a predicate-less policy across the whole schema, so
  // zero among the described ones means the scan broke, not that it was fixed.
  if (open.length === 0) {
    throw new Error(
      "chains: no described table has an unrestricted read policy. §4 D28 records this class " +
        "as open and unchanged — verify against the migrations before letting the page say so.",
    );
  }
  const signedOut = open.filter((t) => t.roles.includes("anon") || t.roles.includes("public"));
  return { described: described.length, open, signedOut: signedOut.map((t) => t.table) };
}
