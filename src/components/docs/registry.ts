// Documentation registry — the single source of truth for the /docs manual.
// Drives the left nav tree, breadcrumbs, prev/next pager, related links, and
// search. Page bodies are React Router children rendered through DocsLayout's
// <Outlet/>; `src/components/docs/bodies/index.ts` maps each slug to its body.
//
// THE TREE IS THE WHOLE SITE MAP, NOT THE SHIPPED PART OF IT.
// Every page in PLAN.md §6.3 is here from the start, each carrying the work
// package that ships it. A page whose body has not been written yet renders as
// a stub NAMING that package — never a dead link, never silently absent. That
// is §5.3 T3 (we publish our own blind spots) applied to the manual's own
// table of contents, and it is what makes WP 5.2b…5.2h drop-ins: a later
// package writes a body and flips `status`, and the nav, the pager and the
// search index already know about it.
//
// WP 5.2a (PLAN.md §12) authored the tree and the bodies of sections 1 and 2.

export type DocStatus =
  /** The body is written and routed. */
  | "live"
  /** In the site map, owed by `wp`. Renders as a stub that says so. */
  | "planned";

export type DocPage = {
  slug: string;
  title: string;
  /** Short blurb used in search results and on stub pages. */
  summary?: string;
  /** Extra search keywords (space-separated). */
  keywords?: string;
  /** Slugs of related pages, shown in the right rail. */
  related?: string[];
  status: DocStatus;
  /** The work package that ships this page. Required while `planned`. */
  wp?: string;
  /**
   * The contract table this page is the reference for, where it is one.
   *
   * This is a CROSS-REFERENCE, not data: §6.3 titles pages for the reader
   * ("Deep-Tier Nodes"), not for the schema (`network_nodes`), so the pairing
   * between the two is an editorial decision that cannot be derived by
   * transforming a string. Everything the page then SAYS about the table —
   * every column, unit and constraint — is read from the contract through
   * this key and never typed here.
   *
   * `registry.test.ts` fails on a name the schema does not have, so the
   * association cannot rot silently the way a hand-copied column list does.
   */
  table?: string;
  /**
   * How the page's facts are produced, per §6.3's legend:
   *   "contract" — G,  generated from the data contract
   *   "registry" — G*, generated from the engine registry (gen_docs.py)
   *   undefined  — W,  written once, a fact that exists nowhere else
   */
  source?: "contract" | "registry";
};

export type DocGroup = {
  /** §6.3's section number. */
  section: number;
  group: string;
  /** One line on what the section answers, shown at the top of a stub. */
  blurb: string;
  pages: DocPage[];
};

const planned = (wp: string) => ({ status: "planned" as const, wp });
const live = { status: "live" as const };

