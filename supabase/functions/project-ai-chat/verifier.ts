// Pre-send citation verifier — Phase H1 (ai-agents.md §22.3).
//
// Deterministic check every persona/agent reply passes BEFORE it ships (and
// before the chat-store append). Two layers:
//   1. membership — every entity-id-shaped token and every high-precision
//      numeric claim in the reply must appear in the turn's grounded
//      vocabulary (this turn's ToolEnvelope.data payloads + the CONTEXT
//      block's serialized artifacts + the user's own message);
//   2. resolution — every [n] marker binds to a citation, every citation
//      resolves via _shared/citations.ts, every simulation-result sentence
//      carries a `run` citation.
// On failure: ONE corrective retry (a system-side addendum naming the
// violations verbatim); still failing ⇒ the reply is REPLACED by the §22.5
// honest-refusal template, server-instantiated (typed parts still render —
// data the tools returned is never withheld). Pass / retry-once / replace
// are the ONLY outcomes: the verifier never edits a reply.
//
// The id lexicon is LEARNED per request from the envelopes (§22.3/§20.7):
// shape signatures compiled from the ids the tools actually returned — never
// a hardcoded, project-shaped regex. False-positive posture: extraction is
// deliberately narrow (id-shaped tokens + numbers with ≥ 3 significant
// digits or %/currency markers); hedged prose with neither always passes.
//
// Scope note (§22.3 as-implemented): verification runs when a project is
// attached — without a project there are no tools, no grounded vocabulary
// and no project claims to verify, and the no-project prompt already forbids
// numeric facts (§2.1/§22.4 project_block).
//
// This module is also the eval checker (§7.7-1: build once): the coverage
// suite and run_model_eval.ts drive verifyReply/verifyWithRetry directly.

import type { ToolEnvelope } from "./tools.ts";
import { canonicalJson, sha256Hex } from "./telemetry.ts";
import {
  resolveCitation,
  type Citation,
  type CitationDb,
} from "../_shared/citations.ts";

export function verifierEnabled(): boolean {
  return (Deno.env.get("VERIFIER_ENABLED") ?? "").trim().toLowerCase() === "true";
}

// ---------- recorded tool calls (the evidence source) ----------

/** One executed tool call with its full envelope — collected via
 * RunChatOptions.onToolResult; the model never sees or mints these. */
export interface RecordedToolCall {
  name: string;
  args: Record<string, unknown>;
  envelope: ToolEnvelope;
}

export type ViolationClass = "entity" | "number" | "marker" | "citation" | "uncited_result";

export interface Violation {
  class: ViolationClass;
  /** The offending reply token/marker, when one exists. */
  token?: string;
  detail: string;
}

export interface VerifyResult {
  ok: boolean;
  violations: Violation[];
}

// ---------- grounded vocabulary (layer 1) ----------

const NUMBER_IN_TEXT = /\d[\d,]*(?:\.\d+)?/g;

interface Vocabulary {
  /** Lowercased full strings and word tokens from envelopes+context+message. */
  tokens: Set<string>;
  /** Every numeric value seen (parsed from numbers and number-bearing text). */
  numbers: number[];
  /** Learned id-shape signatures (see signatureOf). */
  idSignatures: Set<string>;
}

/** Shape signature: digit runs → '9', letter runs → 'A', separators kept.
 * "001409784A" → "9A" · "MAT-4" → "A-9" · "S1" → "A9". Signatures are
 * learned only from tokens that mix digits with letters/separators — pure
 * numbers belong to the numeric-claim rule, not the id rule. */
function signatureOf(token: string): string {
  return token
    .replace(/[0-9]+/g, "9")
    .replace(/[A-Za-z]+/g, "A");
}

function isIdShapedCandidate(token: string): boolean {
  if (token.length < 2) return false;
  if (!/\d/.test(token)) return false;
  // Purely numeric tokens (incl. decimals like "82.4") are NUMBERS — they
  // belong to the numeric-claim rule, never the id rule.
  if (/^[\d.,]+$/.test(token)) return false;
  // English ordinals are prose, not ids ("18th" would otherwise collide with
  // learned digit+letter signatures like 001409784A's).
  if (/^\d+(st|nd|rd|th)$/i.test(token)) return false;
  // Multiplier notation is a QUANTITY, not an id: a BOM reply naturally reads
  // "Frame x2, Assembly x1", and signatureOf("x2") is "A9" — the very shape
  // learned from ids like M1/XP1/C1, so every such quantity was reported as a
  // fabricated entity (cov-03). Excluding it can only ever suppress a token
  // that is ABSENT from the grounded vocabulary, so a project that really does
  // own an entity "X2" still resolves it by membership and is unaffected.
  if (/^x\d+$/i.test(token)) return false;
  return /[A-Za-z]/.test(token) || /[-_./]/.test(token);
}

