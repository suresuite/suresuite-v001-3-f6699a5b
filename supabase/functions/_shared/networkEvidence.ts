// B8 Network Cartographer — deterministic pipeline functions (design:
// docs/design/ai-agents.md §18.2 v1, §10 note 36a; decision §10 Q27).
//
// The ONE module both agent surfaces consume:
//   * the cartographer tool handlers (project-ai-chat/cartographerTools.ts)
//     — ingest-time gates (verbatim-substring, closed relation set, LEI
//     resolution) and draft-time verification (`not_grounded` on mismatch)
//   * the apply function (agent-apply/networkMapDiffApply.ts) —
//     apply-time re-verification (`stale_values` on mismatch)
// so a triple can never reach the graph unless it (a) was literally present
// in a screened document, (b) persists as an external_evidence row, and
// (c) still tallies `verified` (>= 3 independent registered sources, Q27)
// at the moment of writing.
//
// Like grading.ts and estimators.ts it is dependency-free pure TypeScript
// over injected rows: no Deno.*, no supabase client — the deterministic
// eval tier runs it byte-identically offline. The LEI seed slice is NEVER
// fetched at runtime: leiSeed.json is code (§10 note 36g).

import leiSeed from "./leiSeed.json" with { type: "json" };
import {
  assertRegistered,
  UnregisteredSourceError,
} from "./sourceRegistry.ts";

// ── Q27 thresholds and confidence vocabulary ────────────────────────────────

/** DEFAULT per Q27 (user-configurable is post-v1): a triple integrates only
 * at >= 3 independent credible sources. */
export const VERIFY_MIN_SOURCES = 3;

export type TripleStatus = "verified" | "corroborated" | "provisional";

export function statusForSourceCount(n: number): TripleStatus {
  if (n >= VERIFY_MIN_SOURCES) return "verified";
  return n === 2 ? "corroborated" : "provisional";
}

// ── Ontology (§18.2 stages 2–3, the AlMahri task adaptation) ────────────────

export const ENTITY_TYPES = ["Company", "Location", "Material", "Product", "Person"] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];

export const RELATION_TYPES = ["SuppliesTo", "Produces", "LocatedIn", "OwnedBy"] as const;
export type RelationType = (typeof RELATION_TYPES)[number];

/** Ingest caps (§18.2 pipeline; DEFAULT). */
export const MAX_MENTIONS_PER_DOC = 40;
export const MAX_TRIPLES_PER_DOC = 40;

export interface EntityMention {
  type: EntityType;
  text: string;
}

export interface ExtractedTriple {
  subject: string;
  relation: RelationType;
  object: string;
  quote: string;
}

/** The external_evidence.triple JSONB shape (§18.2 stage 6). */
export interface EvidenceTriple {
  subject: { name: string; lei?: string };
  relation: RelationType;
  object: { name: string; type?: string };
  quote: string;
  doc_title?: string;
}

/** One external_evidence row as read back from the store. */
export interface EvidenceRow {
  id: string;
  project_id?: string;
  source_id: string;
  url_or_ref?: string | null;
  content_hash: string;
  retrieved_at?: string;
  confidence: number;
  triple: EvidenceTriple;
  lei?: string | null;
}

// ── Extraction-response parsing (tolerant like router.parseClassifierResponse:
//    strict JSON first, then the outermost {...} block; anything else ⇒ null) ─

function parseJsonObject(raw: string): Record<string, unknown> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.trim());
  } catch {
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try {
      parsed = JSON.parse(m[0]);
    } catch {
      return null;
    }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  return parsed as Record<string, unknown>;
}

/** Parse the NER reply. Malformed ⇒ null (the caller reports an extraction
 * failure, never guesses). Schema-invalid items are dropped silently — the
 * verbatim gate below is the load-bearing filter. */
export function parseNerResponse(raw: string): EntityMention[] | null {
  const o = parseJsonObject(raw);
  if (!o || !Array.isArray(o.entities)) return null;
  const out: EntityMention[] = [];
  for (const e of o.entities) {
    if (!e || typeof e !== "object") continue;
    const type = String((e as Record<string, unknown>).type ?? "");
    const text = String((e as Record<string, unknown>).text ?? "").trim();
    if (!(ENTITY_TYPES as readonly string[]).includes(type)) continue;
    if (!text || text.length > 200) continue;
    out.push({ type: type as EntityType, text });
  }
  return out;
}

