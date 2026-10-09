// The manual's figures — WP 5.2i.
//
// ── WHY THIS FILE EXISTS ──────────────────────────────────────────────────
//
// PLAN.md's own header says the architecture figures — eleven diagrams — live
// in an artifact this repository does not have, and §6.5 records WP 5.2a's
// decision not to link them: an external dependency the requirement forbids.
// What it drew instead was three inline SVGs, and WP 5.2b–g then shipped
// SIXTY-SIX pages carrying ZERO. So the manual had no door a diagram could come
// through, and a reader who has figures for their own application could not put
// one on a page.
//
// This is the door. A figure is ONE FILE in `src/assets/manual/` plus ONE LINE
// here. There is no import to write, no path to get right, and no build step to
// remember: Vite resolves the folder at build time, so dropping the file in and
// naming it here is the whole operation.
//
// ── A SLOT IS A PROMISE THE PAGE MAKES OUT LOUD ───────────────────────────
//
// Every entry below is a SLOT: a page, a place on it, and `shows` — what the
// diagram has to depict for the page to be doing its job. A slot whose file is
// not there yet renders a labelled placeholder naming the filename it wants,
// because §5.3 T3 says we publish our own blind spots and a figure that
// silently fails to appear is the one kind of broken a reader cannot report.
//
// So the fill rate is a number the manual knows about itself, `figures.test.ts`
// prints it, and the slots are the list of diagrams this manual is asking for.

export type FigureSlot = {
  /** Stable id — the anchor, and the key a page renders by. */
  id: string;
  /** The page this belongs on, by registry slug. */
  page: string;
  /** Filename inside `src/assets/manual/`. Set it once the file is there. */
  file: string | null;
  /** Shown above the figure. A title, not a sentence. */
  title: string;
  /**
   * What a screen reader says, and what shows when the image does not load.
   * NOT the caption — a diagram whose only explanation is the picture is a
   * diagram half the readers of this manual cannot use.
   */
  alt: string;
  /** The line under the figure. What the reader should take from it. */
  caption: string;
  /** For whoever draws it: what this diagram must contain to be right. */
  shows: string;
};

