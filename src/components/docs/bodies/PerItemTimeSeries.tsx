// §6.3 section 11 — per-item time series. Deepened in WP 5.2j.
//
// ── WHAT THE PAGE OMITTED, AND WHAT IT GOT WRONG ──────────────────────────
//
// The explorer draws eight named measures and the page named none of them —
// `run_item_series` is deferred in the contract, so there was no generated fact
// to render, which is exactly the correlation WP 5.2i's gap check predicted.
// They are declared in two places and `deriveItemSeries` joins them: the engine
// says which item kind each belongs to, the explorer's legend says what the
// reader sees.
//
// It also said series are "kept per replication … so a week that looks
// catastrophic can be checked against the other seeds". That is not true and it
// is the kind of untrue that costs a reader an afternoon: the engine writes item
// series ONLY when the run has exactly one replication, so there are no other
// seeds to check against. Corrected here, and the correction is the reason the
// page now says where the toggle is — a claim about a feature nobody had opened.

import { PageTitle, Section, P, Key, Callout, Steps, Term, DocLink, AppLink, Provenance } from "@/components/docs/prose";
import { DocFigure } from "@/components/docs/DocFigure";
import { UNDESCRIBED } from "@/components/docs/generated/dataModel.generated";
import { ITEM_SERIES } from "@/components/docs/generated/policy.generated";

