// B9 Disruption Sentinel — deterministic event functions (design:
// docs/design/ai-agents.md §18.3 v1, §10 note 37; decision §10 Q28).
//
// The ONE module both B9 surfaces consume:
//   * the sentinel tool handlers (project-ai-chat/sentinelTools.ts) —
//     event typing, event-evidence rows, the Q28 corroboration tally,
//     exposure matching, disruption shaping (`not_grounded` on mismatch)
//   * the apply function (agent-apply/riskAlertApply.ts) — apply-time
//     re-verification (`stale_values` on mismatch) and the impact
//     computation from persisted run_replications rows
// so an alert can never file unless its event (a) is literally present in
// screened sensing text, (b) persists as external_evidence rows, and
// (c) tallies `verified` per Q28 (>= 1 authoritative source, or >= 3
// independent sources) at the moment of drafting AND applying — and its
// impact range can never come from anywhere but a completed run.
//
// Like networkEvidence.ts it is dependency-free pure TypeScript over
// injected rows: no Deno.*, no supabase client — the deterministic eval
// tier runs it byte-identically offline. The B8 extraction pipeline is
// REUSED (one pipeline, two consumers): this module adds the event
// vocabulary and the B9 views over the same store, never a second
// extraction path.

import {
  normalizeEntityName,
  type EvidenceRow,
  type TripleTally,
} from "./networkEvidence.ts";
import { isAuthoritativeSensingSource } from "./sourceRegistry.ts";

// ── §18.3 stage 3: the closed event vocabulary + deterministic typer ────────

