#!/usr/bin/env node
// Publish the engine wheels to the PRIVATE `engine` storage bucket — Phase 12 · WP 12.4,
// and keep every build installable by version — Phase 15 · WP 15.3 · §4 D295.
//
// `GET /v1/engine` hands an API key short-lived signed URLs to these files, so a
// user's `suresuite.install_engine()` installs exactly the engine the platform
// runs — and, since WP 15.3, `install_engine(version="0.4.0")` installs an older
// one, so a stored result can be re-run on the engine that produced it. The wheels
// are the ones `scripts/build_engine_wheels.sh` commits to `public/engine/` (CI's
// freshness gate keeps them equal to the source).
//
// Writes, per wheel CONTENT:     engine/<sha256[:16]>/<wheel>   (never overwritten, never deleted)
// the pointer to the latest:     engine/index.json             {engine_version, engine_build, commit, wheels[…]}
// and EVERY build ever published: engine/versions.json          {versions: [index, …]} newest first (WP 15.3)
//
// Before WP 15.3 only `index.json` existed and it was upserted to the latest build,
// so a wheel published last week was still in the bucket and nobody could find it
// without already knowing its hash (D295). `versions.json` is append-only: a build
// already listed keeps its first publication.
//
// Usage:
//   node scripts/publish_engine_wheels.mjs --dry-run      # print the index, upload nothing
//   node scripts/publish_engine_wheels.mjs --backfill --dry-run   # every build in git history
//   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… node scripts/publish_engine_wheels.mjs [--backfill]
//
// `--backfill` walks the history of `public/engine/` (it needs a full clone) and
// publishes every committed wheel set as the build it is — named by the SAME
// digest a run records today (`scripts/engine_build_id.py`), so a build from
// before WP 15.1 gets its name retroactively. Wheel uploads are content-addressed
// and skip a file that already exists, so running it twice changes nothing.
//
// CI (`.github/workflows/engine-distribution.yml`, main only) derives the service
// key from SUPABASE_ACCESS_TOKEN through the Management API and never prints it.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIR = join(ROOT, "public", "engine");
const BUCKET = "engine";

const sha256 = (body) => createHash("sha256").update(body).digest("hex");

/** The index for the committed wheels. Exported for the test. */
export function buildIndex(dir = DIR, now = new Date(), commit = process.env.GITHUB_SHA ?? null) {
  const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
  const files = readdirSync(dir).filter((f) => f.endsWith(".whl")).sort();
  const missing = (manifest.wheels ?? []).filter((w) => !files.includes(w));
  if (missing.length) throw new Error(`manifest names wheels that are not in ${dir}: ${missing.join(", ")}`);
  return {
    engine_version: String(manifest.engine_version),
    // WP 15.1 — the build these wheels ARE, by content; null for a manifest older than it.
    engine_build: manifest.engine_build ?? null,
    commit: commit || null,
    published_at: now.toISOString(),
    wheels: (manifest.wheels ?? files).map((file) => {
      const body = readFileSync(join(dir, file));
      return { file, sha256: sha256(body), bytes: statSync(join(dir, file)).size };
    }),
  };
}

/**
 * WP 15.3 — add a build to the list of every build ever published, newest first.
 * A build already listed (same `engine_build`) keeps its FIRST publication: the
 * list is append-only, like the bucket it indexes. Pure; exported for the test.
 */
export function mergeVersions(existing, entry) {
  const versions = Array.isArray(existing?.versions) ? existing.versions.slice() : [];
  const key = (v) => v.engine_build ?? `${v.engine_version}#${v.wheels.map((w) => w.sha256).join(",")}`;
  if (versions.some((v) => key(v) === key(entry))) return { versions };
  return { versions: [entry, ...versions] };
}

// ── --backfill: every wheel set in git history ──────────────────────────────

