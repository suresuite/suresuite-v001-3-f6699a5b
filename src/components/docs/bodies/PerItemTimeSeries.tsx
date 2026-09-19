// §6.3 section 11 — per-item time series.

import { PageTitle, Section, P, Key, Callout, Term, DocLink, Provenance } from "@/components/docs/prose";
import { DocFigure } from "@/components/docs/DocFigure";
import { UNDESCRIBED } from "@/components/docs/generated/dataModel.generated";

export default function PerItemTimeSeries() {
  const owing = UNDESCRIBED.find((g) => g.tables.some((t) => t.table === "run_item_series"));

  return (
    <>
      <PageTitle lead="What happened to one material, week by week.">Per-item time series</PageTitle>

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

      <Section id="what-is-in-it" title="What is in a series">
        <P>
          Per item and per week: how much was on hand, how much was on order, how much demand
          arrived, how much was served, and what was left waiting. Enough to watch a shortage build
          before it becomes a service failure, which is several weeks earlier than the KPI moves.
        </P>
        <P>
          Series are kept per replication where the run was asked to keep them, so a week that looks
          catastrophic can be checked against the other seeds before it is believed.
        </P>
      </Section>

      <Callout tone="limit" title="Series are optional, and a run without them cannot be asked later">
        <p>
          Keeping weekly detail for every item of every replication is the most expensive thing a
          run stores, so it is a choice made <em>before</em> the run. A run that did not keep them
          cannot produce them afterwards without being run again — and rerunning at the same seed
          gives the same world, so nothing is lost except the time.
        </p>
      </Callout>

      <Section id="reading-one" title="Reading one">
        <P>
          Start at the week the aggregate went wrong and read backwards. A stockout is the last
          event in a sequence — on-hand falling, on-order not arriving, demand unchanged — and the
          useful question is which of those moved first.
        </P>
      </Section>

      {owing && (
        <Callout tone="limit" title="This table is not yet described in the contract">
          <p>
            <Term>run_item_series</Term> has no per-column description and is deferred to WP{" "}
            {owing.wp}, so this page has no column reference to link you to and will not write one
            by hand.
          </p>
        </Callout>
      )}

      <Section id="related" title="Related">
        <P>
          <DocLink to="reading-your-results">Reading your results</DocLink> ·{" "}
          <DocLink to="kpis-and-resilience-index">KPIs &amp; the Resilience Index</DocLink> ·{" "}
          <DocLink to="verifiable-exports">Verifiable exports</DocLink>, which ship the series as a
          weeks-by-seeds sheet
        </P>
      </Section>

      <Provenance from="the data contract's coverage register, for what it describes and what it does not" />
    </>
  );
}
