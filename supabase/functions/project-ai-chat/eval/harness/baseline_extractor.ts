// B8 rule-based baseline extractor (ai-agents.md §18.2 nc-10, §10 note 36h)
// — the Wichmann-style deterministic floor the corpus metrics are computed
// against on every PR. Deliberately GENERIC rules only — no corpus-derived
// gazetteer, so the floor is a real floor:
//   Company  = capitalized token run ending in a legal/organizational suffix
//   Location = capitalized run after an "in"/"near" preposition cue
//   Material = lowercase noun span inside a produce/supply verb frame
//   Person   = title pattern (CEO/CFO/Dr.)
// Relations = verb/preposition patterns over the detected entities. Fully
// reproducible in CI; the zero-shot LLM extraction is measured against the
// same corpus in the model-scored tier (the AlMahri numbers are that bar).

import type { GoldTriple, Prediction } from "./corpus_score.ts";

const COMPANY_SUFFIXES = new Set(["AG", "GmbH", "Ltd", "Inc", "SA", "AB", "SE", "Plc", "Works"]);

const stripPunct = (token: string): string => token.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");

interface Found {
  type: string;
  text: string;
  index: number;
}

function findCompanies(sentence: string): Found[] {
  const out: Found[] = [];
  const tokens = sentence.split(/\s+/);
  let run: string[] = [];
  let runStartCharIdx = 0;
  let charIdx = 0;
  for (const raw of tokens) {
    const clean = stripPunct(raw);
    if (/^[A-Z]/.test(clean)) {
      if (run.length === 0) runStartCharIdx = charIdx;
      run.push(clean);
      // A suffix token closes the run as a company mention.
      if (COMPANY_SUFFIXES.has(clean) && run.length >= 2) {
        out.push({ type: "Company", text: run.join(" "), index: runStartCharIdx });
        run = [];
      }
    } else {
      run = [];
    }
    charIdx += raw.length + 1;
  }
  return out;
}

/** Locations: a capitalized run right after an "in"/"near" cue (with an
 * optional "the" and an internal "of", so "near the Port of Hamburg" works).
 * Runs that belong to a detected company are excluded. */
function findLocations(sentence: string, companies: Found[]): Found[] {
  const out: Found[] = [];
  const re = /\b(?:in|near)\s+(?:the\s+)?([A-Z][\w-]*(?:\s+of\s+[A-Z][\w-]*)?)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sentence)) !== null) {
    const idx = m.index + m[0].length - m[1].length;
    const insideCompany = companies.some(
      (c) => idx >= c.index && idx < c.index + c.text.length,
    );
    if (insideCompany) continue;
    if (out.some((f) => f.text === m![1])) continue;
    out.push({ type: "Location", text: m[1], index: idx });
  }
  return out;
}

const GOODS_STOP = new Set(["at", "in", "for", "to", "by", "from", "under", "each", "and", "with", "the", "its", "a", "an"]);

/** Materials: the lowercase noun span inside a produce/supply verb frame
 * ("produces power modules", "supplies epoxy resin to", "buys wiring
 * harnesses from"). Generic — everything found is typed Material (the
 * baseline cannot tell products apart; that is part of the floor). */
function findGoods(sentence: string): Found[] {
  const out: Found[] = [];
  const push = (span: string, atIdx: number) => {
    const tokens: string[] = [];
    for (const t of span.split(/\s+/)) {
      const clean = stripPunct(t);
      if (!clean || GOODS_STOP.has(clean.toLowerCase()) || /^[A-Z0-9]/.test(clean)) break;
      tokens.push(clean);
      if (tokens.length >= 3) break;
    }
    if (tokens.length === 0) return;
    const text = tokens.join(" ");
    if (out.some((f) => f.text === text)) return;
    out.push({ type: "Material", text, index: atIdx });
  };
  const frames = [
    /(?:produces|manufactures|makes|fabricates|assembles|maker of|distributes)\s+(?:the\s+)?([a-z][^.,]*)/g,
    /(?:supplies|delivers|ships|provides|sells|sources|procures|buys)\s+([a-z][^.,]*?)\s+(?:to|from)\s/g,
  ];
  for (const re of frames) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(sentence)) !== null) {
      push(m[1], m.index + m[0].indexOf(m[1]));
    }
  }
  return out;
}

function findPersons(sentence: string): Found[] {
  const out: Found[] = [];
  const re = /\b(?:CEO|CFO|Dr\.)\s+([A-Z][a-z]+ [A-Z][a-z]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sentence)) !== null) {
    out.push({ type: "Person", text: m[1], index: m.index });
  }
  return out;
}

