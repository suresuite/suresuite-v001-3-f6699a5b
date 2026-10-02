#!/usr/bin/env node
// Publish the engine wheels to the PRIVATE `engine` storage bucket — Phase 12 · WP 12.4.
//
// `GET /v1/engine` hands an API key short-lived signed URLs to these files, so a
// user's `suresuite.install_engine()` installs exactly the engine the platform
// runs. The wheels are the ones `scripts/build_engine_wheels.sh` commits to
// `public/engine/` (CI's freshness gate keeps them equal to the source).
//
// Writes, per wheel CONTENT:     engine/<sha256[:16]>/<wheel>   (never overwritten — a wheel's
//                                 version need not change when its content does)
// and the pointer to the latest: engine/index.json             {engine_version, wheels[{file,sha256,bytes}]}
//
// Usage:
//   node scripts/publish_engine_wheels.mjs --dry-run      # print the index, upload nothing
//   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… node scripts/publish_engine_wheels.mjs
//
// CI (`.github/workflows/engine-distribution.yml`, main only) derives the service
// key from SUPABASE_ACCESS_TOKEN through the Management API and never prints it.
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIR = join(ROOT, "public", "engine");
const BUCKET = "engine";

/** The index for the committed wheels. Exported for the test. */
export function buildIndex(dir = DIR, now = new Date()) {
  const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
  const files = readdirSync(dir).filter((f) => f.endsWith(".whl")).sort();
  const missing = (manifest.wheels ?? []).filter((w) => !files.includes(w));
  if (missing.length) throw new Error(`manifest names wheels that are not in ${dir}: ${missing.join(", ")}`);
  return {
    engine_version: String(manifest.engine_version),
    published_at: now.toISOString(),
    wheels: (manifest.wheels ?? files).map((file) => {
      const body = readFileSync(join(dir, file));
      return { file, sha256: createHash("sha256").update(body).digest("hex"), bytes: statSync(join(dir, file)).size };
    }),
  };
}

async function upload(base, key, path, body, contentType, upsert) {
  const r = await fetch(`${base}/storage/v1/object/${BUCKET}/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      apikey: key,
      "Content-Type": contentType,
      "x-upsert": upsert ? "true" : "false",
    },
    body,
  });
  if (r.ok) return "uploaded";
  const text = await r.text();
  // A wheel that already exists at its content-addressed path IS this file.
  if (!upsert && (r.status === 409 || /already exists|Duplicate/i.test(text))) return "exists";
  throw new Error(`upload ${path} failed: HTTP ${r.status} ${text.slice(0, 200)}`);
}

async function main() {
  const index = buildIndex();
  if (process.argv.includes("--dry-run")) {
    console.log(JSON.stringify(index, null, 2));
    return;
  }
  const base = (process.env.SUPABASE_URL ?? "").replace(/\/$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!base || !key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required (or --dry-run)");
  for (const w of index.wheels) {
    const how = await upload(base, key, `${w.sha256.slice(0, 16)}/${w.file}`, readFileSync(join(DIR, w.file)),
      "application/octet-stream", false);
    console.log(`${how}: ${BUCKET}/${w.sha256.slice(0, 16)}/${w.file} (${w.bytes} bytes, sha256 ${w.sha256.slice(0, 12)}…)`);
  }
  await upload(base, key, "index.json", JSON.stringify(index, null, 2), "application/json", true);
  console.log(`published ${BUCKET}/index.json → engine ${index.engine_version}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => {
    console.error(String(e?.message ?? e));
    process.exit(1);
  });
}