const git = (...args) => {
  const r = spawnSync("git", args, { cwd: ROOT, maxBuffer: 256 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr.toString().trim()}`);
  return r.stdout;
};

/** One index per commit that changed `public/engine/`, oldest first. */
export function historyIndexes() {
  if (git("rev-parse", "--is-shallow-repository").toString().trim() === "true") {
    throw new Error("--backfill needs the full history (fetch-depth: 0)");
  }
  const commits = git("log", "--reverse", "--format=%H %cI", "--", "public/engine/").toString().trim().split("\n");
  const out = [];
  for (const line of commits) {
    const [commit, date] = line.split(" ");
    const tmp = mkdtempSync(join(tmpdir(), "engine-hist-"));
    try {
      const names = git("ls-tree", "--name-only", commit, "public/engine/").toString().trim().split("\n")
        .map((p) => p.split("/").pop()).filter(Boolean);
      const wheels = names.filter((n) => n.endsWith(".whl")).sort();
      const scsim = wheels.find((w) => w.startsWith("scsim-"));
      const worker = wheels.find((w) => w.startsWith("sim_worker-"));
      if (!scsim || !worker) continue;
      for (const w of wheels) writeFileSync(join(tmp, w), git("show", `${commit}:public/engine/${w}`));
      // Named by the same digest a run records today — loaded from THIS tree's
      // build module, so a historic wheel gets the name today's code would give it.
      const r = spawnSync("python3", [join(ROOT, "scripts", "engine_build_id.py"), "--json", "--lenient",
        join(tmp, scsim), join(tmp, worker)], { cwd: ROOT });
      if (r.status !== 0) {
        console.warn(`skip ${commit.slice(0, 8)}: ${r.stderr.toString().trim().split("\n").pop()}`);
        continue;
      }
      const id = JSON.parse(r.stdout.toString());
      let named = null;
      try {
        named = JSON.parse(git("show", `${commit}:public/engine/manifest.json`).toString()).engine_build ?? null;
      } catch {
        named = null;
      }
      out.push({
        entry: {
          engine_version: id.version,
          engine_build: id.code_version,
          // Named by WP 15.3 from the wheel itself, after the fact, unless the commit's
          // own manifest already named it (WP 15.1 onward): no run before WP 15.1
          // recorded this name — they recorded `scsim-<version>` only.
          named_retroactively: named !== id.code_version,
          commit,
          published_at: new Date(date).toISOString(),
          wheels: wheels.map((file) => {
            const body = readFileSync(join(tmp, file));
            return { file, sha256: sha256(body), bytes: body.length };
          }),
        },
        bodies: Object.fromEntries(wheels.map((w) => [w, readFileSync(join(tmp, w))])),
      });
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }
  return out;
}

// ── storage ─────────────────────────────────────────────────────────────────

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

async function download(base, key, path) {
  const r = await fetch(`${base}/storage/v1/object/${BUCKET}/${path}`, {
    headers: { Authorization: `Bearer ${key}`, apikey: key },
  });
  if (r.status === 400 || r.status === 404) return null;
  if (!r.ok) throw new Error(`download ${path} failed: HTTP ${r.status}`);
  return JSON.parse(await r.text());
}

async function main() {
  const dry = process.argv.includes("--dry-run");
  const backfill = process.argv.includes("--backfill");
  const index = buildIndex();
  const history = backfill ? historyIndexes() : [];
  if (dry) {
    let versions = { versions: [] };
    for (const h of history) versions = mergeVersions(versions, h.entry);
    versions = mergeVersions(versions, index);
    console.log(JSON.stringify(backfill ? versions : index, null, 2));
    return;
  }
  const base = (process.env.SUPABASE_URL ?? "").replace(/\/$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!base || !key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required (or --dry-run)");

  let versions = (await download(base, key, "versions.json")) ?? { versions: [] };
  for (const h of history) {
    for (const w of h.entry.wheels) {
      await upload(base, key, `${w.sha256.slice(0, 16)}/${w.file}`, h.bodies[w.file], "application/octet-stream", false);
    }
    versions = mergeVersions(versions, h.entry);
  }
  if (history.length) console.log(`backfill: ${history.length} committed wheel set(s) walked`);

  for (const w of index.wheels) {
    const how = await upload(base, key, `${w.sha256.slice(0, 16)}/${w.file}`, readFileSync(join(DIR, w.file)),
      "application/octet-stream", false);
    console.log(`${how}: ${BUCKET}/${w.sha256.slice(0, 16)}/${w.file} (${w.bytes} bytes, sha256 ${w.sha256.slice(0, 12)}…)`);
  }
  versions = mergeVersions(versions, index);
  // versions.json BEFORE index.json: a reader that sees the new pointer can always
  // also find it in the full list.
  await upload(base, key, "versions.json", JSON.stringify(versions, null, 2), "application/json", true);
  await upload(base, key, "index.json", JSON.stringify(index, null, 2), "application/json", true);
  console.log(`published ${BUCKET}/index.json → engine ${index.engine_version} (${index.engine_build ?? "build not named"}); ` +
    `${versions.versions.length} build(s) in versions.json`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => {
    console.error(String(e?.message ?? e));
    process.exit(1);
  });
}