/** Parse the RE reply. Malformed ⇒ null. */
export function parseReResponse(raw: string): ExtractedTriple[] | null {
  const o = parseJsonObject(raw);
  if (!o || !Array.isArray(o.triples)) return null;
  const out: ExtractedTriple[] = [];
  for (const t of o.triples) {
    if (!t || typeof t !== "object") continue;
    const r = t as Record<string, unknown>;
    const relation = String(r.relation ?? "");
    const subject = String(r.subject ?? "").trim();
    const object = String(r.object ?? "").trim();
    const quote = String(r.quote ?? "").trim();
    if (!(RELATION_TYPES as readonly string[]).includes(relation)) continue;
    if (!subject || !object || subject.length > 200 || object.length > 200) continue;
    if (!quote || quote.length > 600) continue;
    out.push({ subject, relation: relation as RelationType, object, quote });
  }
  return out;
}

// ── Verbatim-substring gates (§18.2 stages 2–3 hard gates) ──────────────────

/** Whitespace-collapsed, case-insensitive haystack for substring checks —
 * extraction may reflow line breaks, but every character of content must
 * come from the document. */
const foldWs = (s: string): string => s.replace(/\s+/g, " ").trim().toLowerCase();

export function isVerbatimSubstring(fragment: string, documentText: string): boolean {
  const frag = foldWs(fragment);
  if (!frag) return false;
  return foldWs(documentText).includes(frag);
}

export interface MentionGateResult {
  accepted: EntityMention[];
  droppedMentions: number;
}

/** Drop (and count) any mention not literally present in the document —
 * fabricated entities cannot become evidence (nc-07). */
export function gateMentions(mentions: EntityMention[], documentText: string): MentionGateResult {
  const accepted: EntityMention[] = [];
  let droppedMentions = 0;
  const seen = new Set<string>();
  for (const m of mentions) {
    const key = `${m.type}|${foldWs(m.text)}`;
    if (seen.has(key)) continue;
    if (!isVerbatimSubstring(m.text, documentText)) {
      droppedMentions += 1;
      continue;
    }
    seen.add(key);
    accepted.push(m);
    if (accepted.length >= MAX_MENTIONS_PER_DOC) break;
  }
  return { accepted, droppedMentions };
}

export interface TripleGateResult {
  accepted: ExtractedTriple[];
  droppedTriples: number;
}

/** Drop (and count) any triple whose subject/object is not an accepted
 * mention or whose quote is not literally in the document. */
