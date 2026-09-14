# Literature review prompt

**A reusable, systematic-review-grade prompt for interdisciplinary topics spanning OM/SCM, AI/ML, IS, HCI and AI governance**

*Companion to `ai-for-scm-positioning.md`. Designed for a capable LLM with web/database search. Use it in a fresh session; do not mix with drafting work.*

---

## Why this prompt is built the way it is

An interdisciplinary topic fails a literature review in three specific ways, and each stage below exists to prevent one of them:

1. **Corpus blindness.** Each field has its own venues, its own publication culture (journals in OM; conferences in CS; both plus grey literature in governance), and its own idea of what counts as evidence. A single search string tuned to one field silently misses the others.
2. **The translation problem.** The same construct carries different names across fields — *grounding* (NLP) ≈ *verification & validation* (simulation) ≈ *auditability* (IS) ≈ *traceability* (engineering) ≈ *provenance* (data management). A review that searches only its home field's vocabulary concludes, wrongly, that the literature is silent.
3. **The "solved elsewhere" trap.** The most damaging reviewer response to interdisciplinary work is *"this is well known in [other field] since [year]."* Stage 5 hunts for that before a reviewer does.

## How to use it

1. Paste the prompt below into a fresh session, filling the bracketed fields in **SCOPE** and **DISCIPLINE MAP** (a worked example for the SuReSuite paper follows the prompt).
2. Run it **one stage at a time**, inspecting output before continuing. A hallucination in Stage 1 contaminates everything downstream.
3. **Verify every citation yourself.** The prompt forbids unverifiable references, but verification is your job. A fabricated DOI ends a paper's credibility — and in CS-adjacent work the risk is higher, because plausible-looking arXiv IDs and conference names are easy to generate. *(The same discipline the paper argues for: the model proposes, the human authorizes.)*

---

## The prompt

