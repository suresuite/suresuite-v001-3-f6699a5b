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
    id: "tiers",
    page: "how-suresuite-is-designed",
    file: "tiers.svg",
    title: "The six tiers",
    alt:
      "Six stacked tiers read from the bottom up — the bytes you sent, staging, your canonical " +
      "data, computed data, your decisions, and results — with a single arrow running up the " +
      "side and one mark on the bottom tier labelled as the only way in.",
    caption:
      "Data only ever moves up. Nothing below a tier can be edited from above it, so a result " +
      "can never quietly rewrite the data it used.",
    shows:
      "Tiers 0–5 as a stack, each labelled with what a USER would call it, the upward-only " +
      "arrow, and the rule that makes the picture worth drawing — external data never enters " +
      "above tier 1, drawn as a single entry point rather than stated underneath. Supersedes " +
      "the `TierJourney` schematic, which stays as the fallback and must not be deleted.",
  },
  {
    id: "flow",
    page: "how-your-data-flows",
    file: "flow.svg",
    title: "One row's journey",
    alt:
      "A single spreadsheet row followed down the page: uploaded, parsed and checked, diffed " +
      "against your existing data, approved by a person, promoted, computed from, governed by " +
      "policies and finally used by a stamped run. The approval step is filled solid, and two " +
      "arrows come in from the right marking the only two places a number you did not supply " +
      "can enter.",
    caption:
      "Every uploaded value takes this path, and the approval step is a person every time. The " +
      "two inbound arrows are the only places a number you did not type can join it.",
    shows:
      "ONE row, not the whole system, with the tier each step lands in beside it. The approval " +
      "gate marked as HUMAN and visually unlike every other step. And the brief's third ask, " +
      "which the fallback never carried: where a substitution can enter — a derived fallback " +
      "and a policy default, both ABOVE your data and neither able to reach down into it. " +
      "Supersedes the `DataFlow` schematic, which stays as the fallback.",
  },
  {
    id: "boundary",
    page: "system-boundary",
    file: "boundary.svg",
    title: "What runs where",
    alt:
      "Four stacked layers — your browser, Supabase, the simulation worker and the engine — " +
      "with what crosses each line written between them. A filled mark on Supabase says your " +
      "data is at rest there and nowhere else; a dashed mark on the other three says it is " +
      "held only in memory, with the worker's ten-minute cache named.",
    caption:
      "Four processes, and only one of them your data rests in. The worker holds it in memory " +
      "after a run too, until an idle timer drops it — which is the part an approver is " +
      "entitled to and the page did not used to say.",
    shows:
      "Browser, Supabase, worker, engine; what crosses each boundary and in which direction; " +
      "and the brief's second ask, which needed CHECKING rather than inheriting (F3): where a " +
      "user's data is at rest and where it is only in flight. Reading `GraphCache` for that " +
      "found §4 D148 — the worker keeps the graph and the effective policies in memory for ten " +
      "minutes after a run, which neither the figure nor the page had said. Supersedes the " +
      "`SystemBoundaryFigure` schematic, which stays as the fallback.",
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
    id: "resolution-order",
    page: "how-policies-work",
    file: "resolution-order.svg",
    title: "What wins",
    alt:
      "The resolver's nine steps as a ladder, checked top to bottom, with the first match " +
      "winning and everything below it unconsulted.",
    caption: "The first rung with an answer decides. Nothing lower is consulted.",
    shows:
      "The nine steps in order, as a ladder rather than a list. The row-level value ABOVE the " +
      "policy bundle, because that is the one that surprises people and the one that makes a " +
      "re-upload behave the way it does.",
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
    id: "product-network",
    page: "product-level-network",
    file: "product-network.svg",
    title: "The product-level view",
    alt:
      "A DRAWN product-level network: supplier, material, product and customer nodes joined " +
      "left to right by flow arcs. Two nodes are outlined rather than joined — a material " +
      "with no supplier behind it, and a customer with nothing arriving — and each is called " +
      "out beneath.",
    caption:
      "A representation, not a screenshot. Every node and every arc in the real view is a row " +
      "you uploaded, and the two loose nodes are what a missing row looks like.",
    shows:
      "**A SCHEMATIC, declared as one (F5).** The brief asked for a capture of a real project " +
      "at readable label size and this package had no project to capture; a drawing presented " +
      "as a screenshot is a fabricated record, so the `alt` and the caption say it is drawn. " +
      "**Supersede it with a real capture rather than redrawing it.** What the drawing does " +
      "carry is the argument: the four groups left to right, and TWO faults visible at a " +
      "glance, because spotting those is what the page says this screen is for.",
  },
  {
    id: "process-network",
    page: "process-level-network",
    file: "process-network.svg",
    title: "The process-level view",
    alt:
      "A DRAWN process-level network: a product on level 0 with sub-assemblies stacked on " +
      "labelled levels beneath it, one sub-assembly feeding another, and raw materials at the " +
      "bottom of each branch. Beneath it, the two meanings of the word level set against each " +
      "other.",
    caption:
      "A representation, not a screenshot. Levels here are stages of manufacture and can all " +
      "sit in one factory; tiers in the firm graph are companies away from you. The two " +
      "numbers are unrelated.",
    shows:
      "**A SCHEMATIC, declared as one (F5)** — see `product-network` for why, and supersede it " +
      "the same way. The LEVELS must be labelled and the drawing must be visibly unlike the " +
      "firm-level picture, because confusing the two kinds of depth is the mistake this page " +
      "exists to prevent — which is why the distinction is spelled out in the figure rather " +
      "than left to the caption.",
  },
  {
    id: "firm-network",
    page: "firm-level-network",
    file: "firm-network.svg",
    title: "The deep-tier firm graph",
    alt:
      "A DRAWN firm-level network: companies arranged in tiers away from you, with node size " +
      "standing for a computed prominence. Two tier-1 suppliers, A and B, are joined by " +
      "separate paths that converge on one large tier-3 firm, which is ringed.",
    caption:
      "A representation, not a screenshot. Two suppliers you dual-sourced on purpose can meet " +
      "at a single firm three steps back — and nothing in your own purchasing data would show " +
      "it, because you have never bought from that firm.",
    shows:
      "**A SCHEMATIC, declared as one (F5)** — see `product-network` for why, and supersede it " +
      "the same way. The SHARED upstream firm is the whole point and must be unmissable: two " +
      "paths, one destination, drawn heavier than the rest. Node size carries a COMPUTED " +
      "measure, so the page can point at it and say which columns are not yours.",
  },
  {
    id: "interactive-space",
    page: "interactive-network-space",
    file: null,
    title: "The interactive space",
    alt:
      "The interactive network canvas with nodes pulled apart by hand into a layout the user " +
      "arranged.",
    caption: "No fixed layout. What you arrange is for looking at, not for quoting.",
    shows:
      "The canvas mid-exploration, ideally a cluster pulled apart, so it reads as something a " +
      "person is doing rather than a finished diagram. **DELIBERATELY STILL OPEN, and WP 5.2k " +
      "decided it rather than ran out of budget.** The other three capture slots were drawn as " +
      "declared schematics because each carries a STRUCTURAL argument a drawing makes as well " +
      "as a photograph — an orphaned node, a level, a shared firm. This one does not: its " +
      "brief asks for something that reads as a person part-way through a thought, and a " +
      "hand-authored SVG is the precise opposite of that. A tidy drawing here would illustrate " +
      "the fixed layout the page exists to contrast itself with, so it would be worse than the " +
      "placeholder, which at least says out loud what is missing (§5.3 T3). **This slot needs " +
      "a capture and nothing else.**",
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
      "the strategic engine consults, read from CHAINS, because `reorder_point` is overridden " +
      "and `order_up_to`/`review_period_days` reach the frozen engine only.",
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
      "run once acknowledged, and blocking findings do not run at all. A fourth state is " +
      "marked, in which the Run button is disabled while the gate still reads clear.",
    caption:
      "The gate is the only place the sequence can stop. Its reason is always on screen beside " +
      "the button — except in the fourth case, where the readout and the button disagree.",
    shows:
      "The five stages from buildStages, the gate between 2 and 3, and its three exits with " +
      "the literal button text each produces. STRUCTURE only — every sub-label on the real " +
      "screen is a live fact about the reader's own scenario, so no value is invented. The " +
      "fourth state is drawn because it is a disagreement the screen can actually show.",
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
    id: "kpi-vocabulary-gap",
    page: "reading-your-results",
    file: "kpi-vocabulary-gap.svg",
    title: "Measures and labels",
    alt:
      "Two columns. What the engine emits joins across to what the results table can label, " +
      "with a second block of labels on the right that nothing writes to, its incoming arrow " +
      "crossed out. Below, the five objectives the Setup form offers, of which only Fill rate " +
      "is a measure a run produces.",
    caption:
      "A row with no data is dropped rather than shown as zero, so this costs you measures " +
      "without ever showing a wrong number. Four of the five objectives you can optimise for " +
      "produce no chart at all.",
    shows:
      "The join between the engine's emitted keys and the results table's labels, as BLOCKS " +
      "rather than lists — and with NO totals lettered in, because the page renders the counts " +
      "from RUN_KPIS beside the figure and a number drawn here goes stale the first time the " +
      "engine gains a measure (F2). **This slot's original brief is superseded**: it asked for " +
      "'two lines' against §4 D113, which WP 6.3 CLOSED — the table is driven by the run now. " +
      "The live gap is the objective list, and that is what the lower half draws.",
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
    id: "capability-layers",
    page: "roles-and-capabilities",
    file: "capability-layers.svg",
    title: "Four layers, two answers",
    alt:
      "The four capability layers as a chain — you, your organization, your role, nobody — " +
      "each with two different exits: a solid arrow out to the side when a row exists, true " +
      "or false, and a dashed arrow down to the next layer when no row does.",
    caption:
      "A denial is not a missing grant. Removing a grant hands the decision back down the " +
      "chain; setting it to false takes it away outright.",
    shows:
      "The four layers narrowest first, and the two kinds of arrow drawn DIFFERENTLY — 'a row " +
      "exists, so stop' against 'no row, ask the next layer'. That difference is the whole " +
      "figure, and it is the thing administrators get wrong.",
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
];

/** Slots for one page, in manifest order. */
export const slotsFor = (page: string) => FIGURE_SLOTS.filter((s) => s.page === page);
