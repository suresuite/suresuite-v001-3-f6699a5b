// The §18.5 source registry — shared substrate for B7/B8/B9, landed at
// Phase 4b as versioned configuration (design: docs/design/ai-agents.md
// §18.5, §18.2 stage 1, §10 note 36; decisions Q27/Q28 made durable).
//
// One registry governs every external source the §18 agents may touch.
// The law it enforces: AN AGENT MAY NOT CONSUME AN UNREGISTERED SOURCE —
// every ingestion path calls assertRegistered(source_id, role) before any
// text is read, and AlMahri's "source reputation and domain screening"
// becomes each entry's machine-applied screening_rule, never a per-run
// judgment call.
//
// Free-tier rows only (§18.5): licensed sources (FactSet Supply Chain
// Relationships, Mergent, Bloomberg SPLC, Orbis, Panjiva/ImportGenius,
// CAPS Research, APQC, ecoinvent, Prewave/Everstream/Resilinc/Interos/
// Sphera) are named in the design and deliberately NOT seeded — the guard
// refuses them by construction until their entitlement tier is wired.
//
// Like estimatorBenchmarks.json, this file is code: reviewed, versioned
// (REGISTRY_VERSION), never fetched at runtime. Dependency-free pure
// TypeScript — no Deno.*, no clients — so the deterministic eval tier
// drives it byte-identically offline.

export const REGISTRY_VERSION = 2;

/** §18.5 roles. `role` is a role SET per entry (§10 note 36b): §18.5's own
 * table assigns multiple roles to one source (GDELT: extraction + sensing).
 * - extraction     — text mined for triples/events (B8)
 * - sensing        — event feeds (B9)
 * - validation     — reference data the map is SCORED against; a source may
 *                    not serve as extraction input and validation reference
 *                    for the same claim
 * - prior          — statistical priors for estimation (B7; the §18.5
 *                    seed-table sources, mirrored here for the shared law)
 * - disambiguation — canonical entity identifiers (GLEIF LEI backbone)
 */
export type SourceRole =
  | "extraction"
  | "sensing"
  | "validation"
  | "prior"
  | "disambiguation";

/** Trust grade drives the deterministic evidence-confidence mapping
 * (§10 note 36e) — never LLM-scored. */
export type TrustGrade = "A" | "B" | "C";

export const CONFIDENCE_BY_TRUST: Record<TrustGrade, number> = {
  A: 0.9, // official registers / filings / authoritative issuers (DEFAULT)
  B: 0.7, // curated wires, corporate disclosures, screened aggregators
  C: 0.5, // open/crowd-maintained or firehose-tier sources
};

/** Machine-applied screening rule (§18.2 pipeline stage 1). */
export interface ScreeningRule {
  /** Minimum document length in characters — rejects junk/empty pastes. */
  min_chars: number;
  /** Maximum document size in bytes accepted for one ingestion. */
  max_bytes: number;
  /** Domains a live fetch may read for this source (suffix match on the
   * URL hostname). Empty ⇒ paste/upload only — the URL path is refused
   * even with CARTOGRAPHER_LIVE_FETCH on. */
  allowed_domains: string[];
  /** Human-readable screening intent, rendered on cards/spec. */
  note: string;
}

/** The §18.5 entry shape: {source_id, role, access, trust_grade,
 * screening_rule, terms_note}. */
export interface SourceRegistryEntry {
  source_id: string;
  label: string;
  role: readonly SourceRole[];
  access: string;
  trust_grade: TrustGrade;
  screening_rule: ScreeningRule;
  terms_note: string;
}

const PASTE_ONLY: Omit<ScreeningRule, "note"> = {
  min_chars: 80,
  max_bytes: 32 * 1024,
  allowed_domains: [],
};