export const DOC_GROUPS: DocGroup[] = [
  {
    section: 1,
    group: "Overview & architecture",
    blurb: "How the software is put together, and whether you can trust it.",
    pages: [
      {
        ...live,
        slug: "what-suresuite-is",
        title: "What SuReSuite is",
        summary: "The tool in one page — the problem it solves and what it produces.",
        keywords: "overview introduction digital twin dsct supply chain resilience accurate horizon europe",
        related: ["how-suresuite-is-designed", "known-limits", "your-first-project"],
      },
      {
        ...live,
        slug: "how-suresuite-is-designed",
        title: "How SuReSuite is designed",
        summary: "The six tiers as the journey your data takes, and the three laws that govern it.",
        keywords: "architecture tiers design laws staging canonical derived decisions results governance",
        related: ["how-your-data-flows", "data-model", "system-boundary"],
      },
      {
        ...live,
        slug: "data-model",
        title: "The data model at a glance",
        summary: "Every table in the system on one page, grouped by tier.",
        keywords: "tables schema data model tiers reference map contract coverage",
        related: ["how-suresuite-is-designed", "all-tables", "inbound-logistics"],
        source: "contract",
      },
      {
        ...live,
        slug: "how-your-data-flows",
        title: "How your data flows",
        summary: "Upload, check, promote, compute, decide, simulate, stamp — one paragraph per hop.",
        keywords: "flow pipeline upload validate promote compute simulate results lifecycle",
        related: ["how-suresuite-is-designed", "uploading-data", "what-happens-to-your-data"],
      },
      {
        ...live,
        slug: "what-happens-to-your-data",
        title: "What happens to your data",
        summary: "The five commitments in plain language — and what each one means you can check.",
        keywords: "transparency commitments privacy substitution provenance export delete ownership",
        related: ["known-limits", "how-your-data-flows", "who-can-see-your-data"],
      },
      {
        ...live,
        slug: "system-boundary",
        title: "System boundary",
        summary: "What runs where — browser, Supabase, simulation worker, engine — and what crosses each line.",
        keywords: "boundary it security architecture supabase fly worker scsim browser deployment",
        related: ["how-suresuite-is-designed", "who-can-see-your-data", "what-happens-to-your-data"],
      },
      {
        ...live,
        slug: "known-limits",
        title: "Known limits",
        summary: "What this tool does not model, stated before you rely on it.",
        keywords: "limits limitations caveats steady state graph hash price volatility blind spots",
        related: ["what-happens-to-your-data", "how-suresuite-is-designed", "verify-your-inputs"],
      },
    ],
  },
  {
    section: 2,
    group: "Getting started",
    blurb: "From an empty account to a first set of results.",
    pages: [
      {
        ...live,
        slug: "your-first-project",
        title: "Your first project",
        summary: "End to end: create, upload, verify, set policies, simulate, read results.",
        keywords: "getting started tutorial walkthrough first project quickstart steps",
        related: ["projects", "uploading-data", "verify-your-inputs"],
      },
      {
        ...live,
        slug: "projects",
        table: "projects",
        title: "Projects",
        summary: "The container everything else hangs off — plant, BOM level, simulation window.",
        keywords: "projects plants container bom level simulation window completion project manager",
        related: ["your-first-project", "uploading-data", "organizations-and-members"],
      },
      {
        ...live,
        slug: "uploading-data",
        title: "Uploading data",
        summary: "The upload wizard, what is checked, and what gets rejected and why.",
        keywords: "upload wizard csv template import validate reject headers files",
        related: ["your-first-project", "verify-your-inputs", "inbound-logistics"],
      },
    ],
  },
  {
    section: 3,
    group: "Input tables",
    blurb: "The data you provide. One page per table, leading with the header you type.",
    pages: [
      { ...live, slug: "inbound-logistics", table: "inbound_logistics", title: "Inbound Logistics", summary: "Supply arcs: which supplier delivers which material, at what price and lead time.", keywords: "inbound logistics supplier material volume lead time unit price csv", source: "contract" },
      { ...live, slug: "outbound-logistics", table: "outbound_logistics", title: "Outbound Logistics", summary: "Demand arcs: which customer buys which product, at what price and lead time.", keywords: "outbound logistics customer product volume expected lead time unit price csv", source: "contract" },
      { ...live, slug: "bom-single-level", table: "bom_single_level", title: "BOM — single level", summary: "How much of each material one unit of a product consumes.", keywords: "bom bill of materials single level product material consumption rate", source: "contract" },
      { ...live, slug: "bom-multi-level", table: "bom_multi_level", title: "BOM — multi level", summary: "The deep bill of materials, level by level.", keywords: "bom bill of materials multi level higher level component consumption rate depth", source: "contract" },
      { ...live, slug: "materials", table: "materials", title: "Materials", summary: "The economics the simulation reads for each material.", keywords: "materials cost holding cost moq initial on hand lead time distribution cv", source: "contract" },
      { ...live, slug: "products", table: "products", title: "Products", summary: "Price, capacity, fulfilment mode and the shape of demand.", keywords: "products sell price production capacity fulfillment mode demand distribution mean cv", source: "contract" },
      { ...live, slug: "suppliers", table: "suppliers", title: "Suppliers", summary: "Capacity and reliability, beyond the arcs that connect a supplier to materials.", keywords: "suppliers capacity per week reliability score", source: "contract" },
      { ...live, slug: "node-list", table: "node_list", title: "Node List", summary: "Named locations and their coordinates.", keywords: "node list location longitude latitude description map", source: "contract" },
      { ...live, slug: "deep-tier-nodes", table: "network_nodes", title: "Deep-Tier Nodes", summary: "Firms discovered beyond tier one, with the attributes known about each.", keywords: "network nodes deep tier firm depth country industry employees revenue seed", source: "contract" },
      { ...live, slug: "deep-tier-edges", table: "network_edges", title: "Deep-Tier Edges", summary: "Relationships between deep-tier firms, and their direction.", keywords: "network edges deep tier relation type relative revenue direction depth", source: "contract" },
      { ...live, slug: "multi-tier-suppliers", table: "multi_tier_supply_chain", title: "Multi-Tier Suppliers", summary: "The firm-to-firm supply relationships that make up the deep chain.", keywords: "multi tier supply chain from firm to firm tier relationship", source: "contract" },
      { ...live, slug: "units-and-time-periods", title: "Units and time periods", summary: "The page that settles time_unit against lead_time, once.", keywords: "units time period week day lead time unit conversion normalization" },
    ],
  },
  {
    section: 4,
    group: "Computed tables",
    blurb: "What we build from your data. Always rebuildable, never edited by hand.",
    pages: [
      { ...live, slug: "supply-chain-data", table: "supply_chain_data", title: "Supply Chain Data", summary: "How sourcing shares and consumption rates are derived.", keywords: "supply chain data sourcing ratio weighted material consumption rate etl", source: "contract" },
      { ...live, slug: "multi-tier-data", table: "supply_chain_data_multi_tier", title: "Multi-Tier Data", summary: "How tiers are expanded into paths.", keywords: "multi tier data level path root expansion", source: "contract" },
      { ...live, slug: "network-summary", table: "network_summary", title: "Network Summary", summary: "Cartographer output and the evidence behind it.", keywords: "network summary external evidence cartographer", source: "contract" },
      { ...live, slug: "dataset-versions", table: "dataset_versions", title: "Dataset Versions", summary: "The graph hash, the snapshot, and why a version changes.", keywords: "dataset versions graph hash snapshot trust anchor reproducibility", source: "contract" },
    ],
  },
  {
    section: 5,
    group: "Policies",
    blurb: "The decisions you make about how the chain should behave.",
    pages: [
      { ...live, slug: "how-policies-work", title: "How policies work", summary: "Stages, scope, and defaults against overrides.", keywords: "policies stages scope defaults overrides bundle patch" },
      { ...live, slug: "supplier-stage", title: "Supplier stage", summary: "Every column of the supplier policy grid.", keywords: "supplier stage policy grid columns sourcing backup expediting", source: "contract" },
      { ...live, slug: "plant-stage", title: "Plant stage", summary: "Every column of the plant policy grid.", keywords: "plant stage policy grid columns production capacity overtime inventory", source: "contract" },
      { ...live, slug: "customer-stage", title: "Customer stage", summary: "Every column of the customer policy grid.", keywords: "customer stage policy grid columns fulfilment allocation service", source: "contract" },
      { ...live, slug: "policy-types", title: "Policy types", summary: "Min/max, base stock, ROP-Q and periodic review, and when each applies.", keywords: "policy types min max base stock rop q reorder point periodic review inventory", source: "registry" },
      { ...live, slug: "policy-catalog", title: "The policy catalog", summary: "Every policy in the catalog, by stage.", keywords: "policy catalog supplier plant transport customer forecasting cross cutting", source: "registry" },
      { ...live, slug: "where-a-number-came-from", title: "Where a number came from", summary: "The provenance dots, and what each one is telling you.", keywords: "provenance dots source derived default substitution colour grid" },
      { ...live, slug: "when-a-value-is-missing", title: "When a value is missing", summary: "Every substitution the system will make, and how it is marked.", keywords: "missing value substitution fallback default derived chain grade", source: "contract" },
      { ...live, slug: "policy-versions-and-presets", title: "Policy versions & presets", summary: "Saving, reusing and comparing policy sets.", keywords: "policy versions presets save reuse compare snapshot" },
    ],
  },
  {
    section: 6,
    group: "Verification",
    blurb: "How to tell whether the model you have built can be believed.",
    pages: [
      { ...live, slug: "verify-your-inputs", title: "Verify your inputs", summary: "Block, warn and info findings — and how to clear each one.", keywords: "verify validation findings block warn info grading clear errors" },
      { ...live, slug: "data-trust-report", title: "Data Trust Report", summary: "Coverage, freshness, ingest history and known limits in one artifact.", keywords: "data trust report coverage freshness ingest history staleness" },
      { ...live, slug: "model-validation", title: "Model validation", summary: "Checking the model against what actually happened.", keywords: "model validation backtest comparison actuals" },
    ],
  },
  {
    section: 7,
    group: "Experiments & scenarios",
    blurb: "Asking what would happen, and getting an answer you can defend.",
    pages: [
      { ...live, slug: "simulation-lab", title: "Simulation Lab — running an experiment", summary: "Preview and experiment modes, and what each produces.", keywords: "simulation lab run experiment preview replications jobs" },
      { ...live, slug: "scenarios", title: "Scenarios", summary: "Saving and reusing a set of conditions.", keywords: "scenarios templates sim scenarios saved conditions" },
      { ...live, slug: "disruptions", title: "Disruptions", summary: "Profiles, settings, targets and effects.", keywords: "disruption scenarios profiles settings targets effects shock outage" },
      { ...live, slug: "recovery-playbooks", title: "Recovery playbooks", summary: "What the chain does once something has gone wrong.", keywords: "recovery playbooks response mitigation strategy" },
      { ...live, slug: "experiments-and-comparison", title: "Experiments & comparison", summary: "Ranking strategies against each other.", keywords: "experiments comparison compare ranking portfolio synergy" },
      { ...live, slug: "seeds-replications-confidence", title: "Seeds, replications & confidence", summary: "Why the same run gives a range, and how wide that range is.", keywords: "seeds replications confidence intervals crn warmup bootstrap statistics", source: "registry" },
      { ...live, slug: "stress-tests", title: "Stress tests", summary: "The standing stress-test battery and what each one probes.", keywords: "stress tests battery st1 st7 robustness" },
    ],
  },
  {
    section: 8,
    group: "Networks",
    blurb: "Seeing the chain's structure, and what the structure implies.",
    pages: [
      { ...live, slug: "product-level-network", title: "Product-Level Network", summary: "Supplier to material to product to customer.", keywords: "product level network graph view material product flow" },
      { ...live, slug: "process-level-network", title: "Process-Level Network", summary: "The shop-floor view, level by level.", keywords: "process level network shop floor bom levels" },
      { ...live, slug: "firm-level-network", title: "Firm-Level Network", summary: "The deep-tier firm graph.", keywords: "firm level network deep tier firms suppliers graph" },
      { ...live, slug: "interactive-network-space", title: "Interactive Network Space", summary: "Exploring the chain without a fixed layout.", keywords: "interactive network space explore layout canvas" },
      { ...live, slug: "network-science-metrics", title: "Network science metrics", summary: "Centrality, prominence and critical-node prediction — what each means.", keywords: "centrality degree betweenness eigenvector prominence critical node nexus material" },
    ],
  },
  {
    section: 9,
    group: "Project Intelligence",
    blurb: "The assistant, what it can see, and what it is allowed to change.",
    pages: [
      { ...live, slug: "ai-assistant", title: "The AI assistant", summary: "What it can see and what it can do.", keywords: "ai assistant chat threads messages folders intelligence" },
      { ...live, slug: "plans-and-proposals", title: "Plans and proposals", summary: "Review before apply — nothing changes without your say.", keywords: "plans proposals review apply approve changes" },
      { ...live, slug: "project-memory", title: "Project memory", summary: "What the assistant remembers between conversations.", keywords: "project memory context recall persistence" },
      { ...live, slug: "models-budgets-limits", title: "Models, budgets and limits", summary: "Which models run, what they cost, and who may use them.", keywords: "ai models budgets usage logs permissions limits spend" },
    ],
  },
  {
    section: 10,
    group: "Connectors",
    blurb: "Getting data in from a system you already run.",
    pages: [
      { ...live, slug: "connecting-erp", title: "Connecting an ERP / MRP system", summary: "Linking a project to a system of record.", keywords: "erp mrp connector link integration orbit oauth" },
      { ...live, slug: "reviewing-a-sync", title: "Reviewing and applying a sync", summary: "Seeing what changed before it lands.", keywords: "sync runs staged review apply diff promote" },
      { ...live, slug: "csv-vs-connector", title: "CSV or connector — which to use", summary: "The trade-off, stated plainly.", keywords: "csv connector choice comparison upload integration" },
    ],
  },
  {
    section: 11,
    group: "Results & statistics",
    blurb: "Reading what came back, and knowing how much of it is signal.",
    pages: [
      { ...live, slug: "reading-your-results", title: "Reading your results", summary: "What a run produces and how to interpret it.", keywords: "results runs replications interpret read output", source: "registry" },
      { ...live, slug: "kpis-and-resilience-index", title: "KPIs & the Resilience Index", summary: "Every KPI, its definition and its unit.", keywords: "kpi fill rate cost of resilience ttr tts resilience index service level", source: "registry" },
      { ...live, slug: "per-item-time-series", title: "Per-item time series", summary: "What happened to one material, week by week.", keywords: "time series per item weekly inventory backlog series", source: "registry" },
      { ...live, slug: "performance-and-caching", title: "Performance & caching", summary: "Why a second run is faster, and when the cache is dropped.", keywords: "performance caching metrics speed invalidation" },
      { ...live, slug: "reports-and-files", title: "Reports & files", summary: "Rendered reports and where they are kept.", keywords: "reports files render export download user files" },
    ],
  },
  {
    section: 12,
    group: "Exports & reproducibility",
    blurb: "Taking a figure out of the system with its provenance attached.",
    pages: [
      { ...live, slug: "verifiable-exports", title: "Verifiable exports", summary: "The workbooks, and what makes each one checkable.", keywords: "exports workbooks verifiable xlsx download provenance" },
      { ...live, slug: "reproducibility-record", title: "Reproducibility record", summary: "The stamp that lets someone else rerun what you ran.", keywords: "reproducibility record versions dataset policy scenario engine stamp" },
      { ...live, slug: "exporting-and-deleting", title: "Exporting and deleting your data", summary: "Getting everything out, and getting it removed.", keywords: "export delete data removal gdpr portability account" },
    ],
  },
  {
    section: 13,
    group: "Access & administration",
    blurb: "Who can see what, and who decided that.",
    pages: [
      { ...live, slug: "organizations-and-members", table: "organizations", title: "Organizations and members", summary: "The tenant boundary and who sits inside it.", keywords: "organizations members tenant org boundary invite", source: "contract" },
      { ...live, slug: "roles-and-capabilities", title: "Roles and capabilities", summary: "What a role may do, and where that is decided.", keywords: "roles capabilities permissions grants catalog" },
      { ...live, slug: "project-access", title: "Project access", summary: "Membership of a single project, as distinct from the organization.", keywords: "project access members project role delegation" },
      { ...live, slug: "who-can-see-your-data", title: "Who can see your data", summary: "The honest answer, including the parts that are not you.", keywords: "privacy visibility access rls isolation support staff" },
      { ...live, slug: "audit-log", title: "Audit log", summary: "What is recorded, and what is not yet.", keywords: "audit log admin actions history record actor" },
      { ...live, slug: "admin-screens", title: "Admin screens", summary: "The administrative surfaces and what each controls.", keywords: "admin users roles organizations projects models usage screens" },
      { ...live, slug: "account-and-password", title: "Account & password", summary: "Managing your own sign-in.", keywords: "account password profile sign in credentials" },
    ],
  },
  {
    section: 14,
    group: "Developer API",
    blurb: "Driving the platform from your own code.",
    pages: [
      { ...live, slug: "getting-an-api-key", title: "Getting an API key", summary: "Issuing, scoping and revoking a key.", keywords: "api key developer token issue revoke scope" },
      { ...live, slug: "endpoints-and-schemas", title: "Endpoints & schemas", summary: "Every endpoint and the shape it expects.", keywords: "api endpoints schemas request response openapi", source: "contract" },
      { ...live, slug: "rate-limits-and-idempotency", title: "Rate limits & idempotency", summary: "How often you may call, and how to retry safely.", keywords: "rate limits idempotency retry throttle keys" },
      { ...live, slug: "request-log", title: "Request log", summary: "What your key did, and when.", keywords: "request log api history calls audit" },
    ],
  },
  {
    section: 15,
    group: "Reference",
    blurb: "The lookup section — every table, every field, every term.",
    pages: [
      { ...live, slug: "all-tables", title: "All tables", summary: "The detailed index — every column of every described table, and the package that owes the rest.", keywords: "all tables index columns reference schema complete", source: "contract" },
      { ...live, slug: "units-and-conventions", title: "Units & conventions", summary: "Every unit the system uses, and the one place it is defined.", keywords: "units conventions days weeks currency percent normalization", source: "contract" },
      { ...live, slug: "glossary", title: "Glossary", summary: "Plain-language definitions across all domains.", keywords: "glossary definitions terms vocabulary jargon" },
      { ...live, slug: "field-index", title: "Field index", summary: "Every field, A to Z, linking to the table it belongs to.", keywords: "field index alphabetical a to z columns lookup", source: "contract" },
    ],
  },
];