export const FIGURE_SLOTS: FigureSlot[] = [
  // ── 1 · Overview & architecture ─────────────────────────────────────────
  {
    id: "tiers", page: "how-suresuite-is-designed", file: "tiers.svg",
    title: "Six numbered data tiers",
    alt: "Tier 0 Landing keeps the file; tier 1 Staging checks rows; tier 2 Canonical holds accepted inputs; tier 3 Derived computes views; tier 4 Decisions saves policies and scenarios; tier 5 Results records outcomes and versions.",
    caption: "Six data responsibilities, numbered 0–5. Standard CSV uploads follow this path; node-list and deep-tier bulk uploads are exceptions. Historical records may lack source or version information.",
    shows: "Six separate numbered stages, 0 landing, 1 staging, 2 accepted canonical inputs, 3 derived views, 4 decisions, 5 results. Read top to bottom at phone width. These numbers are data tiers, not supplier tiers.",
  },
  {
    id: "flow", page: "how-your-data-flows", file: "flow.svg",
    title: "From upload to a stamped result",
    alt: "Seven steps for P-CONTROL to M-CASE: upload the file; check staged rows; accept reviewed rows; compute views and the housing requirement; decide policies and scenario; simulate frozen versions; stamp the result with its versions and settings.",
    caption: "The standard CSV journey, using two housings per control unit. Node-list and deep-tier bulk uploads follow separate paths.",
    shows: "Seven vertical steps matching the page headings: upload, check, accept, compute, decide, simulate, stamp. Keep P-CONTROL to M-CASE and the 100 products to 200 housings arithmetic visible.",
  },
  {
    id: "boundary",
    page: "system-boundary",
    file: "boundary.svg",
    title: "What runs where",
    alt: "Four stacked components: browser interface and optional browser execution; Supabase database and file storage; Fly.io simulation worker; Python engine. Requests carry uploads and edits, queued jobs name versions, and prepared inputs enter the engine. Some worker paths cache data in memory for ten idle minutes.",
    caption: "The server-run path. Browser execution is also available. Hosted storage includes database rows and files; some worker paths keep temporary copies in memory. Access checks and optional AI processing need separate review.",
    shows: "Browser, Supabase, worker and engine, with requests, queued version references and prepared inputs between them. Name browser execution and database plus file storage; do not imply that every request authenticates the caller or that the database is the only location for stored results.",
  },

  // ── 3 · Input tables ────────────────────────────────────────────────────
  {
    id: "chain-shape",
    page: "inbound-logistics",
    file: "chain-shape.svg",
    title: "Where an inbound row sits",
    alt:
      "A supply chain drawn left to right — suppliers, materials, the plant, products, " +
      "customers — with the inbound arcs between suppliers and materials highlighted.",
    caption: "One row of this file is one arrow on the left-hand side.",
    shows:
      "The whole chain once, with THIS file's arcs highlighted. The same base drawing should " +
      "serve the outbound and BOM pages with a different part lit, so a reader learns one " +
      "picture and reuses it.",
  },
  {
    id: "two-periods",
    page: "units-and-time-periods",
    file: "two-periods.svg",
    title: "time_unit governs volume; lead_time is weeks",
    alt:
      "One inbound row with two period-bearing columns picked out: time_unit pointing only at " +
      "volume, and lead_time standing apart with its own optional lead_time_unit.",
    caption: "The two columns are unrelated. This is the misreading that costs people a run.",
    shows:
      "A single row of inbound_logistics, with an arrow from time_unit to volume and NO arrow " +
      "from it to lead_time. The worked example: time_unit=month with lead_time=2 means 500 a " +
      "month delivered in two WEEKS.",
  },
  {
    id: "bom-depth",
    page: "bom-multi-level",
    file: "bom-depth.svg",
    title: "The same tree, two files",
    alt:
      "A bill of materials tree with three levels on the left, and the same tree collapsed to " +
      "direct product-to-material arcs on the right.",
    caption:
      "Multi-level keeps the middle stages; single-level states the result. The consumption " +
      "rate means a different thing on each side.",
    shows:
      "One tree drawn both ways, with the consumption rate labelled on both — relative to the " +
      "PARENT on the left, relative to the FINISHED PRODUCT on the right. That difference is " +
      "the one that silently changes numbers.",
  },

  // ── 5 · Policies ────────────────────────────────────────────────────────
  {
    id: "resolution-order", page: "how-policies-work", file: "resolution-order.svg",
    title: "Two fields, different resolution paths",
    alt: "Illustration: Material cost · M-BOARD: Saved override 25 replaces master 20 Removing it returns to the next source.. MTS finished-goods target: Explicit S is used as the target Missing S can trigger a derived target.. Check before running: A draft cell is not a saved run input Inspect the field chain and conversion notes.",
    caption: "Illustration. These examples are not a universal precedence ladder.",
    shows: "Illustration: Material cost · M-BOARD: Saved override 25 replaces master 20 Removing it returns to the next source.. MTS finished-goods target: Explicit S is used as the target Missing S can trigger a derived target.. Check before running: A draft cell is not a saved run input Inspect the field chain and conversion notes.",
  },
  {
    id: "provenance-dots",
    page: "where-a-number-came-from",
    file: "provenance-dots.svg",
    title: "The marks, on a real grid",
    alt:
      "A DRAWN close-up of six policy-grid cells, each carrying a different provenance mark, " +
      "with the meaning of each written beside it. Two dots stand for more than one state — " +
      "teal for both project data and item master, amber for all three of derived, suggested " +
      "and the declared meaning of empty — and the sixth cell, a bundle default, carries no " +
      "mark at all.",
    caption:
      "The dot colours are the grid's own. Five marks cover eight states, and the ninth — a " +
      "bundle default — has no mark and no legend entry, so it looks exactly like a plain cell.",
    shows:
      "A value from data, a derived fallback, a saved override, an imputed average, the " +
      "declared meaning of an empty cell, and an UNMARKED bundle default — the last is the gap " +
      "this page has to make visible. **It is a SCHEMATIC and says so (F5): this package could " +
      "not produce a capture of a real project, and a drawn grid presented as a screenshot is " +
      "a fabricated record.** Supersede it with a real capture when one exists. Take the dot " +
      "COLOURS from PROVENANCE in policyGridUi.tsx — they are fixed product hexes rather than " +
      "theme tokens, because there the colour IS the mark — and take the shares from the " +
      "grid's own ProvenanceLegend, which already declares them.",
  },

  // ── 7 · Experiments & scenarios ─────────────────────────────────────────
  {
    id: "disruption-models",
    page: "disruptions",
    file: "disruption-models.svg",
    title: "Two shapes for one idea",
    alt:
      "The two shapes one above the other at the same weight: first a single row holding a " +
      "whole disruption, then the same disruption split into a profile with targets, effects " +
      "and settings cascading from it. A crossed-out link at the foot says nothing migrated " +
      "between them.",
    caption: "Both are live. Neither reads the other.",
    shows:
      "The one-row shape and the four-table shape at the same scale and the same weight, with " +
      "NEITHER marked as preferred — the choice has not been made and the drawing must not " +
      "make it. The cascade from profile to its three children. Stacked rather than side by " +
      "side, because at 320 units two four-row columns cannot hold a table name at 12px, and " +
      "equal weight is the requirement here, not equal x-position.",
  },
  {
    id: "replications",
    page: "seeds-replications-confidence",
    file: "replications.svg",
    title: "Why one run is not an answer",
    alt:
      "Above: five runs of one model plotted together, spreading into a band, with the mean " +
      "over them and the warm-up weeks shaded and marked excluded. Below: two models as mean " +
      "and interval, where B's mean is higher than A's and the two intervals overlap.",
    caption:
      "The same model, different draws. The band is the answer; the line alone is not — and " +
      "where two bands overlap, the better-looking mean is not yet a better model.",
    shows:
      "The warm-up shaded and excluded, the spread of several replications, and the case that " +
      "matters: two models whose means differ and whose intervals overlap. **DRAWN, and the " +
      "figure says so (F5)** — real traces would be better and this package had no run to take " +
      "them from. Supersede it with real ones rather than redrawing it.",
  },

  // ── 8 · Networks ────────────────────────────────────────────────────────
  {
    id: "product-network", page: "product-level-network", file: "product-network.svg",
    title: "The control-unit chain",
    alt: "Illustration: Two materials feed one product: One board + two housings per control unit This example has no subassembly stage.",
    caption: "Illustration. Synthetic sample; links read top to bottom. Both BOM depth and units matter.",
    shows: "Illustration: Two materials feed one product: One board + two housings per control unit This example has no subassembly stage.",
  },
  {
    id: "process-network", page: "process-level-network", file: "process-network.svg",
    title: "The control-unit chain",
    alt: "Illustration: Two materials feed one product: One board + two housings per control unit This example has no subassembly stage.",
    caption: "Illustration. Synthetic sample; links read top to bottom. Both BOM depth and units matter.",
    shows: "Illustration: Two materials feed one product: One board + two housings per control unit This example has no subassembly stage.",
  },
  {
    id: "firm-network", page: "firm-level-network", file: "firm-network.svg",
    title: "Operational data is not a deep-tier graph",
    alt: "Illustration: Tutorial operational relationships: S-BOARD and S-CASE → Assembly Assembly → C-ASSEMBLY. Separate firm graph requires evidence: Company-node IDs and company edges The tutorial ships no deep-tier files.. Interpret coverage before concentration: Missing edges can mean missing evidence No automatic upstream simulation follows.",
    caption: "Illustration. The operational relationships here summarize the sample; they are not uploaded firm-graph edges.",
    shows: "Illustration: Tutorial operational relationships: S-BOARD and S-CASE → Assembly Assembly → C-ASSEMBLY. Separate firm graph requires evidence: Company-node IDs and company edges The tutorial ships no deep-tier files.. Interpret coverage before concentration: Missing edges can mean missing evidence No automatic upstream simulation follows.",
  },
  {
    id: "interactive-space", page: "interactive-network-space", file: "interactive-space.svg",
    title: "Explore without confusing views",
    alt: "Illustration: Select a project and network level: Product dependencies, BOM depth or firms Each level reads different relationships.. Focus a node: Inspect its connected path and details Filters can hide otherwise valid edges.. Restore the full view: Check inputs and coverage before conclusions Visual connectivity is not evidence quality.",
    caption: "Illustration. A workflow illustration, not an application screenshot.",
    shows: "Illustration: Select a project and network level: Product dependencies, BOM depth or firms Each level reads different relationships.. Focus a node: Inspect its connected path and details Filters can hide otherwise valid edges.. Restore the full view: Check inputs and coverage before conclusions Visual connectivity is not evidence quality.",
  },

  // ── 11 · Results & statistics ───────────────────────────────────────────
  {
    id: "series-vs-mean",
    page: "per-item-time-series",
    file: "series-vs-mean.svg",
    title: "The shape the average hides",
    alt:
      "Two weekly fill-rate series with the same mean: one flat and slightly short, one " +
      "perfect for most of the window and then collapsing.",
    caption: "Same average, different businesses. The mean cannot tell them apart.",
    shows:
      "Two series, identical means, wildly different shapes, with the mean drawn across both. " +
      "This is the page's whole argument in one picture.",
  },

  // ── 5 · Policies (WP 5.2k) ──────────────────────────────────────────────
  {
    id: "inventory-policies",
    page: "policy-types",
    file: "inventory-policies.svg",
    title: "Four rules, one demand",
    alt:
      "Four small inventory-over-time charts on the same demand and the same axis — min-max, " +
      "base stock, (R, Q) and periodic review — each labelled with the parameters that type " +
      "uses. Four of the six parameters are marked as stored but never read by the engine.",
    caption:
      "The shapes are what you are choosing between. The marks are which of the numbers you " +
      "type actually reach the simulation — and on three of the four types, none of the " +
      "sizing parameters do.",
    shows:
      "The four types side by side on ONE demand sequence so the shapes compare, each marked " +
      "with the parameters that type uses — read from INVENTORY_TYPES, which is the grid's " +
      "own library. And the half the page's prose already carries: which of those parameters " +
      "the strategic engine consults, read from CHAINS rather than restated here — s, S, Q, " +
      "κ and T all reach it per material from a Supplier-stage row.",
  },

  // ── 7 · Experiments & scenarios (WP 5.2k) ───────────────────────────────
  {
    id: "run-sequence",
    page: "simulation-lab",
    file: "run-sequence.svg",
    title: "Five stages, one gate",
    alt:
      "The five run stages in order — Setup, Recovery playbook, Run, Results, Compare — with " +
      "the gate drawn between stages 2 and 3. The gate has three exits: clear runs, warnings " +
      "run once acknowledged, and blocking findings do not run at all. A note marks the " +
      "account without run permission, which reads not permitted rather than clear.",
    caption:
      "The gate is the only place the sequence can stop. The readout, the stage label, the " +
      "button and its reason are one state, so they cannot disagree.",
    shows:
      "The five stages from buildStages, the gate between 2 and 3, and its three exits with " +
      "the literal button text each produces. STRUCTURE only — every sub-label on the real " +
      "screen is a live fact about the reader's own scenario, so no value is invented. The " +
      "permission note is drawn because it was once the state where the screen disagreed " +
      "with itself (§4 D147), closed by runGateState.",
  },
  {
    id: "lever-map",
    page: "recovery-playbooks",
    file: "lever-map.svg",
    title: "Which levers reach the engine",
    alt:
      "Six recovery levers on the left joined to engine plugins on the right. Four reach a " +
      "plugin, two of those reach the same one, and two — Safety stock and Material " +
      "reallocation — reach nothing at all. Two plugins on the right have no incoming arrow.",
    caption:
      "Two of the six change no number in the run, and two of the engine's plugins cannot be " +
      "reached from this screen at all. The lists disagree in both directions.",
    shows:
      "The join in RECOVERY_LEVERS, drawn: six levers, their plugins, the two nulls and the " +
      "two that share `expedited_shipments`. Draw the ABSENCES — a lever reaching nothing and " +
      "a plugin nothing reaches — because the absence is the finding (§4 D114). Use the pane's " +
      "own labels, not the enum keys, for the levers.",
  },

  // ── 8 · Networks (WP 5.2k) ──────────────────────────────────────────────
  {
    id: "centralities",
    page: "network-science-metrics",
    file: "centralities.svg",
    title: "Four answers, one graph",
    alt:
      "The same eleven-firm graph drawn four times. Degree picks firm C, betweenness picks B, " +
      "eigenvector picks G and closeness picks I — four different firms. In each copy the " +
      "second-placed firm is ringed, and C is second on two of the other three measures.",
    caption:
      "The most critical firm is a property of the question, not of the chain. Ask a different " +
      "measure and a different firm comes back.",
    shows:
      "ONE graph, four copies, identical layout, the top-scoring node filled in each. It must " +
      "be a graph where the four genuinely disagree — verify the values rather than assuming " +
      "a shape does it. Ring the runner-up too, so a near-tie reads as a near-tie instead of " +
      "as a verdict.",
  },

  // ── 11 · Results & statistics (WP 5.2k) ─────────────────────────────────
  {
    id: "resilience-curve",
    page: "kpis-and-resilience-index",
    file: "resilience-curve.svg",
    title: "Three measures as regions",
    alt:
      "One weekly fill-rate trace through a disruption. TTS is the span before service falls " +
      "out of the pre-disruption band; TTR is the span to the first week that then stays " +
      "inside it for three weeks; the service-loss area is the whole shaded region between " +
      "the undisrupted run and this one. Two weeks that look recovered are circled and do " +
      "not count, because service fell out of the band again afterwards.",
    caption:
      "Three of the engine's measures are regions on this picture rather than facts about a " +
      "single week. The three-week rule is why the first week that looks fine is usually not " +
      "the recovery.",
    shows:
      "The three geometric KPIs on one trace, with the band and the 3-week sustained-recovery " +
      "rule visible — read FR_BAND_PP and TTR_SUSTAIN_WEEKS from the engine rather than from " +
      "memory. Draw a FALSE recovery: without one, the 3-week rule looks like a formality " +
      "instead of the thing that decides the answer.",
  },

  // ── 13 · Access & administration ────────────────────────────────────────
  {
    id: "three-gates",
    page: "who-can-see-your-data",
    file: "three-gates.svg",
    title: "Three gates, two decisions",
    alt:
      "A write passing three checks — the database's row rules, the capability catalog, and " +
      "the minimum project role — with the row rules marked as the one that decides and the " +
      "role check marked as read by a single path.",
    caption:
      "They ask different questions, and they can disagree about the same action.",
    shows:
      "The three checks in the order a write meets them. The role gate visibly narrow — one " +
      "live reader — and the row rules visibly the one that refuses people. The disagreement " +
      "case drawn: an editor who is not the modeler passing one and failing the other.",
  },

  // ── WP 5.2k · B1–B7 — slots this package added ──────────────────────────
  {
    id: "scenario-window",
    page: "scenarios",
    file: "scenario-window.svg",
    title: "Days in, weeks out",
    alt:
      "A horizon bar with the warm-up shaded at its left and marked excluded, then a day " +
      "ruler below it on which two different disruption start days — day 28 and day 30 — both " +
      "round to week 4, with the week-3/week-4 boundary marked.",
    caption:
      "The form takes days; the chain's physics are weekly. Two start dates six days apart " +
      "can be the same run, and nothing on the form says so.",
    shows:
      "The horizon with the warm-up shaded and named as excluded, and — the part the prose " +
      "cannot carry — the rounding, drawn: a day ruler with two start days landing on one " +
      "week. Take the rule from project_map.py (`round(start_days / 7)`), not from the form. " +
      "Duration rounds the same way and is worth one line rather than a second ruler.",
  },
  {
    id: "kpi-vocabulary-gap", page: "reading-your-results", file: "kpi-vocabulary-gap.svg",
    title: "Read the evidence in this order",
    alt: "Illustration: 1 · Run status and identity: Done? Expected replications? Which versions and measurement window?. 2 · Conversion notes: Defaults, substitutions and clamping Do these alter the question?. 3 · KPIs and uncertainty: Engine-returned keys drive the table Unavailable is not zero.. 4 · Weekly traces and comparison: When did service fall and recover? What changed against the baseline?",
    caption: "Illustration. Ordinary application runs do not produce the library Resilience Index.",
    shows: "Illustration: 1 · Run status and identity: Done? Expected replications? Which versions and measurement window?. 2 · Conversion notes: Defaults, substitutions and clamping Do these alter the question?. 3 · KPIs and uncertainty: Engine-returned keys drive the table Unavailable is not zero.. 4 · Weekly traces and comparison: When did service fall and recover? What changed against the baseline?",
  },
  {
    id: "delete-reach",
    page: "exporting-and-deleting",
    file: "delete-reach.svg",
    title: "What a deletion reaches",
    alt:
      "Four groups a project-scoped table can fall into when a project is deleted: gone by " +
      "cascade, gone because a function deletes it by name, kept and detached, and kept on " +
      "purpose. The last group is named — the three log tables — and so is the third.",
    caption:
      "Three tables outlive a deleted project, and all three are facts about the account " +
      "rather than the project. That is a decision, and it is as hard to lose as the cascade.",
    shows:
      "The four groups, with the SMALL ones named rather than counted so the figure cannot " +
      "quietly disagree with the page's own rendered numbers. **The original brief is " +
      "superseded**: it asked for §4 D117's ten-tables-reached-by-neither, and WP 6.2 closed " +
      "that with a foreign key each — PROJECT_DELETION now reports three, and they are the " +
      "log tables, kept deliberately. Draw the decision, not the old defect (F7).",
  },
  {
    id: "two-ingest-paths",
    page: "csv-vs-connector",
    file: "two-ingest-paths.svg",
    title: "Where the routes diverge",
    alt:
      "The CSV route and the connector route side by side from source to your data. They " +
      "differ at every step: the file is kept and the sync has nothing to keep, the file is " +
      "diffed value by value and the sync only asks whether an id is already there, and the " +
      "connector's path forks — one branch to a person, one branch to nobody.",
    caption:
      "Both end in your data, and almost nothing between is shared. The branch with nobody on " +
      "it is the one to know about.",
    shows:
      "The two paths at the same scale, diverging step by step, with the auto-apply branch " +
      "drawn as a FORK rather than a footnote — a person on one side and nobody on the other. " +
      "§4 D116. Each fact belongs to the path it came from: the connector's diff is an " +
      "id-presence test, so `rows_unchanged` is always 0, and that is worth stating on the " +
      "drawing rather than in prose beside it.",
  },
  {
    id: "capability-layers", page: "roles-and-capabilities", file: "capability-layers.svg",
    title: "Different roles, different questions",
    alt: "Illustration: Account and organization: Application access and organization context These do not name one project role.. Project role: Viewer · analyst · editor · owner Check effective rights for this project.. Request authorization: Browser RPC or API gateway → server UI visibility alone is not enforcement.. Known boundary gap: Browser simulation dispatch needs review Do not infer complete server enforcement.",
    caption: "Illustration. The API key gateway and browser simulation path have different checks.",
    shows: "Illustration: Account and organization: Application access and organization context These do not name one project role.. Project role: Viewer · analyst · editor · owner Check effective rights for this project.. Request authorization: Browser RPC or API gateway → server UI visibility alone is not enforcement.. Known boundary gap: Browser simulation dispatch needs review Do not infer complete server enforcement.",
  },
  {
    id: "validation-binding",
    page: "model-validation",
    file: "validation-binding.svg",
    title: "What a verdict is tied to",
    alt:
      "The four components a validation card binds, each shown twice — by identity on the " +
      "left and by fingerprint on the right — with the engine's identity column drawn as " +
      "absent. Below, the three badge states that come of comparing them against the project " +
      "as it is now.",
    caption:
      "This is the one place in the product where a result already carries everything that " +
      "produced it. The badge is what that binding buys you.",
    shows:
      "The four components and their columns from VALIDATION_CARD.binding — by identity AND " +
      "by fingerprint, because the page's point is that the two answer different questions. " +
      "Draw the engine row's MISSING identity column rather than omitting the row (F6), and " +
      "keep the three badge states visually distinct by shape as well as by colour.",
  },
  {
    id: "proposal-lifecycle",
    page: "plans-and-proposals",
    file: "proposal-lifecycle.svg",
    title: "Six states, one clock",
    alt:
      "The six proposal states with an arrow per transition, each labelled with who causes " +
      "it: the agent files a draft, you approve, apply or reject, and a dashed path guarded " +
      "by a fourteen-day timer leads to expired from both proposed and approved.",
    caption:
      "Four of the six you choose and one the agent chooses. The sixth is what happens when " +
      "nothing is decided, and that is deliberate.",
    shows:
      "The six statuses from INTELLIGENCE.proposal, an arrow per transition LABELLED WITH WHO " +
      "causes it, and the expiry drawn as a TIMER on the edge rather than as another box you " +
      "could walk into — because the point is that nobody decides it. Rejected stays on the " +
      "diagram, faded, for the same reason it stays in the thread.",
  },
  {
    id: "first-comparison", page: "your-first-project", file: "first-comparison.svg",
    title: "One model, two controlled questions",
    alt: "Illustration: A · Baseline: No disruption; original stock policy Check normal service first.. B · Board disruption: Same inputs and policies; S-BOARD at 20% Compare B with A: event impact.. C · Same disruption + buffer: Change only material safety stock Compare C with B: policy effect.",
    caption: "Illustration. Compare adjacent variants. A versus C changes both event and policy.",
    shows: "Illustration: A · Baseline: No disruption; original stock policy Check normal service first.. B · Board disruption: Same inputs and policies; S-BOARD at 20% Compare B with A: event impact.. C · Same disruption + buffer: Change only material safety stock Compare C with B: policy effect.",
  },
  {
    id: "controlled-comparison", page: "experiments-and-comparison", file: "controlled-comparison.svg",
    title: "Keep the comparison attributable",
    alt: "Illustration: Hold fixed: Dataset · engine · seed · CRN Warm-up · measurement window. Choose one changed component: A to B: disruption schedule B to C: policy version. Pair completed replications: Read the difference and its interval Review service and cost together",
    caption: "Illustration. A passing comparison gate still requires a review of inputs and assumptions.",
    shows: "Illustration: Hold fixed: Dataset · engine · seed · CRN Warm-up · measurement window. Choose one changed component: A to B: disruption schedule B to C: policy version. Pair completed replications: Read the difference and its interval Review service and cost together",
  },
  {
    id: "upload-review", page: "uploading-data", file: "upload-review.svg",
    title: "Review a correction before accepting it",
    alt: "Illustration: CSV · P-CONTROL / M-CASE: Old consumption: 2 units/product Corrected file: 3 units/product. Staged review · changed row: Same product/material key Inspect parsed value and findings.. Promote eligible rows: One matching line updated to 3 Omitted rows are not deletions.",
    caption: "Illustration. This is an illustrative correction, not a change required by the tutorial.",
    shows: "Illustration: CSV · P-CONTROL / M-CASE: Old consumption: 2 units/product Corrected file: 3 units/product. Staged review · changed row: Same product/material key Inspect parsed value and findings.. Promote eligible rows: One matching line updated to 3 Omitted rows are not deletions.",
  },
  {
    id: "system-components", page: "how-suresuite-is-designed", file: "system-components.svg",
    title: "Execution and control boundaries",
    alt: "Illustration: React interface: Project Manager · Policies · Simulation Lab Browser controls guide the workflow.. Supabase control plane: Edge requests · RPCs · stored versions Authorization must hold at each boundary.. Worker or local execution: Frozen data + policies + scenario Shared mapping into scsim. scsim → result records: Weekly simulation and replication KPIs Version bindings and notes support review.",
    caption: "Illustration. The local verifier exercises the mapping and engine, not hosted authorization.",
    shows: "Illustration: React interface: Project Manager · Policies · Simulation Lab Browser controls guide the workflow.. Supabase control plane: Edge requests · RPCs · stored versions Authorization must hold at each boundary.. Worker or local execution: Frozen data + policies + scenario Shared mapping into scsim. scsim → result records: Weekly simulation and replication KPIs Version bindings and notes support review.",
  },
  {
    id: "api-request", page: "getting-an-api-key", file: "api-request.svg",
    title: "Start with a scoped read",
    alt: "Illustration: Client · Bearer API key: GET /projects with read:data Use the deployment gateway base URL.. Gateway: Key → scope → tenancy → limits An organization key may be project-limited.. Response: data array + next_cursor An empty page can be a valid result.. Then submit work: write:runs submits; read:runs retrieves 202 acceptance is not completion.",
    caption: "Illustration. Source-checked request flow; no live authenticated call was made.",
    shows: "Illustration: Client · Bearer API key: GET /projects with read:data Use the deployment gateway base URL.. Gateway: Key → scope → tenancy → limits An organization key may be project-limited.. Response: data array + next_cursor An empty page can be a valid result.. Then submit work: write:runs submits; read:runs retrieves 202 acceptance is not completion.",
  },
  {
    id: "project-access-review", page: "project-access", file: "project-access-review.svg",
    title: "Resolve access for a particular task",
    alt: "Illustration: Select the project: Check effective role on your profile Roles can differ across projects.. Name the task: Edit inputs, edit policies, run or export Project settings are a separate action.. Inspect the boundary: Unavailable control or backend denial? Record the exact error for the owner.",
    caption: "Illustration. The role display guides diagnosis; it does not prove server enforcement.",
    shows: "Illustration: Select the project: Check effective role on your profile Roles can differ across projects.. Name the task: Edit inputs, edit policies, run or export Project settings are a separate action.. Inspect the boundary: Unavailable control or backend denial? Record the exact error for the owner.",
  },
  {
    id: "trust-boundaries", page: "known-limits", file: "trust-boundaries.svg",
    title: "Three checks before a recommendation",
    alt: "Illustration: Coverage: Do the inputs represent the dependency? Missing edges are not proof of independence.. Mechanism: Does the engine simulate the response? A stored control can still be unsupported.. Evidence: Was the run completed and comparable? Precision does not establish validity.",
    caption: "Illustration. If a missing assumption can reverse the decision, test or investigate it.",
    shows: "Illustration: Coverage: Do the inputs represent the dependency? Missing edges are not proof of independence.. Mechanism: Does the engine simulate the response? A stored control can still be unsupported.. Evidence: Was the run completed and comparable? Precision does not establish validity.",
  }
];

/** Slots for one page, in manifest order. */
export const slotsFor = (page: string) => FIGURE_SLOTS.filter((s) => s.page === page);