export function gateTriples(
  triples: ExtractedTriple[],
  acceptedMentions: EntityMention[],
  documentText: string,
): TripleGateResult {
  const mentionTexts = new Set(acceptedMentions.map((m) => foldWs(m.text)));
  const accepted: ExtractedTriple[] = [];
  let droppedTriples = 0;
  const seen = new Set<string>();
  for (const t of triples) {
    const ok = mentionTexts.has(foldWs(t.subject)) &&
      mentionTexts.has(foldWs(t.object)) &&
      isVerbatimSubstring(t.quote, documentText);
    if (!ok) {
      droppedTriples += 1;
      continue;
    }
    const key = `${foldWs(t.subject)}|${t.relation}|${foldWs(t.object)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    accepted.push(t);
    if (accepted.length >= MAX_TRIPLES_PER_DOC) break;
  }
  return { accepted, droppedTriples };
}

// ── Entity normalization + the GLEIF LEI seed slice (§18.2 stage 4) ─────────

const LEGAL_SUFFIXES = new Set([
  "ag", "gmbh", "ltd", "limited", "inc", "sa", "ab", "plc", "llc", "co",
  "corp", "corporation", "kg", "se", "bv", "nv", "oy", "spa", "srl",
  "sp", "z", "oo", "zoo",
]);

/** Normalized company identity: lowercase, punctuation stripped, legal
 * suffixes removed, whitespace collapsed. The canonical key when no LEI
 * resolves (weaker identity — the card shows lei null). */
export function normalizeEntityName(name: string): string {
  const tokens = String(name ?? "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
  while (tokens.length > 1 && LEGAL_SUFFIXES.has(tokens[tokens.length - 1])) {
    tokens.pop();
  }
  return tokens.join(" ");
}

export interface LeiRecord {
  lei: string;
  legal_name: string;
  aliases: string[];
  country: string;
  parent_lei: string | null;
}

export const LEI_SEED_VERSION: number = leiSeed.slice_version;
export const LEI_RECORDS: readonly LeiRecord[] = leiSeed.records as LeiRecord[];

export const LEI_SHAPE_RE = /^[A-Z0-9]{20}$/;

/** Deterministic candidate rule (§18.2 stage 4): exact normalized
 * legal-name/alias matches win; otherwise prefix containment either way
 * surfaces candidates for the (constrained) LLM disambiguation pass. */
export function candidateLeiRecords(mention: string): LeiRecord[] {
  const norm = normalizeEntityName(mention);
  if (!norm) return [];
  const exact = LEI_RECORDS.filter((r) =>
    normalizeEntityName(r.legal_name) === norm ||
    r.aliases.some((a) => normalizeEntityName(a) === norm)
  );
  if (exact.length > 0) return exact;
  return LEI_RECORDS.filter((r) => {
    const rn = normalizeEntityName(r.legal_name);
    return rn.startsWith(`${norm} `) || norm.startsWith(`${rn} `) ||
      r.aliases.some((a) => {
        const an = normalizeEntityName(a);
        return an.startsWith(`${norm} `) || norm.startsWith(`${an} `);
      });
  });
}

/** Parse the disambiguation reply, CONSTRAINED to the candidate list — an
 * answer outside it resolves to null (unresolved), never a guess. */
export function parseDisambiguationResponse(raw: string, candidates: LeiRecord[]): string | null {
  const o = parseJsonObject(raw);
  if (!o) return null;
  const lei = o.lei == null ? null : String(o.lei).trim().toUpperCase();
  if (!lei || !LEI_SHAPE_RE.test(lei)) return null;
  return candidates.some((c) => c.lei === lei) ? lei : null;
}

// ── Canonical triples and the verification tally (§18.2 stage 5) ────────────

/** Canonical identity: the resolved LEI else the normalized name. */
export function subjectKey(triple: EvidenceTriple): string {
  return triple.subject.lei ?? normalizeEntityName(triple.subject.name);
}

export function canonicalTripleKey(triple: EvidenceTriple): string {
  return `${subjectKey(triple)}|${triple.relation}|${normalizeEntityName(triple.object.name)}`;
}

export interface TripleTally {
  key: string;
  subject: string;
  lei: string | null;
  relation: RelationType;
  object: string;
  status: TripleStatus;
  /** Independent sources = DISTINCT source_id (§10 note 36d). */
  sourceIds: string[];
  evidenceIds: string[];
  quotes: string[];
}

/** Group evidence rows on the canonical key and tally the Q27 status.
 * Deterministically ordered (verified first, then by key). */
export function tallyEvidence(rows: EvidenceRow[]): TripleTally[] {
  const byKey = new Map<string, TripleTally>();
  for (const row of rows) {
    if (!row?.triple?.subject?.name || !row.triple.object?.name) continue;
    // §10 note 37d: B9 event rows (relation "EventReported") share the store
    // but not the map vocabulary — the graph tally reads only the closed
    // relation set, so the two views stay disjoint.
    if (!(RELATION_TYPES as readonly string[]).includes(row.triple.relation)) continue;
    const key = canonicalTripleKey(row.triple);
    let t = byKey.get(key);
    if (!t) {
      t = {
        key,
        subject: row.triple.subject.name,
        lei: row.triple.subject.lei ?? (row.lei || null),
        relation: row.triple.relation,
        object: row.triple.object.name,
        status: "provisional",
        sourceIds: [],
        evidenceIds: [],
        quotes: [],
      };
      byKey.set(key, t);
    }
    if (!t.sourceIds.includes(row.source_id)) t.sourceIds.push(row.source_id);
    if (!t.evidenceIds.includes(String(row.id))) t.evidenceIds.push(String(row.id));
    if (row.triple.quote && !t.quotes.includes(row.triple.quote)) {
      t.quotes.push(row.triple.quote);
    }
    if (!t.lei && (row.triple.subject.lei || row.lei)) {
      t.lei = row.triple.subject.lei ?? row.lei ?? null;
    }
  }
  const out = [...byKey.values()];
  for (const t of out) t.status = statusForSourceCount(t.sourceIds.length);
  const rank: Record<TripleStatus, number> = { verified: 0, corroborated: 1, provisional: 2 };
  return out.sort((a, b) => rank[a.status] - rank[b.status] || a.key.localeCompare(b.key));
}

// ── Diff-row verification (§18.2 hard gates 1/2/5 — draft AND apply) ────────

/** Handler-derived supplier id (the LLM never invents ids): the resolved
 * LEI when anchored, else `ext-<name-slug>`. */
export function supplierIdFor(name: string, lei: string | null): string {
  if (lei && LEI_SHAPE_RE.test(lei)) return lei;
  const slug = normalizeEntityName(name).replace(/\s+/g, "-").slice(0, 40);
  return `ext-${slug || "unnamed"}`;
}

export interface MapRowInput {
  op: "add_supplier" | "add_supply_link";
  supplier_name: string;
  lei?: string;
  material_id?: string;
  evidence_ids: string[];
  why?: string;
}

export interface MapRowVerification {
  ok: boolean;
  /** §4.5 draft-time code; apply reports the same failures as stale_values. */
  code?: "not_grounded" | "invalid_params";
  reason?: string;
  /** Server-derived enrichment (the LLM never writes these). */
  supplierId?: string;
  lei?: string | null;
  tally?: TripleTally;
}

/**
 * §18.2 hard gates 1/2/5 for ONE row against the evidence store:
 *   (1) every cited id exists, its source still passes
 *       assertRegistered(…, "extraction"), and its stored triple is about
 *       THIS subject with the op's qualifying relation present
 *       (SuppliesTo for add_supplier, Produces for add_supply_link);
 *   (2) the qualifying canonical triple tallies `verified` (>= 3
 *       independent source_ids) across the WHOLE store, not just the
 *       cited rows;
 *   (5) the row's lei must equal the seed-slice resolution of its
 *       supplier_name — when the row omits it, the resolution is derived
 *       server-side.
 * Pure over injected rows, so draft (`not_grounded`) and apply
 * (`stale_values`) verify identically.
 */
export function verifyMapRow(
  row: MapRowInput,
  allEvidence: EvidenceRow[],
): MapRowVerification {
  const byId = new Map(allEvidence.map((r) => [String(r.id), r]));
  const cited: EvidenceRow[] = [];
  for (const id of row.evidence_ids) {
    const found = byId.get(String(id));
    if (!found) {
      return {
        ok: false,
        code: "not_grounded",
        reason: `evidence row ${id} does not exist in this project's evidence store`,
      };
    }
    cited.push(found);
  }

  for (const ev of cited) {
    try {
      assertRegistered(ev.source_id, "extraction");
    } catch (e) {
      if (e instanceof UnregisteredSourceError) {
        return { ok: false, code: "not_grounded", reason: e.message };
      }
      throw e;
    }
  }

  // Gate 5: seed-slice LEI resolution (server-derived; a provided lei must
  // match). Ambiguous resolution without evidence agreement stays null.
  const candidates = candidateLeiRecords(row.supplier_name);
  const resolved = candidates.length === 1 ? candidates[0].lei : null;
  const provided = row.lei ? row.lei.trim().toUpperCase() : null;
  if (provided && !candidates.some((c) => c.lei === provided)) {
    return {
      ok: false,
      code: "not_grounded",
      reason:
        `lei ${provided} does not match the seed-slice resolution of "${row.supplier_name}"` +
        (resolved ? ` (expected ${resolved})` : " (no seed record resolves this name)"),
    };
  }
  const lei = provided ?? resolved;

  // Gate 1: every cited row must be about THIS subject…
  const expectKey = lei ?? normalizeEntityName(row.supplier_name);
  for (const ev of cited) {
    if (subjectKey(ev.triple) !== expectKey) {
      return {
        ok: false,
        code: "not_grounded",
        reason:
          `evidence row ${ev.id} is about "${ev.triple.subject.name}", ` +
          `not "${row.supplier_name}" — the citation does not match the claim`,
      };
    }
  }
  // …with the op's qualifying relation present among the citations.
  const wantRelation: RelationType = row.op === "add_supplier" ? "SuppliesTo" : "Produces";
  const qualifying = cited.find((ev) => ev.triple.relation === wantRelation);
  if (!qualifying) {
    return {
      ok: false,
      code: "not_grounded",
      reason:
        `${row.op} requires ${wantRelation} evidence for "${row.supplier_name}" — ` +
        `none of the cited rows states that relation`,
    };
  }
  if (row.op === "add_supply_link") {
    const objNorm = normalizeEntityName(qualifying.triple.object.name);
    if (!objNorm) {
      return { ok: false, code: "not_grounded", reason: "the cited Produces evidence names no object" };
    }
  }

  // Gate 2: the qualifying canonical triple must tally verified across the
  // WHOLE store (Q27: >= 3 independent sources), not just the cited rows.
  const key = canonicalTripleKey(qualifying.triple);
  const tally = tallyEvidence(allEvidence).find((t) => t.key === key);
  if (!tally || tally.status !== "verified") {
    const n = tally?.sourceIds.length ?? 0;
    return {
      ok: false,
      code: "not_grounded",
      reason:
        `"${row.supplier_name}" ${qualifying.triple.relation} "${qualifying.triple.object.name}" is ` +
        `${tally?.status ?? "provisional"} (${n} independent source${n === 1 ? "" : "s"}) — ` +
        `only verified triples (>= ${VERIFY_MIN_SOURCES}) may enter a proposal; it stays stored and pending`,
    };
  }

  return { ok: true, supplierId: supplierIdFor(row.supplier_name, lei), lei, tally };
}

/** Normalized-name match of a Produces object against the project's
 * materials — the v1 link-target rule (existing materials only). */
export function matchProjectMaterial(
  objectName: string,
  materials: Array<Record<string, unknown>>,
): string | null {
  const norm = normalizeEntityName(objectName);
  if (!norm) return null;
  for (const m of materials) {
    const id = String(m.material_id ?? "");
    if (!id) continue;
    if (id.toLowerCase() === objectName.trim().toLowerCase()) return id;
    if (normalizeEntityName(String(m.name ?? "")) === norm) return id;
  }
  return null;
}