/** The §18.5 free-tier rows. Ordering mirrors the §18.5 table. */
export const SOURCE_REGISTRY: readonly SourceRegistryEntry[] = [
  {
    source_id: "gdelt",
    label: "GDELT 2.0 (15-min global news/events)",
    role: ["extraction", "sensing"],
    access: "free API",
    trust_grade: "C",
    screening_rule: {
      ...PASTE_ONLY,
      allowed_domains: ["gdeltproject.org"],
      note: "Screened firehose: article text via paste or the GDELT API domain; single-source claims stay provisional by construction.",
    },
    terms_note: "GDELT terms of use — free with attribution.",
  },
  {
    source_id: "sec-edgar",
    label: "SEC EDGAR full-text (10-K/8-K; Form SD supplier lists)",
    role: ["extraction"],
    access: "free API",
    trust_grade: "A",
    screening_rule: {
      ...PASTE_ONLY,
      allowed_domains: ["sec.gov"],
      note: "Official US filings; excerpts pasted or fetched from sec.gov only.",
    },
    terms_note: "US government work — public domain; EDGAR fair-access rate limits apply to live fetch.",
  },
  {
    source_id: "bundesanzeiger",
    label: "Bundesanzeiger / Unternehmensregister",
    role: ["extraction"],
    access: "free",
    trust_grade: "A",
    screening_rule: {
      ...PASTE_ONLY,
      allowed_domains: ["bundesanzeiger.de", "unternehmensregister.de"],
      note: "Official German register publications; excerpts pasted or fetched from the register domains only.",
    },
    terms_note: "Public register content; automated bulk retrieval restricted — excerpt-level use only.",
  },
  {
    source_id: "uk-companies-house",
    label: "UK Companies House",
    role: ["extraction"],
    access: "free",
    trust_grade: "A",
    screening_rule: {
      ...PASTE_ONLY,
      allowed_domains: ["company-information.service.gov.uk"],
      note: "Official UK register; filings/excerpts pasted or fetched from the register domain only.",
    },
    terms_note: "Companies House data — free under the UK Open Government Licence.",
  },
  {
    source_id: "esef-filings",
    label: "ESEF filings (EU structured annual reports)",
    role: ["extraction"],
    access: "free",
    trust_grade: "A",
    screening_rule: {
      ...PASTE_ONLY,
      note: "Issuer annual-report excerpts, pasted; no canonical fetch domain (national OAMs vary).",
    },
    terms_note: "Public regulated disclosures.",
  },
  {
    source_id: "lksg-csrd-disclosures",
    label: "LkSG / CSRD / CSDDD due-diligence disclosures",
    role: ["extraction"],
    access: "free; volume grows 2026-2030",
    trust_grade: "B",
    screening_rule: {
      ...PASTE_ONLY,
      note: "Corporate due-diligence disclosures, pasted; issuer sites vary — no fetch allowlist in v1.",
    },
    terms_note: "Public regulated disclosures; per-issuer site terms apply to fetching.",
  },
  {
    source_id: "wikipedia-wikidata",
    label: "Wikipedia / Wikidata (ownership, industry, product relations)",
    role: ["extraction"],
    access: "free",
    trust_grade: "C",
    screening_rule: {
      ...PASTE_ONLY,
      allowed_domains: ["wikipedia.org", "wikidata.org"],
      note: "Crowd-maintained: grade C — claims never integrate without independent corroboration.",
    },
    terms_note: "CC BY-SA / CC0 — attribution preserved via url_or_ref.",
  },
  {
    source_id: "news-wire",
    label: "Reuters / AP / AFP / dpa wire copy",
    // §10 note 36b: extraction covers USER-SUPPLIED excerpts (the B8 v1
    // paste path, fair-use quotation); live wire fetch is a sensing-tier
    // licensing question for B9 — hence no allowed_domains.
    role: ["extraction", "sensing"],
    access: "free tiers / licensing",
    trust_grade: "B",
    screening_rule: {
      ...PASTE_ONLY,
      note: "Curated wires: user-pasted article excerpts only; live RSS fetch is not wired in v1 (licensing).",
    },
    terms_note: "Excerpt-level quotation by the user; bulk/live ingestion requires a wire license.",
  },
  // §18.3/§10 note 37b (REGISTRY_VERSION 2): the four wire agencies as
  // SEPARATE rows, because one source_id counts once toward the Q28
  // independent-source threshold — a single collective wire row made
  // >= 3-source news verification unreachable. Same posture as news-wire:
  // extraction covers user-supplied excerpts; paste-only (no live fetch).
  ...(["reuters", "ap", "afp", "dpa"] as const).map((agency): SourceRegistryEntry => ({
    source_id: `${agency}-wire`,
    label: `${agency.toUpperCase()} wire copy (user-supplied excerpts)`,
    role: ["extraction", "sensing"],
    access: "free tiers / licensing",
    trust_grade: "B",
    screening_rule: {
      ...PASTE_ONLY,
      note: "Curated wire (single agency): user-pasted article excerpts only; live RSS fetch is not wired in v1 (licensing).",
    },
    terms_note: "Excerpt-level quotation by the user; bulk/live ingestion requires a wire license.",
  })),
  {
    source_id: "gdacs",
    label: "GDACS disaster alerts",
    role: ["sensing"],
    access: "free",
    trust_grade: "A",
    screening_rule: { ...PASTE_ONLY, allowed_domains: ["gdacs.org"], note: "Authoritative structured alerts (B9)." },
    terms_note: "UN/EC public alert feed.",
  },
  {
    source_id: "copernicus-ems",
    label: "Copernicus Emergency Management Service",
    role: ["sensing"],
    access: "free",
    trust_grade: "A",
    screening_rule: { ...PASTE_ONLY, allowed_domains: ["emergency.copernicus.eu"], note: "Authoritative structured alerts (B9)." },
    terms_note: "EU public service data.",
  },
  {
    source_id: "usgs",
    label: "USGS earthquake feeds",
    role: ["sensing"],
    access: "free",
    trust_grade: "A",
    screening_rule: { ...PASTE_ONLY, allowed_domains: ["usgs.gov"], note: "Authoritative structured alerts (B9)." },
    terms_note: "US government work — public domain.",
  },
  {
    source_id: "national-weather",
    label: "National weather services (e.g. DWD)",
    role: ["sensing"],
    access: "free",
    trust_grade: "A",
    screening_rule: { ...PASTE_ONLY, allowed_domains: ["dwd.de"], note: "Authoritative structured alerts (B9)." },
    terms_note: "Public weather-service open data.",
  },
  {
    source_id: "insolvency-register-de",
    label: "DE Insolvenzbekanntmachungen",
    role: ["sensing"],
    access: "free",
    trust_grade: "A",
    screening_rule: { ...PASTE_ONLY, allowed_domains: ["insolvenzbekanntmachungen.de"], note: "Official insolvency events (B9)." },
    terms_note: "Public register; query-scoped access rules apply.",
  },
  {
    source_id: "uk-gazette",
    label: "UK Gazette (insolvency events)",
    role: ["sensing"],
    access: "free",
    trust_grade: "A",
    screening_rule: { ...PASTE_ONLY, allowed_domains: ["thegazette.co.uk"], note: "Official insolvency events (B9)." },
    terms_note: "UK Open Government Licence.",
  },
  {
    source_id: "eu-sanctions",
    label: "EU consolidated sanctions list",
    role: ["sensing"],
    access: "free",
    trust_grade: "A",
    screening_rule: { ...PASTE_ONLY, allowed_domains: ["europa.eu"], note: "Authoritative list (B9); the issuer is the ground truth." },
    terms_note: "EU public data.",
  },
  {
    source_id: "ofac",
    label: "OFAC sanctions lists",
    role: ["sensing"],
    access: "free",
    trust_grade: "A",
    screening_rule: { ...PASTE_ONLY, allowed_domains: ["treasury.gov"], note: "Authoritative list (B9); the issuer is the ground truth." },
    terms_note: "US government work — public domain.",
  },
  {
    source_id: "cyber-advisories",
    label: "CISA / ENISA / BSI advisories",
    role: ["sensing"],
    access: "free",
    trust_grade: "A",
    screening_rule: {
      ...PASTE_ONLY,
      allowed_domains: ["cisa.gov", "enisa.europa.eu", "bsi.bund.de"],
      note: "Authoritative cyber advisories (B9).",
    },
    terms_note: "Public advisories.",
  },
  {
    source_id: "gleif",
    label: "GLEIF LEI database (canonical entity IDs + parent relations)",
    role: ["disambiguation"],
    access: "free",
    trust_grade: "A",
    screening_rule: {
      ...PASTE_ONLY,
      allowed_domains: ["gleif.org"],
      note: "Disambiguation backbone: the checked-in seed slice is the v1 path; live lookup behind CARTOGRAPHER_GLEIF_LIVE.",
    },
    terms_note: "CC0 — the Golden Copy is a free bulk download.",
  },
  {
    source_id: "opencorporates",
    label: "OpenCorporates",
    role: ["validation"],
    access: "free tier",
    trust_grade: "B",
    screening_rule: { ...PASTE_ONLY, allowed_domains: ["opencorporates.com"], note: "Map validation reference (scored-against, never extraction input for the same claim)." },
    terms_note: "Free tier with attribution; API limits apply.",
  },
  {
    source_id: "importyeti",
    label: "US bill-of-lading: ImportYeti",
    role: ["validation"],
    access: "free",
    trust_grade: "B",
    screening_rule: { ...PASTE_ONLY, allowed_domains: ["importyeti.com"], note: "Map validation reference (bill-of-lading records)." },
    terms_note: "Free public search; bulk terms apply.",
  },
  {
    source_id: "un-comtrade",
    label: "UN Comtrade / Eurostat COMEXT (trade values and quantities)",
    role: ["validation", "prior"],
    access: "free",
    trust_grade: "A",
    screening_rule: { ...PASTE_ONLY, allowed_domains: ["comtrade.un.org", "ec.europa.eu"], note: "Validation + prior series; consumed as versioned tables, never runtime text." },
    terms_note: "Public statistical data.",
  },
  {
    source_id: "ted-tenders",
    label: "TED — EU public tenders",
    role: ["validation"],
    access: "free",
    trust_grade: "A",
    screening_rule: { ...PASTE_ONLY, allowed_domains: ["ted.europa.eu"], note: "Map validation reference (public contracts)." },
    terms_note: "EU public data.",
  },
  {
    source_id: "eurostat-statistics",
    label: "Eurostat SBS / Prodcom / PPI / labour costs; OECD ICIO; EXIOBASE; WIOD",
    role: ["prior"],
    access: "free",
    trust_grade: "A",
    screening_rule: { ...PASTE_ONLY, note: "B7 priors: consumed ONLY through the checked-in estimatorBenchmarks.json seed table (§18.5 law) — never fetched at runtime." },
    terms_note: "Public statistical data; EXIOBASE CC BY-SA.",
  },
  {
    source_id: "eu-ef-echa",
    label: "EU Environmental Footprint datasets / ECHA SCIP",
    role: ["prior"],
    access: "free",
    trust_grade: "A",
    screening_rule: { ...PASTE_ONLY, note: "B8 v2 priors (physical-unit material content); versioned-table discipline." },
    terms_note: "EU public data.",
  },
  {
    source_id: "damodaran-ecb",
    label: "Damodaran industry datasets / ECB & Bundesbank rates",
    role: ["prior"],
    access: "free",
    trust_grade: "B",
    screening_rule: { ...PASTE_ONLY, note: "B7 priors: capital component of holding-cost build-up; versioned-table discipline." },
    terms_note: "Free academic/public data with attribution.",
  },
  {
    source_id: "commodity-freight-indices",
    label: "LME / World Bank / IMF commodity series; FBX / Drewry headline freight indices",
    role: ["prior"],
    access: "free (headline)",
    trust_grade: "B",
    screening_rule: { ...PASTE_ONLY, note: "B7 priors: lane-cost levels; headline figures only, versioned-table discipline." },
    terms_note: "Headline values free; underlying series licensed.",
  },
] as const;

