// The engine a library installs — Phase 12 · WP 12.4.
//
// The simulation engine (scsim + sim_worker) is distributed to API users through
// `GET /v1/engine`: a short-lived signed URL per wheel in the PRIVATE `engine`
// storage bucket, with each wheel's SHA-256 so the client can refuse a file that
// is not the one published. `scripts/publish_engine_wheels.mjs` writes the index
// (`engine/index.json`) when it uploads the wheels; this module validates it and
// shapes the response. Pure, so it is testable without storage.
//
// KNOWN EXPOSURE (§4 D274): the browser engine still loads the same wheels from
// `public/engine/` as public static files, so this route gates the pip path, not
// the engine itself.

export interface EngineWheel {
  file: string;
  sha256: string;
  bytes: number;
}

export interface EngineIndex {
  engine_version: string;
  wheels: EngineWheel[];
  published_at: string;
}

const WHEEL = /^[A-Za-z0-9_.-]+-[0-9][A-Za-z0-9_.+-]*-py3-none-any\.whl$/;

/** Parse and validate `engine/index.json`; throws on anything malformed. */
export function parseEngineIndex(raw: unknown): EngineIndex {
  const o = raw as Record<string, unknown>;
  if (!o || typeof o.engine_version !== "string" || !Array.isArray(o.wheels) || o.wheels.length === 0) {
    throw new Error("engine index: engine_version and a non-empty wheels list are required");
  }
  const wheels = (o.wheels as Record<string, unknown>[]).map((w) => {
    if (typeof w.file !== "string" || !WHEEL.test(w.file)) throw new Error(`engine index: bad wheel name ${String(w.file)}`);
    if (typeof w.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(w.sha256)) throw new Error(`engine index: bad sha256 for ${w.file}`);
    if (typeof w.bytes !== "number" || w.bytes <= 0) throw new Error(`engine index: bad size for ${w.file}`);
    return { file: w.file, sha256: w.sha256, bytes: w.bytes };
  });
  return { engine_version: o.engine_version, wheels, published_at: String(o.published_at ?? "") };
}

/** The object path of a wheel in the bucket: content-addressed, because a wheel's
 *  version (sim_worker 0.1.0) need not change when its content does — a path by
 *  version would keep the old file under a new hash. */
export const wheelPath = (w: EngineWheel) => `${w.sha256.slice(0, 16)}/${w.file}`;

export const ENGINE_URL_TTL_SECONDS = 600;

/** The `GET /v1/engine` body, given a signed URL for each wheel. */
export function engineResponse(index: EngineIndex, urls: Record<string, string | null>) {
  return {
    engine_version: index.engine_version,
    published_at: index.published_at,
    expires_in_seconds: ENGINE_URL_TTL_SECONDS,
    wheels: index.wheels.map((w) => ({ ...w, url: urls[w.file] ?? null })),
    install: "pip install <url> for each wheel, after checking its sha256 — or `suresuite.install_engine()`",
  };
}
