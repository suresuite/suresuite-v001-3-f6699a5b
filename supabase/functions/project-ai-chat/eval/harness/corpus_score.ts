// B8 corpus scorer (ai-agents.md §18.2 nc-10 — the Wichmann corpus
// discipline). Exact-match micro precision/recall/F1 over the annotated
// corpus: entities on (type, text) and relations on (subject, relation,
// object), whitespace-folded and case-insensitive, set semantics per
// sentence. Deterministic and dependency-free — the same scorer runs in the
// CI tier (against the committed baseline extractor) and in the model-scored
// tier (run_model_eval.ts --corpus, against live zero-shot extraction).

export interface GoldEntity {
  type: string;
  text: string;
}

export interface GoldTriple {
  subject: string;
  relation: string;
  object: string;
}

export interface CorpusSentence {
  id: string;
  text: string;
  entities: GoldEntity[];
  triples: GoldTriple[];
}

export interface CorpusFile {
  corpus_version: number;
  note: string;
  sentences: CorpusSentence[];
}

export interface Prediction {
  entities: GoldEntity[];
  triples: GoldTriple[];
}

export interface Prf {
  tp: number;
  fp: number;
  fn: number;
  precision: number;
  recall: number;
  f1: number;
}

const fold = (s: string): string => String(s ?? "").replace(/\s+/g, " ").trim().toLowerCase();

const entityKey = (e: GoldEntity): string => `${fold(e.type)}|${fold(e.text)}`;
const tripleKey = (t: GoldTriple): string => `${fold(t.subject)}|${fold(t.relation)}|${fold(t.object)}`;

function prf(tp: number, fp: number, fn: number): Prf {
  const precision = tp + fp === 0 ? 0 : tp / (tp + fp);
  const recall = tp + fn === 0 ? 0 : tp / (tp + fn);
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return { tp, fp, fn, precision, recall, f1 };
}

function scoreKeyed(
  golds: string[][],
  preds: string[][],
): Prf {
  let tp = 0;
  let fp = 0;
  let fn = 0;
  for (let i = 0; i < golds.length; i++) {
    const gold = new Set(golds[i]);
    const pred = new Set(preds[i] ?? []);
    for (const k of pred) {
      if (gold.has(k)) tp += 1;
      else fp += 1;
    }
    for (const k of gold) {
      if (!pred.has(k)) fn += 1;
    }
  }
  return prf(tp, fp, fn);
}

/** Micro P/R/F1 for entities across the corpus (per-sentence set match on
 * (type, text)). `predictions` is index-aligned with `sentences`. */
export function scoreEntities(sentences: CorpusSentence[], predictions: Prediction[]): Prf {
  return scoreKeyed(
    sentences.map((s) => s.entities.map(entityKey)),
    predictions.map((p) => (p?.entities ?? []).map(entityKey)),
  );
}

/** Micro P/R/F1 for relations across the corpus (per-sentence set match on
 * (subject, relation, object)). */
export function scoreRelations(sentences: CorpusSentence[], predictions: Prediction[]): Prf {
  return scoreKeyed(
    sentences.map((s) => s.triples.map(tripleKey)),
    predictions.map((p) => (p?.triples ?? []).map(tripleKey)),
  );
}

export interface CorpusScores {
  ner: Prf;
  re: Prf;
}

export function scoreCorpus(sentences: CorpusSentence[], predictions: Prediction[]): CorpusScores {
  return {
    ner: scoreEntities(sentences, predictions),
    re: scoreRelations(sentences, predictions),
  };
}