const BY_ID: ReadonlyMap<string, SourceRegistryEntry> = new Map(
  SOURCE_REGISTRY.map((e) => [e.source_id, e]),
);

export function getRegisteredSource(sourceId: string): SourceRegistryEntry | undefined {
  return BY_ID.get(String(sourceId ?? "").trim().toLowerCase());
}

/** The registered source ids carrying a role — for refusal messages and the
 * grounding context (serialized from the registry, never hand-written). */
export function registeredSources(role: SourceRole): SourceRegistryEntry[] {
  return SOURCE_REGISTRY.filter((e) => e.role.includes(role));
}

export class UnregisteredSourceError extends Error {
  constructor(public sourceId: string, public role: SourceRole) {
    super(
      `source "${sourceId}" is not registered for role "${role}" in the platform's source registry ` +
        `(v${REGISTRY_VERSION}) — registered ${role} sources: ` +
        registeredSources(role).map((e) => e.source_id).join(", "),
    );
  }
}

/**
 * The §18.5 law, as code: AN AGENT MAY NOT CONSUME AN UNREGISTERED SOURCE.
 * Every ingestion path MUST call this before reading any text. Throws
 * UnregisteredSourceError (callers map it to the §4.5 `invalid_params`
 * envelope, naming the registered ids); returns the entry on success so the
 * caller applies the screening_rule and trust-grade confidence.
 */