const TOKEN_RE = /[A-Za-z0-9][\w./-]*/g;

function addText(vocab: Vocabulary, text: string): void {
  const t = text.trim();
  if (!t) return;
  vocab.tokens.add(t.toLowerCase());
  for (const m of t.match(TOKEN_RE) ?? []) {
    const tok = m.replace(/[./-]+$/, "");
    if (!tok) continue;
    vocab.tokens.add(tok.toLowerCase());
    if (isIdShapedCandidate(tok)) vocab.idSignatures.add(signatureOf(tok));
  }
  for (const n of t.match(NUMBER_IN_TEXT) ?? []) {
    const v = Number(n.replace(/,/g, ""));
    if (Number.isFinite(v)) vocab.numbers.push(v);
  }
}

function walkData(vocab: Vocabulary, value: unknown): void {
  if (value == null) return;
  if (typeof value === "string") return addText(vocab, value);
  if (typeof value === "number") {
    if (Number.isFinite(value)) {
      vocab.numbers.push(value);
      vocab.tokens.add(String(value).toLowerCase());
    }
    return;
  }
  if (typeof value === "boolean") return;
  if (Array.isArray(value)) {
    for (const v of value) walkData(vocab, v);
    return;
  }
  if (typeof value === "object") {
    for (const v of Object.values(value as Record<string, unknown>)) walkData(vocab, v);
  }
}

/** The grounded vocabulary of one turn (§22.3 layer 1): envelope payloads +
 * CONTEXT artifacts + the user's own message. Compiled per request. */
export function buildGroundedVocabulary(
  calls: ReadonlyArray<RecordedToolCall>,
  contextText: string | undefined,
  userMessage: string,
): Vocabulary {
  const vocab: Vocabulary = { tokens: new Set(), numbers: [], idSignatures: new Set() };
  for (const call of calls) {
    walkData(vocab, call.envelope.data);
    if (call.envelope.meta?.note) addText(vocab, call.envelope.meta.note);
  }
  if (contextText) addText(vocab, contextText);
  addText(vocab, userMessage);
  return vocab;
}

// ---------- reply claim extraction (layer 1) ----------

/** [n] markers and list ordinals are never claims (§22.3). */
function stripNonClaims(reply: string): string {
  return reply
    .replace(/\[\d+\]/g, " ")
    .replace(/^\s*\d+[.)]\s+/gm, " ");
}

function significantDigits(numText: string): number {
  const digits = numText.replace(/[^0-9]/g, "").replace(/^0+/, "");
  return digits.length;
}

interface NumericClaim {
  raw: string;
  value: number;
  decimals: number;
  percent: boolean;
  currency: boolean;
}

const CLAIM_RE = /[€$£]?\d[\d,]*(?:\.\d+)?%?/g;

function extractNumericClaims(reply: string): NumericClaim[] {
  const out: NumericClaim[] = [];
  for (const m of stripNonClaims(reply).match(CLAIM_RE) ?? []) {
    const percent = m.endsWith("%");
    const currency = /^[€$£]/.test(m);
    const numText = m.replace(/[€$£%]/g, "");
    const value = Number(numText.replace(/,/g, ""));
    if (!Number.isFinite(value)) continue;
    const sig = significantDigits(numText);
    // Narrow by design: a claim is checkable when it has ≥ 3 significant
    // digits or carries a %/currency marker. Bare 4-digit calendar years are
    // prose, not data claims.
    if (!(sig >= 3 || percent || currency)) continue;
    if (!percent && !currency && Number.isInteger(value) && value >= 1900 && value <= 2100 && !numText.includes(".")) continue;
    const decimals = numText.includes(".") ? numText.split(".")[1].length : 0;
    out.push({ raw: m, value, decimals, percent, currency });
  }
  return out;
}

/** Rounding-tolerant membership: a grounded number matches when it rounds to
 * the claim at the claim's displayed precision; % claims also match their
 * fraction form (0.2 grounds "20%"). Shared by layer 1 and the layer-2
 * run-sourced-sentence test so the two can never disagree. */