const before = (entities: Found[], idx: number, type?: string): Found | undefined => {
  let best: Found | undefined;
  for (const e of entities) {
    if (type && e.type !== type) continue;
    if (e.index + e.text.length <= idx && (!best || e.index > best.index)) best = e;
  }
  return best;
};

const after = (entities: Found[], idx: number, types: string[]): Found | undefined => {
  let best: Found | undefined;
  for (const e of entities) {
    if (!types.includes(e.type)) continue;
    if (e.index >= idx && (!best || e.index < best.index)) best = e;
  }
  return best;
};

const SUPPLY_VERBS = [
  "is a supplier to",
  "is a supplier of",
  "signed a supply contract with",
  "supplies",
  "delivers",
  "ships",
  "provides",
  "sells",
];
const INVERSE_VERBS = ["sources", "procures", "buys"];
const PRODUCE_VERBS = ["produces", "manufactures", "makes", "fabricates", "assembles", "is a maker of"];
const LOCATED_PATTERNS = ["headquartered in", "based in", "operates a plant in", "operates a site in"];
const OWNED_PATTERNS = ["a subsidiary of", "a unit of", "a division of"];

function findRelations(sentence: string, entities: Found[]): GoldTriple[] {
  const out: GoldTriple[] = [];
  const lower = sentence.toLowerCase();
  const push = (subject?: Found, relation?: string, object?: Found) => {
    if (!subject || !object || !relation || subject.text === object.text) return;
    if (out.some((t) => t.subject === subject.text && t.relation === relation && t.object === object.text)) return;
    out.push({ subject: subject.text, relation, object: object.text });
  };

  for (const verb of SUPPLY_VERBS) {
    const idx = lower.indexOf(verb);
    if (idx < 0) continue;
    push(
      before(entities, idx, "Company"),
      "SuppliesTo",
      after(entities, idx + verb.length, ["Company"]),
    );
    break;
  }

  for (const verb of INVERSE_VERBS) {
    const idx = lower.indexOf(`${verb} `);
    if (idx < 0) continue;
    const fromIdx = lower.indexOf(" from ", idx);
    if (fromIdx < 0) continue;
    push(
      after(entities, fromIdx + 6, ["Company"]),
      "SuppliesTo",
      before(entities, idx, "Company"),
    );
    break;
  }

  const passive = / (?:produced|assembled) by /.exec(lower);
  if (passive) {
    let objectEnt: Found | undefined;
    for (const e of entities) {
      if ((e.type !== "Material" && e.type !== "Product") || e.index >= passive.index) continue;
      if (!objectEnt || e.index > objectEnt.index) objectEnt = e;
    }
    push(after(entities, passive.index + passive[0].length, ["Company"]), "Produces", objectEnt);
  } else {
    for (const verb of PRODUCE_VERBS) {
      const idx = lower.indexOf(verb);
      if (idx < 0) continue;
      push(
        before(entities, idx, "Company"),
        "Produces",
        after(entities, idx + verb.length, ["Material", "Product"]),
      );
      break;
    }
  }

  for (const pattern of LOCATED_PATTERNS) {
    const idx = lower.indexOf(pattern);
    if (idx < 0) continue;
    push(
      before(entities, idx, "Company"),
      "LocatedIn",
      after(entities, idx + pattern.length, ["Location"]),
    );
    break;
  }

  for (const pattern of OWNED_PATTERNS) {
    const idx = lower.indexOf(pattern);
    if (idx < 0) continue;
    push(
      before(entities, idx, "Company"),
      "OwnedBy",
      after(entities, idx + pattern.length, ["Company"]),
    );
    break;
  }
  const acquired = lower.indexOf(" acquired ");
  if (acquired >= 0) {
    push(
      after(entities, acquired + 10, ["Company"]),
      "OwnedBy",
      before(entities, acquired, "Company"),
    );
  }

  return out;
}

/** Extract one sentence with the rule-based baseline. */
export function baselineExtract(sentence: string): Prediction {
  const companies = findCompanies(sentence);
  const entities: Found[] = [
    ...companies,
    ...findLocations(sentence, companies),
    ...findGoods(sentence),
    ...findPersons(sentence),
  ].sort((a, b) => a.index - b.index);
  return {
    entities: entities.map(({ type, text }) => ({ type, text })),
    triples: findRelations(sentence, entities),
  };
}