export function assertRegistered(sourceId: string, role: SourceRole): SourceRegistryEntry {
  const entry = getRegisteredSource(sourceId);
  if (!entry || !entry.role.includes(role)) {
    throw new UnregisteredSourceError(String(sourceId ?? ""), role);
  }
  return entry;
}

/** Deterministic evidence confidence (§10 note 36e) — never LLM-scored. */
export function sourceConfidence(entry: SourceRegistryEntry): number {
  return CONFIDENCE_BY_TRUST[entry.trust_grade];
}

/** Q28 authoritative rule, made mechanical (§18.3 stage 6, §10 note 37c): a
 * source is authoritative iff its registry row carries role `sensing` AND
 * trust grade A — the issuer is the ground truth, so ONE such source
 * verifies an event. Derived from the registry, never hand-listed. */
export function isAuthoritativeSensingSource(sourceId: string): boolean {
  const entry = getRegisteredSource(sourceId);
  return Boolean(entry && entry.role.includes("sensing") && entry.trust_grade === "A");
}

export interface ScreeningResult {
  ok: boolean;
  reason?: string;
}

/**
 * Apply an entry's screening_rule to one ingestion input (§18.2 stage 1).
 * For URLs: the hostname must suffix-match an allowed domain — an empty
 * allowlist means the source is paste-only regardless of flags. Text limits
 * apply to both paths. Pure and deterministic.
 */