```
You are assisting with a systematic, INTERDISCIPLINARY literature review
intended for a top-tier peer-reviewed venue. Rigour standards: Webster &
Watson (concept-centric synthesis), PRISMA-style transparency of corpus
construction, and Kitchenham-style protocol discipline where the topic touches
computing research.

This topic spans multiple research communities. Your default failure mode is
to review only the field whose vocabulary I happen to use. Actively resist it.

SCOPE
- Topic: [one or two sentences, in plain terms]
- Research questions the review must serve:
  RQ1 [...]
  RQ2 [...]
  RQ3 [...]
- Time window: [e.g. 2018–2026 for the active conversation, with seminal
  earlier work admitted without limit via snowballing]
- Unit of interest: [e.g. the artefact / the decision / the organisation]

DISCIPLINE MAP (fill or refine; add fields I have missed and justify each)
| Field | Why it is relevant here | Flagship venues |
|---|---|---|
| [Operations / SCM] | [...] | [...] |
| [AI / ML / NLP] | [...] | [...] |
| [Information systems] | [...] | [...] |
| [HCI / human factors] | [...] | [...] |
| [AI safety / governance / FAccT] | [...] | [...] |
| [Simulation / systems engineering] | [...] | [...] |

ABSOLUTE RULES ON SOURCES — these override helpfulness
1. Never invent a reference. Every work you cite must be one you actually
   retrieved or that I supplied. If uncertain a work exists as described, mark
   it UNVERIFIED and say why you believe it exists.
2. Never invent a DOI, arXiv id, volume, issue, page range, or author list.
   Unknown fields are written "unknown" — never a plausible guess.
3. Label every claim: STATED (the paper says it) / INFERRED (you conclude it)
   / MY-ASSESSMENT (your judgement).
4. Mark the depth of each engagement: FULL-TEXT / ABSTRACT-ONLY / CITED-ONLY
   (you know it only through another paper's description).
5. Mark publication status: PEER-REVIEWED / PREPRINT / GREY (standard,
   technical report, industry white paper). Never present a preprint as
   peer-reviewed. Preprints are admissible in fast-moving AI subfields — say
   so explicitly and treat their claims as provisional.
6. If the literature is genuinely silent, say "the literature is silent on
   this." A stated gap is worth more to me than a manufactured citation.
   Silence is a finding.

STAGE 0 — DECOMPOSITION AND DISCIPLINE MAP (do only this now)
Decompose my topic into its constituent research CONVERSATIONS — the distinct
ongoing scholarly debates it touches — rather than into keywords. For each
conversation: which field owns it, what its central question is, who the
recognised anchor authors/groups are, and which review articles or handbook
chapters are the best entry points. Then propose the vocabulary translation
table: the same construct as each field names it (I expect terms to differ
across fields for identical ideas — find those synonym sets, because my search
strings must include all of them).
Output: the conversation list, the refined discipline map, and the
cross-field synonym sets. No paper claims yet.

STAGE 1 — CORPUS CONSTRUCTION, PER DISCIPLINE (after I approve Stage 0)
For EACH field in the map, give a tailored protocol — do not reuse one string
everywhere:
- Databases appropriate to that field (e.g. Scopus/WoS/ABI for management;
  ACM DL, IEEE Xplore, DBLP, ACL Anthology, arXiv/Semantic Scholar for
  computing; SSRN for early management work).
- Boolean strings adapted to that field's vocabulary, using the Stage 0
  synonym sets.
- The venue-quality threshold IN THAT FIELD'S OWN TERMS: journal rankings
  (ABS/AJG, VHB-JOURQUAL, FT50, JCR quartile) for management; conference
  tiers (CORE A*/A, or the field's recognised top-tier list) for computing —
  and note explicitly where a field's top venues are conferences, not
  journals, since a journals-only search would miss its best work.
- How to identify RECOGNISED work as distinct from merely recent: highly
  cited anchors, test-of-time / best-paper awards, works that named the
  subfield, and papers that later reviews treat as canonical. Use citation
  counts as a signal, never as the criterion, and state the retrieval date.
- Inclusion/exclusion criteria, de-duplication across databases, and both
  backward and forward snowballing from the seed set.
- Seed set (verified, supplied by me — anchors to snowball from):
  [paste verified references]
Output: per-field protocol tables + a combined PRISMA-style flow with expected
counts. Do NOT list papers you have not retrieved.

STAGE 2 — SCREENING AND CORPUS TABLE
One row per retrieved work: citation | field | venue + tier | year |
contribution type (theory / empirical / design-science / systems / review /
position) | problem addressed | approach | data or evaluation setting |
validation method | ground truth if any | reported failure modes and
limitations | status (PEER-REVIEWED/PREPRINT/GREY) | depth
(FULL-TEXT/ABSTRACT-ONLY/CITED-ONLY).
Report per-field counts so corpus imbalance is visible; if one field dominates,
say so and tell me whether that reflects the literature or my seed bias.

STAGE 3 — CROSS-DISCIPLINARY SYNTHESIS
(a) TRANSLATION MATRIX: construct × field, showing what each field calls it,
    how each field operationalises and measures it, and where the meanings
    genuinely diverge rather than merely differ in name. Divergences are
    often where contributions hide.
(b) CONCEPT MATRIX: concepts × works, concepts derived from the corpus rather
    than imposed.
(c) Synthesis written BY CONCEPT, never paper-by-paper. For each concept, state
    what is settled, what is contested, and how the fields' answers relate:
    do they agree, contradict, or simply not know about each other? Explicitly
    flag cases where field A has solved a problem field B still treats as open.

STAGE 4 — CRITICAL APPRAISAL
Appraise each cluster against ITS OWN field's standards (do not judge a design
-science systems paper by econometric criteria, or vice versa), then across
fields on these dimensions:
- Does the work validate its OUTPUT or its CONSEQUENCES? Distinguish sharply.
- Is performance measured against independent ground truth, or against the
  system's own artefacts?
- Are failure modes measured, or acknowledged only in a limitations paragraph?
- Is the evaluation reproducible (code, data, seeds, protocol)?
- Are the COSTS of proposed safeguards/interventions ever reported, or only
  their benefits?
- External validity: toy benchmark, single case, or field deployment?

STAGE 5 — GAP ANALYSIS, NOVELTY TEST, POSITIONING
(a) State gaps as testable propositions, ranked by how strongly the corpus
    supports their existence; for each, the evidence it is real (which works
    stop where), why it matters in practice, and the study that would close it.
(b) THE "SOLVED ELSEWHERE" CHECK — the most important step. For my central
    claim below, search each field in the map for prior work that already
    makes it, in that field's own vocabulary. Report anything close, even if
    it weakens my contribution. I would rather learn it now than at review.
(c) Then assess my positioning as a sceptical reviewer from EACH field in turn
    (an OM reviewer, an AI reviewer, an IS reviewer …): what is genuinely
    novel, what is already known there, what they would attack first, and what
    evidence would satisfy them.
My central claim: [paste your thesis in 2–4 sentences]

STYLE
Dense academic prose. No filler, no restating my question, no bullet padding
where a paragraph is the honest form. Be specifically uncertain where you are
uncertain, rather than hedging uniformly.
```

---

