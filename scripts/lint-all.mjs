#!/usr/bin/env node
/**
 * `npm run lint` — all three gates, every time, reporting all three.
 *
 * ── WHAT THIS REPLACED, AND WHY IT MATTERED (§4 D85) ───────────────────────
 *
 *     "lint": "eslint . && npm run audit:ui && npm run check:docs"
 *
 * `eslint .` exits 1 on this repository and has for as long as anyone has
 * looked — 336 errors at the time of writing, mostly `no-explicit-any` and
 * `ban-ts-comment` in edge functions. `&&` short-circuits on that, so
 * `audit:ui` and `check:docs` were UNREACHABLE from the command every
 * contributor runs. Three work packages in a row reported "lint at baseline" on
 * the strength of a command that stopped at its first step.
 *
 * THE FIX IS NOT `;`. D85's own note warns against that, and rightly:
 * `a; b; c` reports the exit code of `c` alone, so a red eslint would start
 * passing — a gate turned off in the name of fixing it. This runs all three,
 * prints each one's own output verbatim, and exits non-zero if ANY failed.
 * Strictly more information, identical verdict.
 *
 * CI is unaffected and always was: `.github/workflows/data-contract.yml`
 * invokes each command directly, and its header comment explains why. This is
 * the local command catching up with what CI already does.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO: make eslint pass, hide its errors, or
 * introduce a baseline threshold. The eslint debt is real and still belongs to
 * whichever package pays it down. What changes is that a contributor now SEES
 * the other two gates instead of never reaching them.
 */
import { spawnSync } from "node:child_process";

const GATES = [
  { name: "eslint", cmd: "npx", args: ["eslint", "."] },
  { name: "audit:ui", cmd: "node", args: ["scripts/audit-adaptive-ui.mjs"] },
  { name: "check:docs", cmd: "node", args: ["scripts/check-docs-single-source.mjs"] },
];

const rule = (label) => `\n== ${label} ${"=".repeat(Math.max(0, 60 - label.length))}\n`;

const results = [];
for (const gate of GATES) {
  process.stdout.write(rule(gate.name));
  const r = spawnSync(gate.cmd, gate.args, {
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  // A gate that could not be STARTED is not a gate that passed. `spawnSync`
  // reports that as `error`, and a signal kill leaves `status` null — neither
  // is zero, and neither should read as success.
  const ok = !r.error && r.status === 0;
  results.push({
    name: gate.name,
    ok,
    detail: r.error ? `could not run: ${r.error.message}` : `exit ${r.status}`,
  });
}

process.stdout.write(rule("summary"));
for (const r of results) {
  process.stdout.write(`  ${r.ok ? "PASS" : "FAIL"}  ${r.name.padEnd(12)}${r.ok ? "" : r.detail}\n`);
}

const failed = results.filter((r) => !r.ok);
if (failed.length) {
  process.stdout.write(
    `\n${failed.length} of ${results.length} gates failed: ${failed.map((r) => r.name).join(", ")}.\n` +
      `All three RAN, which is the point of §4 D85 — a red eslint no longer hides\n` +
      `the other two, and "lint at baseline" now means all three were looked at.\n`,
  );
  process.exit(1);
}
process.stdout.write(`\nall ${results.length} gates pass\n`);