export const ALL_PAGES: (DocPage & { group: string; section: number })[] =
  DOC_GROUPS.flatMap((g) => g.pages.map((p) => ({ ...p, group: g.group, section: g.section })));

export const DEFAULT_SLUG = "what-suresuite-is";

export function getPage(slug: string | undefined) {
  return ALL_PAGES.find((p) => p.slug === slug);
}

export function getGroup(section: number) {
  return DOC_GROUPS.find((g) => g.section === section);
}

/**
 * Prev/next over the pages that actually have a body.
 *
 * The pager is for reading the manual in order, and a pager that lands you on
 * "this page is owed by WP 5.2d" is a pager that wastes a click. Stubs still
 * get neighbours — the nearest live page on either side of where the stub sits
 * in the full tree — so the reader is never stranded.
 */
export function prevNext(slug: string) {
  const i = ALL_PAGES.findIndex((p) => p.slug === slug);
  if (i < 0) return { prev: undefined, next: undefined };
  let prev: (typeof ALL_PAGES)[number] | undefined;
  let next: (typeof ALL_PAGES)[number] | undefined;
  for (let k = i - 1; k >= 0; k--) {
    if (ALL_PAGES[k].status === "live") { prev = ALL_PAGES[k]; break; }
  }
  for (let k = i + 1; k < ALL_PAGES.length; k++) {
    if (ALL_PAGES[k].status === "live") { next = ALL_PAGES[k]; break; }
  }
  return { prev, next };
}

/**
 * Search the whole tree, live pages first.
 *
 * Planned pages are deliberately searchable: someone looking for "fill rate"
 * is better served by "KPIs & the Resilience Index — documented in WP 5.2d"
 * than by "No matches", which reads as "this product has no KPIs".
 */
export function searchPages(query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const terms = q.split(/\s+/);
  return ALL_PAGES.filter((p) => {
    const hay = `${p.title} ${p.group} ${p.summary ?? ""} ${p.keywords ?? ""}`.toLowerCase();
    return terms.every((term) => hay.includes(term));
  })
    .sort((a, b) => Number(b.status === "live") - Number(a.status === "live"))
    .slice(0, 8);
}
