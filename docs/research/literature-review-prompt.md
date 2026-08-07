# Literature review prompt

**A reusable, systematic-review-grade prompt for the AI-in-supply-chain-management corpus**

*Companion to `ai-for-scm-positioning.md`. Designed for a capable LLM with web/database search. Use it in a fresh session; do not mix with drafting work.*

---

## How to use it

1. Paste the prompt below verbatim, replacing the bracketed fields in **SCOPE**.
2. Run it in **stages** — the prompt is staged deliberately (corpus → screening → extraction → synthesis → gap). Ask for one stage at a time and inspect the output before continuing; a review that hallucinates in stage 1 poisons every later stage.
3. **Verify every citation yourself** before it enters a manuscript. The prompt forbids unverifiable references, but verification is your job, not the model's — a reviewer will check, and a fabricated DOI ends the paper's credibility. *(This is the same epistemic discipline the paper itself argues for: the model proposes, the human authorizes.)*

---

## The prompt

```
You are assisting with a systematic literature review for a peer-reviewed
operations/supply-chain management journal (IJPR / JBL / IJPE class). Rigour
standards are those of Webster & Watson (concept-centric synthesis) and
PRISMA-style transparency of corpus construction.

SCOPE
- Topic: [e.g. the application of generative AI and LLM-based agents to supply
  chain management decision-making, with emphasis on trustworthiness,
  verification, and the division of labour between AI and deterministic
  computation]
- Research questions the review must serve:
  RQ1 [e.g. Which SCM tasks has generative AI been applied to, and with what
       evidence of validity?]
  RQ2 [e.g. How does the literature address hallucination, grounding, and
       accountability in SCM applications?]
  RQ3 [e.g. What is known about the cost of trustworthiness safeguards?]
- Time window: [e.g. 2019–2026, with seminal earlier work admitted by
  snowballing]
- Disciplinary boundary: SCM/OM primary; computer science admitted only where
  it is load-bearing for an SCM claim.

ABSOLUTE RULES ON SOURCES — these override helpfulness
1. Never invent a reference. Every work you cite must be one you have actually
   retrieved or that I supplied. If you are not certain a paper exists as
   described, say so explicitly and mark it UNVERIFIED.
2. Never invent a DOI, volume, issue, page range, or author list. If a field
   is unknown, write "unknown" — never a plausible guess.
3. Distinguish clearly, on every claim, between (a) what a paper demonstrably
   states, (b) your inference from it, and (c) your own judgement. Use the
   labels STATED / INFERRED / MY-ASSESSMENT.
4. Do not describe a paper's findings from its title and abstract alone
   without saying so. Mark depth as ABSTRACT-ONLY or FULL-TEXT.
5. If the evidence for a claim is thin or the literature is genuinely silent,
   say "the literature is silent on this" — a stated gap is more valuable to
   me than a manufactured citation. Silence is a finding.

STAGE 1 — CORPUS CONSTRUCTION (do only this stage now)
- Propose Boolean search strings for Scopus and Web of Science, plus adapted
  strings for Google Scholar, covering: generative AI / LLM / foundation model
  / agentic AI × supply chain / procurement / logistics / manufacturing
  network; and the adjacent clusters: supply chain visibility and mapping,
  multi-tier/deep-tier networks, digital supply chain twin, supply chain
  resilience and the ripple effect, knowledge graphs in SCM, simulation-based
  decision support, trustworthy/explainable AI in operations.
- State inclusion and exclusion criteria explicitly (peer-reviewed; empirical
  or design contribution; SCM application, not generic NLP benchmarking;
  language; venue quality threshold).
- Give the screening protocol: expected yield per string, de-duplication,
  title/abstract screening, full-text screening, and backward + forward
  snowballing from the seed set below.
- Seed set (verified, supplied by me — treat as anchors and snowball from
  them):
  * AlMahri, S., Xu, L. & Brintrup, A. (2026). Enhancing supply chain
    visibility with knowledge graphs and large language models. International
    Journal of Production Research, 64(6), 2178–2209.
    doi:10.1080/00207543.2025.2575841
  * Wichmann, P., Brintrup, A., Baker, S., Woodall, P. & McFarlane, D.
    Extracting supply chain maps from news articles using deep neural
    networks. International Journal of Production Research.
  * Talluri, S., Kull, T. J., Yildiz, H. & Yoon, J. (2013). Assessing the
    efficiency of risk mitigation strategies in supply chains. Journal of
    Business Logistics, 34(4), 253–269. doi:10.1111/jbl.12025
  * [add your own: Ivanov & Dolgui ripple-effect / digital-twin work; Choi et
    al. on nexus suppliers; Brintrup et al. on supply network science]
- Output: the search protocol as a table + a PRISMA-style flow sketch with
  expected counts. Do NOT yet list papers you have not retrieved.

STAGE 2 — SCREENING AND CORPUS TABLE (only after I approve Stage 1)
For each retrieved paper, one row: citation | venue + year | contribution type
(conceptual / empirical / design-science / review) | SCM task addressed | AI
technique | data source used | validation method | ground truth (if any) |
reported failure modes | depth (ABSTRACT-ONLY / FULL-TEXT).
Flag anything you could not retrieve rather than filling the row from memory.

STAGE 3 — CONCEPT MATRIX (concept-centric, not paper-by-paper)
Build a concepts × papers matrix. Concepts must be derived from the corpus,
not imposed, but expect dimensions such as: task delegated to AI; source of
ground truth; treatment of uncertainty; verification mechanism; human role;
reproducibility/provenance; accountability and regulatory framing; whether
consequences are computed or asserted.
Then write the synthesis BY CONCEPT — never a sequence of paper summaries.
Where papers disagree, say so and characterise the disagreement.

STAGE 4 — CRITICAL APPRAISAL
For each major cluster: what is methodologically strong, what is weak, what is
unreplicated, what is asserted without evidence. Pay specific attention to:
- Do studies validate the AI's OUTPUT (extraction accuracy) or its
  CONSEQUENCES (decision quality)? Distinguish these sharply.
- Is the reported performance measured against independent ground truth, or
  against the system's own artefacts?
- Are failure modes (hallucination, drift, injection, over-trust) measured or
  merely acknowledged in a limitations paragraph?
- Are the costs of safeguards ever reported?

STAGE 5 — GAP ANALYSIS AND POSITIONING
State the gaps as testable propositions, ranked by how strongly the corpus
supports their existence. For each gap: the evidence that it is a real gap
(which papers stop where), why it matters for SCM practice, and what kind of
study would close it. Then assess — honestly, as a sceptical reviewer would —
this positioning:
  "Generative AI should be delegated the tasks where its errors are detectable
   and cheap, and structurally denied the tasks where its errors are silent and
   expensive, with the denial enforced by architecture rather than prompting;
   supply chain decisions decompose into assertions of fact, of consequence,
   and of recommendation, and each requires a different authority, none of
   which is the language model."
Tell me: what is genuinely novel here, what is already claimed elsewhere (with
citations), what a reviewer would attack first, and what evidence would be
needed to defend it.

STYLE
Dense academic prose. No filler, no restating my question, no bullet-point
padding where a paragraph is the honest form. Where you are uncertain, be
uncertain in the text rather than hedging everything uniformly.
```

---

## Follow-up prompts worth keeping

**Adversarial review** — run after a draft exists, in a fresh session:

```
Act as a hostile but fair Reviewer 2 for [journal]. Here is my literature
review section: [paste]. Identify: claims without citation support; citations
that do not establish what they are cited for; missing literature a domain
expert would expect (name specific works, and mark UNVERIFIED if unsure);
concept-matrix dimensions that are unmotivated; and any place I have
characterised a prior work unfairly. Rank your objections by how likely they
are to trigger a reject.
```

**Citation audit** — cheap insurance before submission:

```
For each reference in this list, state whether you can verify it exists as
cited (authors, title, venue, year, DOI). Mark each VERIFIED / MISMATCH
(with the correction) / CANNOT-VERIFY. Do not guess. A CANNOT-VERIFY is an
acceptable answer; an invented correction is not.
```

**Boundary probe** — for finding where your contribution genuinely starts:

```
Find the papers that come CLOSEST to this claim without making it: [claim].
For each, state precisely what they do claim and where they stop short. If any
paper already makes the claim, say so plainly — I would rather learn it now
than at review.
```
