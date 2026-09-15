// /help/<old-slug> → /docs/<new-slug>.
//
// The archived site (docs/archive/legacy-help-site/) had its own slugs, and
// /help has routed to NotFound since before it was archived — so nothing in
// the product links here. External bookmarks and citations are another matter,
// and a 404 is a bad answer to a URL someone wrote down.
//
// Only unambiguous successors are mapped. Where the old page has no single
// heir (the simulation-parameter dump, the distribution tables — both now
// rendered from the engine registry instead) the reader lands on the manual's
// front page, which is a better answer than an arbitrary one.
//
// `registry.test.ts` asserts every target below is a real page, so this map
// cannot rot into a set of redirects to nowhere.

export const LEGACY_SLUGS: Record<string, string> = {
  overview: "what-suresuite-is",
  "user-stories": "what-suresuite-is",
  accurate: "what-suresuite-is",
  workflow: "your-first-project",
  "use-cases": "your-first-project",
  pilots: "stress-tests",
  "des-model": "how-suresuite-is-designed",
  policies: "policy-catalog",
  "network-sci": "network-science-metrics",
  stats: "seeds-replications-confidence",
  kpis: "kpis-and-resilience-index",
  experiments: "experiments-and-comparison",
  tldr: "system-boundary",
  "data-flow": "how-your-data-flows",
  boundary: "system-boundary",
  flow: "system-boundary",
  contract: "endpoints-and-schemas",
  persistence: "system-boundary",
  security: "who-can-see-your-data",
  state: "known-limits",
  glossary: "glossary",
};