## Worked example — filling SCOPE and the DISCIPLINE MAP for this project

**Topic.** How generative AI and LLM-based agents can be applied to supply chain decision-making such that their advantages are exploited and their failure modes structurally contained.

**Discipline map** (the corpus that must be covered — a management-only review would miss half the relevant work):

| Field | Why relevant | Flagship venues |
|---|---|---|
| Operations / SCM | the decision domain; resilience, ripple effect, visibility, digital twins | JOM, POM, IJPR, IJPE, JBL, JSCM, M&SOM |
| AI / ML / NLP | LLM agents, retrieval-augmented generation, information extraction, hallucination, uncertainty quantification | NeurIPS, ICML, ICLR, ACL, EMNLP, AAAI, KDD |
| Information systems | design science, IT artefact evaluation, decision support, accountability | MISQ, ISR, JAIS, JMIS, EJIS |
| HCI / human factors | human–AI decision-making, appropriate reliance, automation bias, trust calibration | CHI, CSCW, IUI, Human Factors |
| AI safety / governance | evaluation, auditing, transparency, regulation | FAccT, AIES, plus grey literature: NIST AI RMF, ISO/IEC 42001, EU AI Act |
| Simulation / systems engineering | V&V, credibility of models, digital twin fidelity | Winter Simulation Conference, Simulation, EJOR |

**Cross-field synonym sets to search** (Stage 0's output for this topic — worth seeding directly):

- *grounding* ≈ verification & validation ≈ auditability ≈ traceability ≈ provenance ≈ evidential support
- *hallucination* ≈ fabrication ≈ ungrounded generation ≈ confabulation ≈ faithfulness failure
- *human-in-the-loop* ≈ human oversight ≈ appropriate reliance ≈ decision authority ≈ contestability
- *uncertainty quantification* ≈ calibration ≈ conformal prediction ≈ confidence interval ≈ risk bounds
- *supply chain map* ≈ supply network structure ≈ multi-tier visibility ≈ buyer–supplier relation extraction
- *surrogate model* ≈ metamodel ≈ emulator ≈ response surface

**Verified seed set** (anchors for snowballing — expand with your own):

- AlMahri, S., Xu, L. & Brintrup, A. (2026). Enhancing supply chain visibility with knowledge graphs and large language models. *IJPR*, 64(6), 2178–2209. doi:10.1080/00207543.2025.2575841
- Wichmann, P., Brintrup, A., Baker, S., Woodall, P. & McFarlane, D. Extracting supply chain maps from news articles using deep neural networks. *IJPR*.
- Talluri, S., Kull, T. J., Yildiz, H. & Yoon, J. (2013). Assessing the efficiency of risk mitigation strategies in supply chains. *JBL*, 34(4), 253–269. doi:10.1111/jbl.12025
- *(add: Ivanov & Dolgui on the ripple effect and digital supply chain twins; Choi et al. on nexus suppliers; Brintrup et al. on supply network science; Sargent on simulation V&V)*

---

## Follow-up prompts worth keeping

**Per-field adversarial review** — after a draft exists, in a fresh session. Run it once per discipline; the objections differ sharply:

```
Act as a hostile but fair Reviewer 2 for [venue], reviewing from a [field]
perspective. Here is my literature review section: [paste]. Identify: claims
without citation support; citations that do not establish what they are cited
for; literature a [field] expert would expect and I have missed (name specific
works; mark UNVERIFIED if unsure); places where I have applied another field's
evaluation standards inappropriately; and any prior work I have characterised
unfairly. Rank objections by how likely they are to trigger a reject.
```

**Citation audit** — cheap insurance before submission:

```
For each reference in this list, state whether you can verify it exists as
cited (authors, title, venue, year, DOI/arXiv id), and whether it is
peer-reviewed or a preprint. Mark each VERIFIED / MISMATCH (with the
correction) / CANNOT-VERIFY. Do not guess. CANNOT-VERIFY is an acceptable
answer; an invented correction is not.
```

**Boundary probe** — where your contribution actually begins:

```
Find the works that come CLOSEST to this claim without making it, searching
EACH of these fields separately in its own vocabulary: [list fields]. Claim:
[paste]. For each work, state what it does claim and exactly where it stops
short. If any work already makes the claim, say so plainly.
```

**Canon check** — guards against the classic interdisciplinary error of missing a field's foundational work:

```
For [field], list the works a well-read scholar would consider canonical for
[sub-topic] — the papers that named the problem, the recognised surveys, and
any test-of-time award winners. For each, one sentence on why it is canonical.
Mark anything you cannot verify.
```