export const EVENT_TYPES = [
  "fire",
  "explosion",
  "flood",
  "earthquake",
  "storm",
  "insolvency",
  "sanction",
  "cyber",
  "strike",
  "outage",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

/** The B9 namespace inside external_evidence (§10 note 37d): event rows use
 * this relation; the B8 graph tally skips it, the B9 tally reads only it. */
export const EVENT_RELATION = "EventReported";

/** Per-type DEFAULT outage duration in days for the shaped disruption
 * schedule (§18.3 stage 8) — engine-facing, human-reviewable on the card. */
export const EVENT_DURATION_DAYS: Record<EventType, number> = {
  fire: 56,
  explosion: 56,
  insolvency: 84,
  sanction: 84,
  earthquake: 42,
  flood: 28,
  cyber: 21,
  storm: 14,
  strike: 14,
  outage: 14,
};

/** Deterministic keyword rules (§18.3 stage 3 — no LLM role). First match in
 * EVENT_TYPES order wins; ties are therefore stable. Case-insensitive; the
 * German register terms cover the seeded insolvency feeds. */
const EVENT_KEYWORDS: Record<EventType, string[]> = {
  fire: ["fire", "blaze", "burned down", "burnt down"],
  explosion: ["explosion", "exploded", "blast"],
  flood: ["flood", "flooding", "inundat"],
  earthquake: ["earthquake", "seismic", "magnitude"],
  storm: ["storm", "hurricane", "typhoon", "cyclone", "tornado"],
  insolvency: ["insolvency", "insolvent", "insolvenz", "bankrupt", "administration order", "winding up", "liquidation"],
  sanction: ["sanction", "sanctioned", "embargo", "export ban"],
  cyber: ["ransomware", "cyberattack", "cyber attack", "data breach", "malware", "hacked"],
  strike: ["strike", "walkout", "industrial action", "work stoppage"],
  outage: ["outage", "shutdown", "shut down", "halted production", "production halt", "power cut"],
};

export function classifyEventType(text: string): EventType | null {
  const hay = String(text ?? "").toLowerCase();
  if (!hay) return null;
  for (const type of EVENT_TYPES) {
    if (EVENT_KEYWORDS[type].some((k) => hay.includes(k))) return type;
  }
  return null;
}

/** Ingest cap (§18.3 stage 5, DEFAULT): event rows per document. */
export const MAX_EVENT_SUBJECTS_PER_DOC = 8;

/** First document sentence containing the (verbatim) mention — the event
 * row's quote, verbatim by construction. Falls back to a clamped window. */
export function firstSentenceWith(documentText: string, mention: string): string {
  const text = String(documentText ?? "");
  const sentences = text.split(/(?<=[.!?])\s+/);
  const needle = mention.replace(/\s+/g, " ").trim().toLowerCase();
  for (const s of sentences) {
    if (s.replace(/\s+/g, " ").toLowerCase().includes(needle)) return s.trim().slice(0, 600);
  }
  const idx = text.replace(/\s+/g, " ").toLowerCase().indexOf(needle);
  return idx >= 0 ? text.replace(/\s+/g, " ").slice(idx, idx + 300) : mention;
}

// ── The event view over external_evidence (§18.3 stages 5–6) ────────────────

/** The external_evidence.triple JSONB shape for a B9 event row. */
export interface EventEvidenceTriple {
  subject: { name: string; lei?: string };
  relation: typeof EVENT_RELATION;
  object: { name: EventType | string; type: "Event" };
  quote: string;
  doc_title?: string;
}

export function makeEventTriple(args: {
  subjectName: string;
  lei: string | null;
  eventType: EventType;
  quote: string;
  docTitle?: string | null;
}): EventEvidenceTriple {
  return {
    subject: { name: args.subjectName, ...(args.lei ? { lei: args.lei } : {}) },
    relation: EVENT_RELATION,
    object: { name: args.eventType, type: "Event" },
    quote: args.quote,
    ...(args.docTitle ? { doc_title: args.docTitle } : {}),
  };
}

export function isEventRow(row: EvidenceRow): boolean {
  return String(row?.triple?.relation ?? "") === EVENT_RELATION;
}

/** Canonical event identity: LEI else normalized name, exactly the B8 rule. */
export function eventSubjectKey(triple: { subject: { name: string; lei?: string } }): string {
  return triple.subject.lei ?? normalizeEntityName(triple.subject.name);
}

export function canonicalEventKey(triple: EventEvidenceTriple): string {
  return `${eventSubjectKey(triple)}|${EVENT_RELATION}|${String(triple.object.name)}`;
}

export type EventStatus = "verified" | "corroborated" | "provisional";

export interface EventTally {
  key: string;
  subject: string;
  lei: string | null;
  eventType: string;
  status: EventStatus;
  /** Independent sources = DISTINCT source_id (§10 note 36d). */
  sourceIds: string[];
  /** Subset of sourceIds that are authoritative (sensing ∩ grade A, note 37c). */
  authoritativeSourceIds: string[];
  evidenceIds: string[];
  quotes: string[];
}

/** The Q28 rule, mechanical: verified ⇔ >= 1 authoritative source OR >= 3
 * independent sources; else corroborated (2) / provisional (1). */
export function eventStatus(independent: number, authoritative: number): EventStatus {
  if (authoritative >= 1 || independent >= 3) return "verified";
  return independent === 2 ? "corroborated" : "provisional";
}

/** Human-readable statement of the Q28 rule for cards and refusals. */
export const CORROBORATION_RULE =
  "verified = 1+ authoritative sensing source (the issuer is the ground truth) OR 3+ independent registered sources";

/** Group event evidence rows on the canonical key and tally Q28 status.
 * Deterministically ordered (verified first, then by key). */
export function tallyEventEvidence(rows: EvidenceRow[]): EventTally[] {
  const byKey = new Map<string, EventTally>();
  for (const row of rows) {
    if (!isEventRow(row)) continue;
    const triple = row.triple as unknown as EventEvidenceTriple;
    if (!triple?.subject?.name || !triple.object?.name) continue;
    const key = canonicalEventKey(triple);
    let t = byKey.get(key);
    if (!t) {
      t = {
        key,
        subject: triple.subject.name,
        lei: triple.subject.lei ?? (row.lei || null),
        eventType: String(triple.object.name),
        status: "provisional",
        sourceIds: [],
        authoritativeSourceIds: [],
        evidenceIds: [],
        quotes: [],
      };
      byKey.set(key, t);
    }
    if (!t.sourceIds.includes(row.source_id)) {
      t.sourceIds.push(row.source_id);
      if (isAuthoritativeSensingSource(row.source_id)) {
        t.authoritativeSourceIds.push(row.source_id);
      }
    }
    if (!t.evidenceIds.includes(String(row.id))) t.evidenceIds.push(String(row.id));
    if (triple.quote && !t.quotes.includes(triple.quote)) t.quotes.push(triple.quote);
    if (!t.lei && (triple.subject.lei || row.lei)) t.lei = triple.subject.lei ?? row.lei ?? null;
  }
  const out = [...byKey.values()];
  for (const t of out) {
    t.status = eventStatus(t.sourceIds.length, t.authoritativeSourceIds.length);
  }
  const rank: Record<EventStatus, number> = { verified: 0, corroborated: 1, provisional: 2 };
  return out.sort((a, b) => rank[a.status] - rank[b.status] || a.key.localeCompare(b.key));
}

// ── §18.3 stage 7: deterministic exposure matching ──────────────────────────

export interface ExposureMatch {
  /** direct_supplier: a project supplier row IS the affected firm.
   * deep_tier_supplier: a stored SuppliesTo triple reaches a project supplier.
   * produces_material: a stored Produces triple names a project material. */
  kind: "direct_supplier" | "deep_tier_supplier" | "produces_material";
  /** The project-side entity the exposure lands on. */
  entity_id: string;
  entity_name: string | null;
  /** Map-evidence citations backing a deep-tier/material match (empty for a
   * direct match — the lane/master rows are the citation there). */
  via_evidence_ids: string[];
  /** Q27 status of the mapping triple behind the match (deep-tier only) —
   * a provisional map triple yields a VISIBLE, provenance-labeled match. */
  map_status?: string;
  /** Direct matches: materials this supplier is the only source of. */
  sole_source_materials?: string[];
}

export interface ExposureInput {
  /** The affected firm's name (normalized for matching). */
  subjectName: string;
  /** The affected firm's resolved LEI, when anchored. Matching accepts
   * EITHER identity — a LEI-resolved subject still matches a name-keyed
   * supplier row, and vice versa. */
  subjectLei?: string | null;
  suppliers: Array<Record<string, unknown>>;
  materials: Array<Record<string, unknown>>;
  /** inbound_logistics rows (supplier_id, material_id). */
  lanes: Array<Record<string, unknown>>;
  /** The B8 graph tallies (networkEvidence.tallyEvidence output). */
  mapTallies: TripleTally[];
}

export interface ExposureResult {
  matches: ExposureMatch[];
  /** What was checked — the honest "no exposure found" inventory. */
  checked: { suppliers: number; materials: number; mapped_triples: number };
}

const supplierKey = (s: Record<string, unknown>): string[] => {
  const keys: string[] = [];
  const id = String(s.supplier_id ?? "").trim();
  if (id) keys.push(id.toUpperCase(), normalizeEntityName(id));
  const name = String(s.name ?? "").trim();
  if (name) keys.push(normalizeEntityName(name));
  return keys.filter(Boolean);
};

/** Materials a supplier is the ONLY source of (severity input). */
export function soleSourcedMaterials(
  supplierId: string,
  lanes: Array<Record<string, unknown>>,
): string[] {
  const bySupplier = new Map<string, Set<string>>();
  for (const l of lanes) {
    const m = String(l.material_id ?? "");
    const s = String(l.supplier_id ?? "");
    if (!m || !s) continue;
    if (!bySupplier.has(m)) bySupplier.set(m, new Set());
    bySupplier.get(m)!.add(s);
  }
  const out: string[] = [];
  for (const [material, sources] of bySupplier) {
    if (sources.size === 1 && sources.has(supplierId)) out.push(material);
  }
  return out.sort();
}

/**
 * §18.3 stage 7: match one affected firm to the project — direct suppliers
 * by LEI/id/normalized name, then the B8 deep-tier map (SuppliesTo → a
 * project supplier; Produces → a project material). Pure over injected rows,
 * so draft (`not_grounded`) and apply (`stale_values`) match identically.
 */
export function matchExposure(input: ExposureInput): ExposureResult {
  const matches: ExposureMatch[] = [];
  // The subject's identity SET: normalized name + LEI (either matches).
  const identities = new Set<string>([normalizeEntityName(input.subjectName)]);
  if (input.subjectLei) identities.add(input.subjectLei.toUpperCase());
  identities.delete("");

  for (const s of input.suppliers) {
    if (supplierKey(s).some((k) => identities.has(k) || identities.has(k.toUpperCase()))) {
      const id = String(s.supplier_id ?? "");
      matches.push({
        kind: "direct_supplier",
        entity_id: id,
        entity_name: (s.name as string | null) ?? null,
        via_evidence_ids: [],
        sole_source_materials: soleSourcedMaterials(id, input.lanes),
      });
    }
  }

  const supplierByNorm = new Map<string, Record<string, unknown>>();
  for (const s of input.suppliers) {
    for (const k of supplierKey(s)) supplierByNorm.set(k, s);
  }
  const materialByNorm = new Map<string, Record<string, unknown>>();
  for (const m of input.materials) {
    const id = String(m.material_id ?? "");
    if (id) materialByNorm.set(id.toLowerCase(), m);
    const name = normalizeEntityName(String(m.name ?? ""));
    if (name) materialByNorm.set(name, m);
  }

  for (const t of input.mapTallies) {
    const tallyIds = [t.lei ?? "", normalizeEntityName(t.subject)].filter(Boolean);
    if (!tallyIds.some((k) => identities.has(k) || identities.has(k.toUpperCase()))) continue;
    if (t.relation === "SuppliesTo") {
      const target = supplierByNorm.get(normalizeEntityName(t.object));
      if (target) {
        const id = String(target.supplier_id ?? "");
        if (!matches.some((m) => m.kind === "deep_tier_supplier" && m.entity_id === id)) {
          matches.push({
            kind: "deep_tier_supplier",
            entity_id: id,
            entity_name: (target.name as string | null) ?? null,
            via_evidence_ids: [...t.evidenceIds],
            map_status: t.status,
          });
        }
      }
    } else if (t.relation === "Produces") {
      const target = materialByNorm.get(normalizeEntityName(t.object)) ??
        materialByNorm.get(t.object.trim().toLowerCase());
      if (target) {
        const id = String(target.material_id ?? "");
        if (!matches.some((m) => m.kind === "produces_material" && m.entity_id === id)) {
          matches.push({
            kind: "produces_material",
            entity_id: id,
            entity_name: (target.name as string | null) ?? null,
            via_evidence_ids: [...t.evidenceIds],
            map_status: t.status,
          });
        }
      }
    }
  }

  return {
    matches,
    checked: {
      suppliers: input.suppliers.length,
      materials: input.materials.length,
      mapped_triples: input.mapTallies.length,
    },
  };
}

// ── Severity (§18.3 DEFAULT scale — handler-derived, never model-supplied) ──

export type AlertSeverity = "critical" | "warning" | "watch";

export function deriveSeverity(matches: ExposureMatch[]): AlertSeverity {
  const direct = matches.filter((m) => m.kind === "direct_supplier");
  if (direct.some((m) => (m.sole_source_materials ?? []).length > 0)) return "critical";
  if (direct.length > 0) return "warning";
  return "watch";
}

// ── §18.3 stage 8: disruption shaping (the linked B4 spec's schedule) ───────

/** Target rule: a matched direct supplier wins; a deep-tier-only match
 * targets the project supplier the mapped SuppliesTo triple reaches (the
 * tier-1 node the disruption propagates through). Null when only material
 * matches exist (no node to disrupt — the alert still refuses per gate 4's
 * B4 dependency, stated honestly). */
export function disruptionTarget(matches: ExposureMatch[]): ExposureMatch | null {
  return matches.find((m) => m.kind === "direct_supplier") ??
    matches.find((m) => m.kind === "deep_tier_supplier") ?? null;
}

export function shapeDisruptionSchedule(
  eventType: EventType,
  targetSupplierId: string,
): Array<Record<string, unknown>> {
  return [{
    target: targetSupplierId,
    target_type: "node",
    start_day: 1,
    duration_days: EVENT_DURATION_DAYS[eventType],
    magnitude_pct: 100,
  }];
}

// ── The impact law (§18.3 hard gate 8): simulation results ONLY ─────────────

export interface AlertImpact {
  status: "pending" | "complete";
  note?: string;
  kpi?: string;
  min?: number;
  max?: number;
  mean?: number;
  replications?: number;
  run_id?: string;
  /** The §4.3 citation the fill stamps — run_replications rows of run_id. */
  citation?: { kind: "table_rows"; ref: "run_replications"; rows: string[] };
}

export const IMPACT_PENDING: AlertImpact = {
  status: "pending",
  note: "Impact ranges are simulation results only — this alert shows none until the linked run completes.",
};

const round6 = (v: number): number => Math.round(v * 1e6) / 1e6;

/**
 * The ONLY constructor of a complete impact block: min/max/mean of the run's
 * primary KPI over its done replications, citation = the run's replication
 * rows. Returns null while the run is not done or has no usable rep KPIs —
 * the alert then honestly stays "pending". Pure over injected rows; consumed
 * by riskAlertApply.fillRiskAlertImpact AND the get_risk_alerts read.
 */
export function computeAlertImpact(
  run: Record<string, unknown> | null,
  replications: Array<Record<string, unknown>>,
  primaryKpi = "fill_rate",
): AlertImpact | null {
  if (!run || String(run.status ?? "") !== "done") return null;
  const kpi = String((run as { primary_kpi?: unknown }).primary_kpi ?? "") || primaryKpi;
  const values: number[] = [];
  for (const rep of replications) {
    if (String(rep.status ?? "done") !== "done") continue;
    const kpis = (rep.kpis ?? {}) as Record<string, unknown>;
    const v = Number(kpis[kpi]);
    if (Number.isFinite(v)) values.push(v);
  }
  if (values.length === 0) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return {
    status: "complete",
    kpi,
    min: round6(min),
    max: round6(max),
    mean: round6(mean),
    replications: values.length,
    run_id: String(run.id ?? ""),
    citation: { kind: "table_rows", ref: "run_replications", rows: [String(run.id ?? "")] },
  };
}
