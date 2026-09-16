#!/usr/bin/env node
// D35 · fail a pull request while the branch it would merge into is red.
//
// §16 records this failure four times: `5c7129f`, the WP 1.4 merge, the #193/#194
// reconcile, and #200. Detection was never missing — `data-contract.yml` went red
// at `3bf44aa`, `53119da` and `55249d0` exactly as designed. What was missing is
// a consequence: three further merges went in over an already-red `main`, each
// inheriting the breakage rather than causing it, and nothing on the pull request
// said so.
//
// The conventional answer, a required status check, IS NOT AVAILABLE on this
// repository: private, personal-account, on a plan where both
// `/branches/main/protection` and `/rulesets` answer 403 "Upgrade to GitHub Pro
// or make this repository public". Measured 2026-09-16, not assumed. So the
// consequence has to be a check, and this is it.
//
// A MISSING RUN FAILS. That is the second half of D35 and it is not a detail:
// a pull request opened by an app token raises no `pull_request` event, so the
// gate never ran, and a check that never ran looks exactly like one that passed.
// Here, "no completed run on the base branch" is an ERROR with its own message,
// never a pass and never a skip.

const token = process.env.GH_TOKEN;
const repo = process.env.REPO;
const base = process.env.BASE || "main";
const workflow = "data-contract.yml";

if (!token || !repo) {
  fail("GH_TOKEN and REPO must be set — this job cannot verify anything without them");
}

async function api(path) {
  const r = await fetch(`https://api.github.com/repos/${repo}${path}`, {
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
    },
  });
  if (!r.ok) fail(`GET ${path} → ${r.status} ${(await r.text()).slice(0, 300)}`);
  return r.json();
}

function fail(message) {
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
}

const runs = await api(
  `/actions/workflows/${workflow}/runs` +
    `?branch=${encodeURIComponent(base)}&status=completed&per_page=10`,
);

// Only the `push` event tells us about the BRANCH. A `pull_request` run on the
// same workflow measures a merge preview of somebody else's branch, and counting
// it as the base's own health is how a red `main` reads as green.
const onBase = (runs.workflow_runs || []).filter((r) => r.event === "push");

if (!onBase.length) {
  fail(
    `no completed \`data contract\` run on \`${base}\` to check against.\n` +
      `  A gate with no run is not a gate that passed. Push to \`${base}\`, or run\n` +
      `  the workflow on it manually, before merging anything into it.`,
  );
}

const latest = onBase[0];
if (latest.conclusion !== "success") {
  fail(
    `\`${base}\` is ${latest.conclusion} at ${latest.head_sha.slice(0, 7)} — ` +
      `merging into it inherits the breakage.\n` +
      `  ${latest.html_url}\n` +
      `  Fix \`${base}\` first. This is PLAN.md §4 D35; it has happened four times.`,
  );
}

console.log(
  `✓ \`${base}\` is green at ${latest.head_sha.slice(0, 7)} (run ${latest.id})\n` +
    `  ${latest.html_url}`,
);
