// Documentation registry — the single source of truth for the /help docs site.
// Drives the left nav tree, breadcrumbs, prev/next pager, related links, and
// search. Each `slug` matches a key in DOC_BODIES (src/pages/About.tsx).

export type DocPage = {
  slug: string;
  title: string;
  /** Short blurb used in search results. */
  summary?: string;
  /** Extra search keywords (space-separated). */
  keywords?: string;
  /** Slugs of related pages, shown in the right rail. */
  related?: string[];
};

export type DocGroup = {
  group: string;
  pages: DocPage[];
};

export const DOC_GROUPS: DocGroup[] = [
  {
    group: "Overview",
    pages: [
      { slug: "overview", title: "What is this tool", summary: "The Digital Supply Chain Twin at a glance.", keywords: "dsct digital twin preview experiment", related: ["workflow", "des-model"] },
      { slug: "user-stories", title: "User stories", summary: "Who uses the platform and why.", keywords: "planner manager roles", related: ["overview", "use-cases"] },
      { slug: "accurate", title: "ACCURATE project & MaaS", summary: "Horizon Europe project and the marketplace layer.", keywords: "horizon europe pilots marketplace maas", related: ["pilots"] },
    ],
  },
  {
    group: "For Users",
    pages: [
      { slug: "workflow", title: "Planner workflow", summary: "The six-step end-to-end workflow.", keywords: "steps data manager network simulation lab", related: ["use-cases", "overview"] },
      { slug: "use-cases", title: "Use cases by page", summary: "What each page in the app is for.", keywords: "data manager network policies simulation intelligence", related: ["workflow"] },
      { slug: "pilots", title: "Pilot scenarios", summary: "Airbus, Continental and Tronico disruption scenarios.", keywords: "airbus continental tronico disruption", related: ["accurate", "experiments"] },
    ],
  },
  {
    group: "SCSIM simulation",
    pages: [
      { slug: "des-model", title: "Engine & phase pipeline", summary: "The scsim engine, mechanics vs policies, and the weekly phase pipeline.", keywords: "scsim engine phase pipeline mechanics mto warm start disruption", related: ["sim-params", "policies", "distributions"] },
      { slug: "sim-params", title: "Simulation parameters", summary: "The complete variable dictionary, grouped by entity.", keywords: "parameters variables dictionary settings product supplier material", related: ["distributions", "des-model"] },
      { slug: "distributions", title: "Probability distributions", summary: "Triangular, triangularAV, Poisson, negbin, lognormal, gamma, normal.", keywords: "triangular triangularav average variability poisson negbin lognormal gamma normal distribution enums", related: ["sim-params", "stats"] },
      { slug: "policies", title: "Supply chain policies", summary: "The 22-policy catalog with formulas, hooks and parameters.", keywords: "policies inventory min-max safety stock production overtime sourcing backup expediting", related: ["des-model", "sim-params"] },
      { slug: "network-sci", title: "Network science", summary: "Structural metrics and nexus materials.", keywords: "centrality degree betweenness eigenvector nexus", related: ["des-model", "experiments"] },
      { slug: "stats", title: "Statistical methods", summary: "Seed tree, CRN, warmup, bootstrap, stopping.", keywords: "statistics crn seed bootstrap warmup mser conway replications", related: ["distributions", "kpis", "experiments"] },
      { slug: "kpis", title: "KPIs & Resilience Index", summary: "KPI dictionary, cost of resilience, TTR/TTS, Resilience Index.", keywords: "kpi fill rate cost resilience ttr tts resilience index", related: ["stats", "experiments"] },
      { slug: "experiments", title: "Synergy, stress & performance", summary: "Portfolio synergy, the stress-test battery, performance and roadmap.", keywords: "synergy stress test performance roadmap portfolio", related: ["stats", "policies"] },
    ],
  },
  {
    group: "For IT",
    pages: [
      { slug: "tldr", title: "TL;DR", summary: "Supabase stores, Fly.io computes, Realtime delivers.", keywords: "supabase fly realtime architecture", related: ["boundary", "flow"] },
      { slug: "boundary", title: "System boundary", summary: "System 1 (realtime) vs System 2 (legacy).", keywords: "system boundary legacy", related: ["tldr", "flow"] },
      { slug: "flow", title: "Realtime flow", summary: "The realtime simulation architecture diagram.", keywords: "architecture diagram redis worker", related: ["tldr", "contract"] },
      { slug: "contract", title: "Command contract", summary: "The sim-command request schema and command kinds.", keywords: "command contract zod schema", related: ["flow", "persistence"] },
      { slug: "persistence", title: "Persistence model", summary: "What lives in Supabase, Redis, Fly.io RAM and Realtime.", keywords: "persistence supabase redis postgres", related: ["security", "tldr"] },
      { slug: "security", title: "Security model", summary: "RLS, JWT, service role and secrets.", keywords: "security rls jwt service role", related: ["persistence"] },
      { slug: "state", title: "Current state", summary: "Honest status of the realtime worker and engine.", keywords: "status stub worker phase", related: ["des-model", "tldr"] },
    ],
  },
  {
    group: "Reference",
    pages: [
      { slug: "glossary", title: "Glossary", summary: "Plain-language definitions across all domains.", keywords: "glossary definitions terms", related: ["overview"] },
    ],
  },
];

export const ALL_PAGES: (DocPage & { group: string })[] = DOC_GROUPS.flatMap((g) =>
  g.pages.map((p) => ({ ...p, group: g.group })),
);

export const DEFAULT_SLUG = "overview";

export function getPage(slug: string | undefined) {
  return ALL_PAGES.find((p) => p.slug === slug);
}

export function prevNext(slug: string) {
  const i = ALL_PAGES.findIndex((p) => p.slug === slug);
  return {
    prev: i > 0 ? ALL_PAGES[i - 1] : undefined,
    next: i >= 0 && i < ALL_PAGES.length - 1 ? ALL_PAGES[i + 1] : undefined,
  };
}

export function searchPages(query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return ALL_PAGES.filter((p) => {
    const hay = `${p.title} ${p.group} ${p.summary ?? ""} ${p.keywords ?? ""}`.toLowerCase();
    return q.split(/\s+/).every((term) => hay.includes(term));
  }).slice(0, 8);
}
