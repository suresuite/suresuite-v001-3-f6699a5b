// Scratch-Postgres harness for the deterministic tier's DB-backed tests
// (ai-agents.md §7.4 tier 1: state-machine preconditions, idempotency, ACLs).
// Boots a throwaway cluster with initdb/pg_ctl (no sudo, no network), applies
// the real migration files, and shells SQL through psql — so the tests run
// against the exact SQL that ships, not a TypeScript imitation.
//
// If no Postgres binaries are found the caller decides whether to skip
// (local dev without PG) or fail (CI sets EVAL_REQUIRE_DB=1).

export interface ScratchDb {
  sql(query: string, opts?: { role?: string }): Promise<string>;
  /** Runs a statement that MUST fail; returns the error text. */
  sqlExpectError(query: string, opts?: { role?: string }): Promise<string>;
  applyFile(path: string | URL): Promise<void>;
  stop(): Promise<void>;
}

// Postgres refuses to run as root (some sandboxes are root; CI runners are
// not). When root, drop to an unprivileged user via runuser. Root detection
// shells `id -u` so no extra Deno permissions are needed.
let cachedUser: string | null | undefined;
async function detectRunAsUser(): Promise<string | null> {
  if (cachedUser !== undefined) return cachedUser;
  const id = await rawRun("id", ["-u"]).catch(() => null);
  cachedUser = id && id.code === 0 && id.stdout.trim() === "0" ? "postgres" : null;
  return cachedUser;
}
function runAsUser(): string | null {
  return cachedUser ?? null;
}

async function rawRun(cmd: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const out = await new Deno.Command(cmd, { args, stdout: "piped", stderr: "piped" }).output();
  const dec = new TextDecoder();
  return { code: out.code, stdout: dec.decode(out.stdout), stderr: dec.decode(out.stderr) };
}

function wrapUser(cmd: string, args: string[]): [string, string[]] {
  const user = runAsUser();
  return user ? ["runuser", ["-u", user, "--", cmd, ...args]] : [cmd, args];
}

async function run(cmd: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const [c, a] = wrapUser(cmd, args);
  return rawRun(c, a);
}

async function findPgBinDir(): Promise<string | null> {
  const explicit = Deno.env.get("PG_BIN_DIR");
  if (explicit) return explicit;
  const candidates: string[] = [];
  try {
    for await (const e of Deno.readDir("/usr/lib/postgresql")) {
      if (e.isDirectory) candidates.push(`/usr/lib/postgresql/${e.name}/bin`);
    }
  } catch { /* not a debian layout */ }
  candidates.sort().reverse(); // newest major first
  for (const dir of candidates) {
    try {
      await Deno.stat(`${dir}/initdb`);
      return dir;
    } catch { /* keep looking */ }
  }
  const which = await rawRun("which", ["initdb"]).catch(() => null);
  if (which && which.code === 0 && which.stdout.trim()) {
    return which.stdout.trim().replace(/\/initdb$/, "");
  }
  return null;
}

export async function startScratchPostgres(): Promise<ScratchDb | null> {
  await detectRunAsUser();
  const bin = await findPgBinDir();
  if (!bin) return null;

  const workDir = await Deno.makeTempDir({ prefix: "suresuite-eval-pg-" });
  const dataDir = `${workDir}/data`;
  const port = 54_300 + Math.floor(Math.random() * 200);

  // Hand the workspace to the unprivileged user when we had to drop root.
  const user = runAsUser();
  if (user) {
    const chown = await rawRun("chown", ["-R", user, workDir]);
    if (chown.code !== 0) {
      console.warn("[eval-pg] chown failed:", chown.stderr.slice(0, 200));
      return null;
    }
  }

  const init = await run(`${bin}/initdb`, ["-D", dataDir, "-U", "postgres", "-A", "trust", "--no-sync"]);
  if (init.code !== 0) {
    console.warn("[eval-pg] initdb failed:", init.stderr.slice(0, 400));
    return null;
  }
  const start = await run(`${bin}/pg_ctl`, [
    "-D", dataDir, "-w", "-l", `${workDir}/pg.log`,
    "-o", `-p ${port} -k ${workDir} -c listen_addresses='' -c fsync=off`,
    "start",
  ]);
  if (start.code !== 0) {
    console.warn("[eval-pg] pg_ctl start failed:", start.stderr.slice(0, 400));
    return null;
  }

  const psqlBase = ["-h", workDir, "-p", String(port), "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-X", "-q", "-tA"];

  const exec = async (args: string[], stdin?: string) => {
    const [c, a] = wrapUser(`${bin}/psql`, [...psqlBase, ...args]);
    const cmd = new Deno.Command(c, {
      args: a,
      stdin: stdin === undefined ? "null" : "piped",
      stdout: "piped",
      stderr: "piped",
    });
    const child = cmd.spawn();
    if (stdin !== undefined) {
      const w = child.stdin.getWriter();
      await w.write(new TextEncoder().encode(stdin));
      await w.close();
    }
    const out = await child.output();
    const dec = new TextDecoder();
    return { code: out.code, stdout: dec.decode(out.stdout), stderr: dec.decode(out.stderr) };
  };

  const wrap = (query: string, role?: string) =>
    role ? `SET ROLE ${role};\n${query}` : query;

  const db: ScratchDb = {
    async sql(query, opts) {
      const r = await exec(["-f", "-"], wrap(query, opts?.role));
      if (r.code !== 0) {
        throw new Error(`psql failed (${r.code}): ${r.stderr.trim().slice(0, 600)}\n-- query --\n${query.slice(0, 400)}`);
      }
      return r.stdout.trim();
    },
    async sqlExpectError(query, opts) {
      const r = await exec(["-f", "-"], wrap(query, opts?.role));
      if (r.code === 0) {
        throw new Error(`expected error but statement succeeded:\n${query.slice(0, 400)}`);
      }
      return r.stderr.trim();
    },
    async applyFile(path) {
      const p = path instanceof URL ? path.pathname : path;
      const r = await exec(["-f", p]);
      if (r.code !== 0) {
        throw new Error(`migration ${p} failed: ${r.stderr.trim().slice(0, 800)}`);
      }
    },
    async stop() {
      await run(`${bin}/pg_ctl`, ["-D", dataDir, "-m", "immediate", "stop"]).catch(() => null);
      await Deno.remove(workDir, { recursive: true }).catch(() => null);
    },
  };
  return db;
}
