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
    file: null,
    title: "The six tiers",
    alt:
      "Six stacked tiers, from raw uploaded files at the bottom through staging, your " +
      "canonical data, computed data, your policy decisions, and results at the top. " +
      "Arrows run upward only.",
    caption: "Data only ever moves up. Nothing below a tier can be edited from above it.",
    shows:
      "Tiers 0–5 as a stack, each labelled with what a user would call it; the upward-only " +
      "arrows; and the one rule that makes the picture worth drawing — external data never " +
      "enters above tier 1.",
  },
  {
    id: "flow",
    page: "how-your-data-flows",
    file: null,
    title: "One row's journey",
    alt:
      "A single spreadsheet row followed left to right: uploaded, checked, held in staging, " +
      "diffed against existing data, approved by a person, promoted, then read by the engine.",
    caption: "Every uploaded value takes this path. The approval step is a person, every time.",
    shows:
      "ONE row, not the whole system — upload, parse, validate, stage, diff, approve, promote, " +
      "compute, simulate. The approval gate marked as human. Where a substitution can enter.",
  },
  {
    id: "boundary",
    page: "system-boundary",
    file: null,
    title: "What runs where",
    alt:
      "Four boxes — the browser, the Supabase data and control plane, the simulation worker, " +
      "and the scsim engine — with labelled arrows for what crosses each boundary.",
    caption: "Four processes. What crosses each line is the part worth knowing.",
    shows:
      "Browser, Supabase, worker, engine. What crosses each boundary and in which direction. " +
      "Where a user's data is at rest, and where it is only in flight.",
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
    file: null,
    title: "The product-level view",
    alt:
      "The product-level network as the application draws it: supplier, material, product and " +
      "customer nodes joined by flow arcs.",
    caption: "Every node and every arc here is a row you uploaded.",
    shows:
      "A screenshot of a REAL project at a size where node labels are readable. Ideally one " +
      "with a visible defect — an orphaned material, a disconnected customer — since spotting " +
      "those is what the page says this screen is for.",
  },
  {
    id: "process-network",
    page: "process-level-network",
    file: null,
    title: "The process-level view",
    alt:
      "The process-level network: manufacturing stages stacked by depth, with sub-assemblies " +
      "feeding sub-assemblies.",
    caption: "Levels here are stages of manufacture, not distances between companies.",
    shows:
      "A multi-level BOM drawn as the app draws it, with the LEVELS labelled — and drawn so it " +
      "is visibly unlike the firm-level picture, because confusing the two kinds of depth is " +
      "the mistake this page exists to prevent.",
  },
  {
    id: "firm-network",
    page: "firm-level-network",
    file: null,
    title: "The deep-tier firm graph",
    alt:
      "The firm-level network: companies as nodes arranged by tier depth, with supply " +
      "relationships between them, node size carrying prominence.",
    caption:
      "Two suppliers you consider independent can meet at a single firm three tiers back.",
    shows:
      "A real deep-tier graph with a SHARED upstream firm visible — the concentration risk the " +
      "page claims this view reveals. Node size or colour should be one of the computed " +
      "measures, so the page can point at it and say which columns are not yours.",
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
      "person is doing rather than a finished diagram.",
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
];

/** Slots for one page, in manifest order. */
export const slotsFor = (page: string) => FIGURE_SLOTS.filter((s) => s.page === page);