export default function PerItemTimeSeries() {
  const owing = UNDESCRIBED.find((g) => g.tables.some((t) => t.table === "run_item_series"));
  const materials = ITEM_SERIES.filter((s) => s.kind === "material");
  const products = ITEM_SERIES.filter((s) => s.kind === "product");

  return (
    <>
      <PageTitle lead="What happened to one material or one product, week by week — and the switch you have to throw before the run to get it.">
        Per-item time series
      </PageTitle>

      <Callout tone="limit" title="You have to ask for this before the run, and only a single-replication run can give it">
        <p>
          Per-item series are <strong>off by default</strong> and cannot be produced afterwards. A
          run that did not keep them has to be run again to get them — which costs time and nothing
          else, because the same seed reproduces the same world exactly.
        </p>
        <p>
          The switch is <strong>Inspection mode</strong>, on{" "}
          <AppLink to="/policies">Policies</AppLink> → Run &amp; validate → the{" "}
          <strong>Single</strong> tab. It is not in Simulation Lab, and it is not on the multi-run
          tab, because <strong>the engine only writes item series for a run with exactly one
          replication</strong>. Ask for it on a run with more and the request is dropped with a
          warning rather than honoured.
        </p>
      </Callout>

      <Section id="why" title="Why the weekly view is usually the finding">
        <Key>
          An average tells you the level. A series tells you the shape, and the shape is what a
          decision is made about.
        </Key>
        <P>
          A 94% fill rate can be 94% every week, or perfect for forty weeks and 40% for ten. The
          first is a chain running slightly short; the second is a chain that failed and recovered.
          They need different responses and the aggregate cannot distinguish them.
        </P>
        <DocFigure id="series-vs-mean" />
      </Section>

      <Section id="the-measures" title={`The ${ITEM_SERIES.length} measures, and what each one is a count of`}>
        <P>
          Every value is <strong>one week's worth</strong>, in the item's own units — pieces,
          kilograms, whatever the quantities in your files are in. Nothing here is a rate or a
          percentage, so a number is directly comparable with the volumes you uploaded.
        </P>
        <P>
          A material and a product carry different measures, because they are different halves of
          the chain: a material is something you hold and replenish, a product is something you
          promise and deliver.
        </P>

        <div className="space-y-4">
          <div>
            <h4 className="mb-2 text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">
              A material — {materials.length} lines
            </h4>
            <div className="divide-y divide-border rounded-sm border border-border bg-card shadow-xs">
              {materials.map((s) => (
                <div key={s.key} className="p-3">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="text-[13px] font-semibold text-foreground">{s.label}</span>
                    <span className="font-mono text-[11px] text-muted-foreground">{s.key}</span>
                  </div>
                  <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
                    {s.key === "on_hand" &&
                      "How much you were holding at the end of that week. The line that hits zero is the stockout, and it is the last event rather than the first."}
                    {s.key === "in_transit" &&
                      "How much was ordered and not yet arrived. Read beside on hand: inventory falling while this stays flat means replenishment stopped, and inventory falling while this rises means it did not stop, it is just too slow."}
                    {s.key === "orders" &&
                      "How much you ordered that week. This is the policy speaking — it is the only one of the three that is a decision rather than a consequence, so it is where a policy change shows up first."}
                  </p>
                </div>
              ))}
            </div>
          </div>

          <div>
            <h4 className="mb-2 text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">
              A product — {products.length} lines
            </h4>
            <div className="divide-y divide-border rounded-sm border border-border bg-card shadow-xs">
              {products.map((s) => (
                <div key={s.key} className="p-3">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="text-[13px] font-semibold text-foreground">{s.label}</span>
                    <span className="font-mono text-[11px] text-muted-foreground">{s.key}</span>
                  </div>
                  <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
                    {s.key === "demand" &&
                      "How much was asked for that week. This is the draw the rest of the chain is answering, and on a stochastic demand model it is different on every seed."}
                    {s.key === "production" &&
                      "How much you made. Below demand and flat is a capacity ceiling; below demand and ragged is a material you could not get."}
                    {s.key === "fulfillment" &&
                      "How much you actually delivered. The gap between this and demand is the whole of the service story, and every service KPI is a summary of it."}
                    {s.key === "backlog" &&
                      "What was owed and not yet delivered, carried forward. A backlog that grows week on week is a chain that is not catching up — the level matters less than whether the line is climbing."}
                    {s.key === "lost_units" && (
                      <>
                        Demand that went away rather than waiting. Read it first: a backlog is a
                        delay, this is a sale you did not make. <strong>Which of the two an unmet
                        order becomes is a policy, not a consequence</strong> — it is set by{" "}
                        <Term>unmet_demand_handling</Term>, whose default is lost sales, so a
                        project nobody has configured produces this line and an empty backlog.
                        Under a backorder rule the same shortfall appears in Backlog instead, and
                        moves here only once it has waited longer than the backorder horizon.
                      </>
                    )}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </Section>

      <Section id="the-explorer" title="Using the explorer">
        <Steps
          steps={[
            {
              title: "Run with Inspection mode on",
              where: "/policies → Run & validate → Single",
              body: (
                <>
                  Set the seed you want — the series you get are that seed's world, and writing the
                  number down is how you come back to the same one. The panel appears under the run
                  once it finishes.
                </>
              ),
            },
            {
              title: "Choose products or materials",
              body: (
                <>
                  Two buttons, and they are two different sets of lines. The header tells you how
                  many of each this run has.
                </>
              ),
            },
            {
              title: "Find your item",
              body: (
                <>
                  <strong>The list shows the first 30 only.</strong> Past that, type in the search
                  box — the count under the list says how many are hidden. An item you cannot see
                  is not an item without a series.
                </>
              ),
            },
            {
              title: "Read the chart against the warm-up line",
              body: (
                <>
                  The dashed vertical line is the end of warm-up. Everything left of it is the model
                  filling its pipes from an empty start and is <strong>not</strong> evidence about
                  your chain. A dramatic first ten weeks is almost always this.
                </>
              ),
            },
          ]}
        />
      </Section>

      <Section id="reading-one" title="Reading one">
        <P>
          Start at the week the aggregate went wrong and read backwards. A stockout is the last
          event in a sequence — on-hand falling, in-transit not arriving, demand unchanged — and the
          useful question is which of those moved first.
        </P>
        <P>
          The three material lines are drawn together on one axis on purpose. If on-hand is falling
          while orders placed are flat, the policy is not reacting; if orders are rising and
          in-transit is not, the supply is not answering. Those are different problems with
          different fixes, and the chart distinguishes them at a glance in a way the KPIs never can.
        </P>
      </Section>

      <Callout tone="limit" title="One seed, one world — there is nothing here to average">
        <p>
          An inspection run is <strong>one replication</strong>. The chart is one possible world,
          not the expected one, and a spike in it may be that seed rather than your chain. You
          cannot check it against the other seeds on this screen, because this run has none.
        </p>
        <p>
          The way to tell them apart is to change the seed and run inspection again. If the spike
          moves, it was the seed; if it stays in the same week, it is structural.{" "}
          <DocLink to="seeds-replications-confidence">Seeds, replications &amp; confidence</DocLink>{" "}
          is why one run is never the answer on its own.
        </p>
      </Callout>

      <Callout title="An inspection run that could not store its series fails rather than reporting green">
        <p>
          The series are the entire point of asking for one, so a run whose item rows fail to
          persist is marked <strong>failed</strong> — not completed with the panel quietly absent.
          If you asked for inspection and the run says done, the evidence is there.
        </p>
      </Callout>

      {owing && (
        <Callout tone="limit" title="This table is not yet described in the contract">
          <p>
            <Term>run_item_series</Term> has no per-column description and is deferred to WP{" "}
            {owing.wp}. The measures above are read from the engine that writes them and the legend
            that names them, joined — which is a weaker source than a sidecar, and it is what
            exists. There is no column reference to link you to, and this page will not write one by
            hand.
          </p>
        </Callout>
      )}

      <Section id="related" title="Related">
        <P>
          <DocLink to="reading-your-results">Reading your results</DocLink> is the layer above this
          one · <DocLink to="kpis-and-resilience-index">KPIs &amp; the Resilience Index</DocLink> is
          what these series are summarised into ·{" "}
          <DocLink to="seeds-replications-confidence">Seeds, replications &amp; confidence</DocLink>{" "}
          is why one seed is not an answer ·{" "}
          <DocLink to="verifiable-exports">Verifiable exports</DocLink> ships the series as a
          weeks-by-seeds sheet ·{" "}
          <DocLink to="model-validation">Model validation</DocLink> is how the warm-up line got
          where it is.
        </P>
      </Section>

      <Provenance from="scsim/scsim/core/engine.py's item_series dict for which measures each item kind carries, joined to ItemSeriesExplorer's own legend for the names — the contract describes this table nowhere" />
    </>
  );
}
