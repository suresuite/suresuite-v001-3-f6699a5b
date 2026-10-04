/**
 * WP 12.4 — the engine a library installs.
 *
 * The publisher (`scripts/publish_engine_wheels.mjs`) writes `engine/index.json`;
 * the gateway (`_shared/engineIndex.ts`) reads it and signs a URL per wheel. Two
 * authors of one format, so this runs the publisher's index through the gateway's
 * parser: if either side changes the shape, it fails here, not in a user's pip.
 */
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  engineResponse,
  parseEngineIndex,
  parseEngineVersions,
  publishedVersions,
  selectEngine,
  wheelPath,
} from "../../../../supabase/functions/_shared/engineIndex";
import { buildIndex, mergeVersions } from "../../../../scripts/publish_engine_wheels.mjs";
import { readdirSync, statSync } from "node:fs";

const ENGINE = join(__dirname, "..", "..", "..", "..", "public", "engine");

describe("engine distribution index", () => {
  const index = parseEngineIndex(buildIndex(ENGINE, new Date("2026-10-02T00:00:00Z")));

  it("covers every wheel the browser engine loads, with its real sha256", () => {
    const manifest = JSON.parse(readFileSync(join(ENGINE, "manifest.json"), "utf8"));
    expect(index.engine_version).toBe(manifest.engine_version);
    expect(index.wheels.map((w) => w.file)).toEqual(manifest.wheels);
    for (const w of index.wheels) {
      const body = readFileSync(join(ENGINE, w.file));
      expect(w.sha256).toBe(createHash("sha256").update(body).digest("hex"));
      expect(w.bytes).toBe(body.length);
    }
  });

  it("stores a wheel at a content-addressed path", () => {
    const w = index.wheels[0];
    expect(wheelPath(w)).toBe(`${w.sha256.slice(0, 16)}/${w.file}`);
  });

  it("answers with a URL per wheel and refuses a malformed index", () => {
    const urls = Object.fromEntries(index.wheels.map((w) => [w.file, `https://x/${w.file}?token=t`]));
    const body = engineResponse(index, urls);
    expect(body.wheels.every((w) => w.url && w.sha256)).toBe(true);
    expect(() => parseEngineIndex({ engine_version: "1", wheels: [{ file: "x.whl", sha256: "z", bytes: 1 }] })).toThrow();
    expect(() => parseEngineIndex({ wheels: [] })).toThrow();
  });

  it("names the build the committed wheels are (WP 15.1) and the gateway passes it on", () => {
    const manifest = JSON.parse(readFileSync(join(ENGINE, "manifest.json"), "utf8"));
    expect(index.engine_build).toBe(manifest.engine_build);
    expect(index.engine_build).toMatch(/^scsim-\d+\.\d+\.\d+\+[0-9a-f]{12}$/);
    expect(engineResponse(index, {}).engine_build).toBe(manifest.engine_build);
  });
});

// PLAN.md §25 · WP 15.3 · §4 D294 — every build ever published stays installable by version.
describe("engine archive: versions.json", () => {
  const w = (n: string) => ({ file: `scsim-${n}-py3-none-any.whl`, sha256: n.replace(/\D/g, "").padEnd(64, "a").slice(0, 64), bytes: 10 });
  const v040 = { engine_version: "0.4.0", engine_build: "scsim-0.4.0+aaaaaaaaaaaa", commit: "a", published_at: "2026-10-01", wheels: [w("0.4.0")] };
  const v041 = { ...v040, engine_build: "scsim-0.4.0+bbbbbbbbbbbb", commit: "b", published_at: "2026-10-02" };
  const v050 = { engine_version: "0.5.0", engine_build: "scsim-0.5.0+cccccccccccc", commit: "c", published_at: "2026-10-03", wheels: [w("0.5.0")] };

  it("is append-only: a new build goes first, a build already listed keeps its first publication", () => {
    let list = mergeVersions(null, v040);
    list = mergeVersions(list, v041);
    list = mergeVersions(list, v050);
    expect(list.versions.map((v) => v.engine_build)).toEqual([v050.engine_build, v041.engine_build, v040.engine_build]);
    const again = mergeVersions(list, { ...v040, commit: "z", published_at: "2026-12-31" });
    expect(again.versions).toHaveLength(3);
    expect(again.versions.find((v) => v.engine_build === v040.engine_build)?.commit).toBe("a");
  });

  it("selects the newest build of a version, or exactly the build a run recorded", () => {
    const versions = parseEngineVersions(mergeVersions(mergeVersions(mergeVersions(null, v040), v041), v050));
    expect(selectEngine(versions, "0.4.0")?.engine_build).toBe(v041.engine_build);
    expect(selectEngine(versions, "scsim-0.4.0+aaaaaaaaaaaa")?.commit).toBe("a");
    expect(selectEngine(versions, "0.9.9")).toBeNull();
    expect(selectEngine(versions, "scsim-0.4.0+ffffffffffff")).toBeNull();
    expect(publishedVersions(versions)).toEqual(["0.5.0", "0.4.0"]);
  });

  it("refuses a malformed list", () => {
    expect(() => parseEngineVersions({})).toThrow();
    expect(() => parseEngineVersions({ versions: [{ engine_version: "1", wheels: [] }] })).toThrow();
  });

  it("is never pruned: no code path deletes from the engine bucket", () => {
    // Retention is forever (owner decision O5): a deleted wheel would make every
    // result its build produced unreproducible (T4). So nothing may remove one.
    const ROOT = join(__dirname, "..", "..", "..", "..");
    const roots = ["supabase/functions", "scripts", "sim-worker/sim_worker", "src"].map((p) => join(ROOT, p));
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        if (name === "node_modules" || name.startsWith(".")) continue;
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|tsx|mjs|js|py|sh)$/.test(name) && !p.includes("__tests__")) {
          const text = readFileSync(p, "utf8");
          if (/from\(\s*["']engine["']\s*\)\s*\.remove\(/.test(text) ||
              /DELETE[^\n]*storage\/v1\/object\/(\$\{BUCKET\}|engine)/.test(text)) offenders.push(p);
        }
      }
    };
    roots.forEach(walk);
    expect(offenders).toEqual([]);
  });
});