function claimMatchesNumbers(claim: NumericClaim, numbers: ReadonlyArray<number>): boolean {
  const tol = Math.pow(10, -claim.decimals) / 2 + 1e-9;
  if (numbers.some((g) => Math.abs(Number(g.toFixed(claim.decimals)) - claim.value) <= tol)) return true;
  if (claim.percent) {
    return numbers.some((g) => Math.abs(Number((g * 100).toFixed(claim.decimals)) - claim.value) <= tol);
  }
  return false;
}

function numberGrounded(claim: NumericClaim, vocab: Vocabulary): boolean {
  if (vocab.tokens.has(claim.raw.toLowerCase())) return true;
  return claimMatchesNumbers(claim, vocab.numbers);
}

function extractIdShapedTokens(reply: string, vocab: Vocabulary): string[] {
  const out: string[] = [];
  for (const m of stripNonClaims(reply).match(TOKEN_RE) ?? []) {
    const tok = m.replace(/[./-]+$/, "");
    if (!isIdShapedCandidate(tok)) continue;
    if (!vocab.idSignatures.has(signatureOf(tok))) continue;
    out.push(tok);
  }
  return out;
}

// ---------- layer 2 helpers ----------

const uuidRe = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

const RUN_TOOLS = new Set(["get_run_results", "find_completed_run"]);

function runNumbersOf(calls: ReadonlyArray<RecordedToolCall>): number[] {
  const vocab: Vocabulary = { tokens: new Set(), numbers: [], idSignatures: new Set() };
  for (const call of calls) {
    if (RUN_TOOLS.has(call.name)) walkData(vocab, call.envelope.data);
  }
  return vocab.numbers;
}

function sentencesOf(reply: string): string[] {
  return reply.split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
}

// ---------- verifyReply (§22.3) ----------

export interface VerifyInput {
  reply: string;
  calls: ReadonlyArray<RecordedToolCall>;
  citations: ReadonlyArray<Citation>;
  /** CONTEXT-block artifacts serialized into the turn's system prompt (agent
   * turns); personas pass their summary block, when any. */
  contextText?: string;
  userMessage: string;
  projectId: string;
  /** Layer-2 resolver client; layer 1 alone runs without DB reads. */
  db?: CitationDb | null;
  /** `<tool>#<hash12>` refs recorded this turn, for tool_call resolution. */
  toolCallRefs?: ReadonlySet<string>;
}

export async function verifyReply(input: VerifyInput): Promise<VerifyResult> {
  const violations: Violation[] = [];
  const vocab = buildGroundedVocabulary(input.calls, input.contextText, input.userMessage);

  // Layer 1 — membership (no DB reads; every reply, all models).
  for (const tok of extractIdShapedTokens(input.reply, vocab)) {
    if (!vocab.tokens.has(tok.toLowerCase())) {
      violations.push({
        class: "entity",
        token: tok,
        detail: `entity-shaped token "${tok}" appears in no tool result this turn`,
      });
    }
  }
  for (const claim of extractNumericClaims(input.reply)) {
    if (!numberGrounded(claim, vocab)) {
      violations.push({
        class: "number",
        token: claim.raw,
        detail: `number "${claim.raw}" appears in no tool result this turn`,
      });
    }
  }

  // Layer 2 — resolution (runs when the reply carries markers or evidence).
  const markers = [...input.reply.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1]));
  if (markers.length > 0 || input.citations.length > 0) {
    for (const n of new Set(markers)) {
      if (!Number.isInteger(n) || n < 1 || n > input.citations.length) {
        violations.push({
          class: "marker",
          token: `[${n}]`,
          detail: `marker [${n}] binds to no citation entry (have ${input.citations.length})`,
        });
      }
    }
    if (input.db) {
      const refs = input.toolCallRefs ?? new Set<string>();
      for (let i = 0; i < input.citations.length; i++) {
        const c = input.citations[i];
        const res = await resolveCitation(c, input.projectId, input.db, { toolCallRefs: refs });
        if (!res.ok) {
          violations.push({
            class: "citation",
            token: `[${i + 1}]`,
            detail: `citation [${i + 1}] (${c.kind}:${c.ref}) does not resolve: ${res.reason ?? "unknown"}`,
          });
        }
      }
    }
    // Every simulation-result sentence carries at least one run citation.
    const runNumbers = runNumbersOf(input.calls);
    if (runNumbers.length > 0) {
      for (const sentence of sentencesOf(input.reply)) {
        const claims = extractNumericClaims(sentence);
        const fromRun = claims.some((c) => claimMatchesNumbers(c, runNumbers));
        if (!fromRun) continue;
        const sentenceMarkers = [...sentence.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1]));
        const hasRunCitation = sentenceMarkers.some((n) => input.citations[n - 1]?.kind === "run");
        if (!hasRunCitation) {
          violations.push({
            class: "uncited_result",
            detail: `simulation-result sentence lacks a run citation: "${sentence.slice(0, 120)}"`,
          });
        }
      }
    }
  }

  return { ok: violations.length === 0, violations };
}