export function applyScreeningRule(
  entry: SourceRegistryEntry,
  input: { text?: string; url?: string },
): ScreeningResult {
  const rule = entry.screening_rule;
  if (input.url != null && input.url !== "") {
    if (rule.allowed_domains.length === 0) {
      return {
        ok: false,
        reason: `source "${entry.source_id}" is paste/upload only — its screening rule allows no fetch domains`,
      };
    }
    let host: string;
    try {
      const u = new URL(input.url);
      if (u.protocol !== "https:") {
        return { ok: false, reason: "live fetch allows https URLs only" };
      }
      host = u.hostname.toLowerCase();
    } catch {
      return { ok: false, reason: "the url is not a valid absolute URL" };
    }
    const allowed = rule.allowed_domains.some(
      (d) => host === d || host.endsWith(`.${d}`),
    );
    if (!allowed) {
      return {
        ok: false,
        reason:
          `domain "${host}" is not in source "${entry.source_id}"'s screening allowlist ` +
          `(${rule.allowed_domains.join(", ")})`,
      };
    }
  }
  const text = input.text ?? "";
  if (text) {
    if (text.length < rule.min_chars) {
      return {
        ok: false,
        reason: `the document is shorter than the source's ${rule.min_chars}-character screening minimum`,
      };
    }
    if (new TextEncoder().encode(text).length > rule.max_bytes) {
      return {
        ok: false,
        reason: `the document exceeds the source's ${rule.max_bytes}-byte screening limit — split it`,
      };
    }
  }
  return { ok: true };
}
