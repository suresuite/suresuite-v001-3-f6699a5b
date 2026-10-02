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
  wheelPath,
} from "../../../../supabase/functions/_shared/engineIndex";
import { buildIndex } from "../../../../scripts/publish_engine_wheels.mjs";

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
});