// ---------- citation assembly (§22.2: handler-side, never model-minted) ----------

/** One §4.3 entry per recorded tool call, in call order — [n] binds to the
 * nth call (§22.4: "numbered for you in order of your tool calls"). Run/
 * validation reads upgrade to their stronger resolvable kinds; run entries
 * quote the 12-hex hash prefixes when the envelope exposes them (§22.2). */
export async function assembleCitations(
  calls: ReadonlyArray<RecordedToolCall>,
): Promise<{ citations: Citation[]; toolCallRefs: Set<string> }> {
  const citations: Citation[] = [];
  const toolCallRefs = new Set<string>();
  for (const call of calls) {
    const sha = await sha256Hex(canonicalJson(call.args ?? {}));
    const ref = `${call.name}#${sha.slice(0, 12)}`;
    toolCallRefs.add(ref);
    if (citations.length >= 64) continue; // §4.3 maxItems
    if (RUN_TOOLS.has(call.name)) {
      const ids = uniqueUuids(call.envelope.data);
      if (ids.length > 0) {
        citations.push({ kind: "run", ref: ids[0], ...runHashQuote(call.envelope.data) });
        continue;
      }
    }
    if (call.name === "get_validation_status") {
      const ids = uniqueUuids(call.envelope.data);
      if (ids.length > 0) {
        citations.push({ kind: "validation_card", ref: ids[0] });
        continue;
      }
    }
    citations.push({ kind: "tool_call", ref });
  }
  return { citations, toolCallRefs };
}

function uniqueUuids(data: unknown): string[] {
  const text = JSON.stringify(data ?? "");
  return [...new Set((text.match(uuidRe) ?? []).map((s) => s.toLowerCase()))];
}

function runHashQuote(data: unknown): { quote?: string } {
  try {
    const text = JSON.stringify(data ?? "");
    const pick = (key: string): string | null => {
      const m = new RegExp(`\\\\?"${key}\\\\?":\\\\?"([0-9a-f-]{12,})`).exec(text);
      return m ? m[1].slice(0, 12) : null;
    };
    const parts: string[] = [];
    const policy = pick("policy_hash");
    const graph = pick("graph_hash");
    const scenario = pick("scenario_hash");
    if (policy) parts.push(`policy=${policy}`);
    if (graph) parts.push(`graph=${graph}`);
    if (scenario) parts.push(`scenario=${scenario}`);
    return parts.length > 0 ? { quote: parts.join(" ") } : {};
  } catch {
    return {};
  }
}

// ---------- retry addendum + §22.5 fallback (server-instantiated) ----------

/** §22.3 verbatim skeleton for the ONE corrective retry. */
export function buildCorrectiveAddendum(violations: ReadonlyArray<Violation>): string {
  const items = violations.slice(0, 12).map((v) => v.token ?? v.detail).join(", ");
  return `Your reply stated these ungrounded items: ${items}. Remove or ground each, or refuse honestly.`;
}

/** §22.5 honest-refusal template, instantiated by the SERVER (the model is
 * not in the loop for its own refusal). nearest_fact comes from this turn's
 * envelopes; nearest_action from the §17.3 suggestion rules when the caller
 * has one. */
