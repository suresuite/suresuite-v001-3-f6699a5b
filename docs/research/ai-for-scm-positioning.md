# Proposer, Not Authority

**A separation-of-powers architecture for generative AI in supply chain decision-making**

*Research positioning — SureSuite / scsim. Companion to `docs/design/next-gen-platform-design.md` and `docs/design/ai-agents.md`.*

---

## Thesis

> Generative AI should be delegated the tasks where its errors are **detectable and cheap** — language, retrieval, extraction, explanation, specification — and structurally denied the tasks where its errors are **silent and expensive** — facts of record, quantities, consequences, rankings. **The denial must be enforced by architecture, not by prompting.**

## The problem

AI-for-SCM research divides into two camps. *AI-as-oracle* asks a language model for plans, risk scores, and impact estimates: fast and broad, but unverifiable, non-reproducible, and confidently wrong at unknown rates. *AI-as-extractor* mines text for network structure (AlMahri et al. 2026; Wichmann et al.): methodologically rigorous on precision/recall, but it yields a **static artifact with no consequence model** — a map whose decision-relevance is never tested. Neither confronts the asymmetry that defines supply chain decisions: an admitted gap costs a query; a confident wrong answer — an unseen single point of failure, an inverted make/buy comparison — costs a disruption.

## Contribution: three epistemic acts, three different authorities

Every supply chain decision performs three acts. Current practice lets one language model perform all three. This architecture assigns each a different authority, and the LLM is the authority for none.

| Epistemic act | Question | Authority (**never** the LLM) | The LLM's admitted role |
|---|---|---|---|
| **Fact** | What is true of this network? | multi-source corroboration + reference data + human review | proposes candidate entities/relations |
| **Consequence** | What follows if X fails? | the validated, versioned simulation model | specifies a typed, gated experiment |
| **Recommendation** | What should we do? | the human, with a full decision trace | explains, cites, surfaces options |

## Seven design principles (risk → mechanism → measurable indicator)

Each mechanism is implemented, not aspirational; the design references are load-bearing.

| # | AI failure mode | Architectural mechanism | Indicator |
|---|---|---|---|
| **DP1** | unsafe autonomy | **No mutation path exists.** Every AI output is a *proposal* passing the same gates as human input; approval is a human action; no auto-approve (`ai-agents.md` §4, §12.1) | unreviewed mutations = 0; proposal acceptance rate |
| **DP2** | fabricated numbers | **The LLM selects; code computes.** Values come from named, versioned deterministic functions (reducers, estimators), recomputed at draft *and* apply (tolerance 1e-9); a mismatch is rejected `not_grounded` (§5.1, §18.1) | recomputation-mismatch rate |
| **DP3** | hallucinated entities & relations | **Grounded-or-refuse, verified at runtime.** A refusal grammar ("a COUNT is not a LIST"; every id must appear in this turn's tool results) plus a *deterministic pre-send verifier* that blocks any reply containing an ungrounded entity or numeric claim — one corrective retry, then a deterministic honest fallback (§19.4, §22.3) | **entity-fabrication rate, target 0**; verifier-firing rate per model |
| **DP4** | plausible but false impact estimates | **Consequences come from execution, never from language.** Platform law: simulation results, KPIs, and rankings are never LLM-generated; a risk alert reads *"impact pending"* until a real run completes, then cites it (blueprint §12; `ai-agents.md` §18.3) | share of quantitative claims carrying run citations |
| **DP5** | prompt injection via external content | **Evidence is data, never instruction.** External text lands in an evidence store (source, content hash, confidence) behind a screening registry; injection fixtures ship in every CI suite (§8 T1–T2, §18.2, §18.5) | injection-fixture pass rate |
| **DP6** | false precision | **Uncertainty is first-class.** Estimators return `{value, low, high, basis}`; surrogates carry conformal intervals behind a dual reliability gate (interval width ≤ τ **and** novelty ≤ κ, else fall back to simulation); mapped facts are tiered *verified / corroborated / provisional* (blueprint §11.2; §18.1–18.2) | interval coverage in back-tests; gate fallback rate |
| **DP7** | unreproducible, undefendable decisions | **Provenance and credibility before use.** A three-hash triangle (policy / graph / engine) binds every run; a validated model card records V&V outcomes; a staleness law forbids inferring credibility across drift — *a KPI shown for decision-making is either produced under a validated card or visibly labeled unvalidated* (blueprint §8.4, §9.5) | decision reproducibility; share of decisions under validated cards |

Underneath sits a research-grade simulation core — common random numbers via a keyed seed tree, MSER-5/Conway warm-up detection, bootstrap confidence intervals, CRN-paired portfolio synergy decomposition, golden-trace regression tests (`scsim/`) — so "consequence" is a defensible statistical claim, not an output.

## Research agenda

- **RQ1 — Delegation taxonomy.** Which supply chain decision tasks can generative AI safely perform, and which must remain with deterministic computation? What property of a task predicts this?
- **RQ2 — Does separation work?** Does separating *proposal* from *authorization* measurably reduce error propagation while preserving AI's coverage and speed advantage?
- **RQ3 — What is the cost of safety?** Latency, human review burden, refusal rate, and task-completion loss under the guardrails. *Trustworthy-AI research systematically reports the benefits of its safeguards and never their price; measuring both is a contribution in itself.*

## Positioning against the literature

- **Extraction research** (AlMahri, Xu & Brintrup 2026; Wichmann et al.) validates *extraction* and stops there — the authors themselves note their graphs are static, quantity-free, and written directly to the store. This work adds temporal versioning (each refresh is a new dataset version in a hash lineage), the **product-level consumption-rate layer** (r_{p,m}) that makes a map executable, and gated proposals instead of direct writes.
- **Digital supply chain twin and ripple-effect research** (Ivanov & Dolgui) supplies the consequence model; the contribution here is an AI layer that *cannot corrupt the twin's credibility* — the twin remains the authority on consequence.
- **Simulation-plus-evaluation research** (Talluri et al. 2013, JBL) presupposes cost and structural data that is expensive to assemble; this architecture automates that foundation with declared methods, sources, vintages, and uncertainty ranges.
- **Commercial risk platforms** (Prewave, Everstream, Interos) return opaque severity scores; this returns a simulated impact range on the firm's own validated model, with provenance on every input.

Governance frames are treated as evidence structure rather than compliance decoration: NIST AI RMF / ISO-IEC 42001 / EU AI Act transparency map onto the as-built inventory and threat model (MAP), metrics and golden suites (MEASURE), flags and kill switches (MANAGE), and the platform law (GOVERN) — `ai-agents.md` §12.2.

## Method

**Design Science Research.** *Artifact*: the separation-of-powers architecture and its working implementation. *Evaluation*: the DP1–DP7 indicator set, measured on real projects and enforced by per-agent golden task suites in CI, including adversarial fixtures.

**Status, stated honestly.** The advisory layer and four artifact agents (data stewardship, policy configuration, V&V analysis, experiment design) are implemented; the network-mapping, cost-estimation, and risk-sensing agents are specified at implementation altitude (`ai-agents.md` §18) and not yet built. The claims above describe an architecture and its evidence contract — the empirical evaluation is the work the next paper reports.

---

*Context: this positioning underpins HWR Berlin's contribution to euroFMX (HORIZON-CL4-2025-03, GA 101299128) tasks T4.2 (graph-based GenAI tools and the Manufacturing Memory Fabric) and T4.4 (active inference for agentic AI decisions), where the same separation governs trustworthy, traceable industrial agentic AI.*