export function buildFallbackReply(args: {
  userMessage: string;
  calls: ReadonlyArray<RecordedToolCall>;
  nearestAction?: string | null;
}): string {
  const clip = args.userMessage.trim().replace(/\s+/g, " ").slice(0, 120);
  const askedThing = `answer “${clip}” with verified facts`;
  let nearestFact: string | null = null;
  for (const call of args.calls) {
    const note = call.envelope.meta?.note;
    if (note && !["empty", "error", "unknown_tool"].includes(note)) {
      nearestFact = note.replace(/\.\s*$/, "");
      break;
    }
  }
  if (!nearestFact) {
    const withRows = args.calls.find((c) => c.envelope.meta.row_count > 0);
    if (withRows) {
      nearestFact = `${withRows.envelope.meta.tool} returned ${withRows.envelope.meta.row_count} grounded row${withRows.envelope.meta.row_count === 1 ? "" : "s"} (shown below)`;
    }
  }
  const lines = [`I can't ${askedThing} from this project's data yet.`];
  if (nearestFact) lines.push(`What I can tell you: ${nearestFact}.`);
  if (args.nearestAction) {
    const action = args.nearestAction.replace(/\.\s*$/, "");
    lines.push(`Want me to ${action.charAt(0).toLowerCase()}${action.slice(1)}?`);
  }
  return lines.join("\n");
}

// ---------- the pass / retry-once / replace orchestration (§22.3) ----------

export interface VerifiedAttempt {
  reply: string;
  calls: RecordedToolCall[];
}

export interface VerifyWithRetryResult<T extends VerifiedAttempt> {
  /** The attempt whose reply ships (first, retry, or first/retry with the
   * fallback reply substituted). */
  attempt: T;
  reply: string;
  verified: boolean;
  fallback: boolean;
  retried: boolean;
  citations: Citation[];
  /** Violation counts by class from the FINAL failing verification (empty on
   * pass) — the §7.5-safe payload of verifier.blocked_reply. */
  violationCounts: Partial<Record<ViolationClass, number>>;
}

/** Runs verifyReply on an attempt; on failure re-invokes the SAME turn once
 * with the corrective addendum; on a second failure substitutes the §22.5
 * fallback. Never edits a reply — pass / retry-once / replace only. */
export async function verifyWithRetry<T extends VerifiedAttempt>(args: {
  projectId: string;
  db: CitationDb | null;
  userMessage: string;
  contextText?: string;
  attempt: T;
  /** Re-invoke the same turn with the addendum; null ⇒ no retry possible
   * (counts against MAX_LLM_CALLS_PER_REQUEST once §21.5 budgets land). */
  retry: ((addendum: string) => Promise<T | null>) | null;
  /** Lazy §17.3 nearest-action provider — resolved only if the fallback
   * fires, so the happy path spends no extra reads. */
  nearestAction?: (() => Promise<string | null>) | null;
}): Promise<VerifyWithRetryResult<T>> {
  const check = async (attempt: T) => {
    const { citations, toolCallRefs } = await assembleCitations(attempt.calls);
    const result = await verifyReply({
      reply: attempt.reply,
      calls: attempt.calls,
      citations,
      contextText: args.contextText,
      userMessage: args.userMessage,
      projectId: args.projectId,
      db: args.db,
      toolCallRefs,
    });
    return { citations, result };
  };

  const first = await check(args.attempt);
  if (first.result.ok) {
    return {
      attempt: args.attempt,
      reply: args.attempt.reply,
      verified: true,
      fallback: false,
      retried: false,
      citations: first.citations,
      violationCounts: {},
    };
  }

  let final: T = args.attempt;
  let finalCheck = first;
  let retried = false;
  if (args.retry) {
    const second = await args.retry(buildCorrectiveAddendum(first.result.violations));
    if (second) {
      retried = true;
      final = second;
      finalCheck = await check(second);
      if (finalCheck.result.ok) {
        return {
          attempt: final,
          reply: final.reply,
          verified: true,
          fallback: false,
          retried,
          citations: finalCheck.citations,
          violationCounts: {},
        };
      }
    }
  }

  const counts: Partial<Record<ViolationClass, number>> = {};
  for (const v of finalCheck.result.violations) counts[v.class] = (counts[v.class] ?? 0) + 1;
  let nearestAction: string | null = null;
  if (args.nearestAction) {
    try {
      nearestAction = await args.nearestAction();
    } catch { /* the action line is optional (§22.5 conditional block) */ }
  }
  return {
    attempt: final,
    reply: buildFallbackReply({
      userMessage: args.userMessage,
      calls: final.calls,
      nearestAction,
    }),
    verified: false,
    fallback: true,
    retried,
    citations: finalCheck.citations,
    violationCounts: counts,
  };
}
