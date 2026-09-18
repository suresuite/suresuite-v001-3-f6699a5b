// §6.3 section 11 — reading your results. Marked G*.

import { PageTitle, Section, P, Key, Callout, Term, DocLink, Provenance } from "@/components/docs/prose";
import { engineVersion } from "@/lib/policies/registryAccess";

export default function ReadingYourResults() {
  return (
    <>
      <PageTitle lead="What a run produces, and the order to look at it in.">
        Reading your results
      </PageTitle>

      <Section id="the-order" title="The order that saves time">
        <Key>
          Read the spread before the mean, and read what the model assumed before either.
        </Key>
        <P>
          A mean with a wide interval around it is a weaker claim than a slightly worse mean with a
          narrow one. And both are claims about a model that may have filled in half your
          economics —{" "}
          <DocLink to="data-trust-report">the Data Trust Report</DocLink> is how much.
        </P>
      </Section>

      <Section id="what-comes-back" title="What comes back">
        <P>
          Three layers, and each answers a different question.
        </P>
        <div className="space-y-3">
          {[
            {
              t: "Aggregate measures",
              d: "One value per measure, across all replications, with its confidence interval. This is the headline and it is the layer most likely to be quoted out of context.",
            },
            {
              t: "Per-replication rows",
              d: "The same measures, one row per seed. This is what the interval was computed from, and it is what lets somebody else check it rather than trust it.",
            },
            {
              t: "Weekly series",
              d: "What happened week by week, per item, for the series the run was asked to keep. Where a mean says the fill rate was 94%, this says whether it was 94% every week or 100% for forty weeks and 40% for ten.",
            },
          ].map((x) => (
            <div key={x.t} className="rounded-sm border border-border bg-card p-4 shadow-xs">
              <div className="text-sm font-semibold text-foreground">{x.t}</div>
              <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{x.d}</p>
            </div>
          ))}
        </div>
      </Section>

      <Callout tone="law" title="The mean hides the shape, and the shape is usually the finding">
        <p>
          Two chains with the same average service level can be completely different businesses: one
          consistently adequate, one excellent until a shortage and then catastrophic. The aggregate
          cannot tell them apart and{" "}
          <DocLink to="per-item-time-series">the weekly series</DocLink> can.
        </p>
      </Callout>

      <Section id="what-a-result-carries" title="What a result carries with it">
        <P>
          Each run records what it ran on: the data, the decisions, the scenario, the seeds and the
          engine version — <Term>{engineVersion()}</Term> today. That is what makes a figure
          defensible six months later rather than merely recorded.
        </P>
        <P>
          It is also not yet one artifact.{" "}
          <DocLink to="reproducibility-record">Reproducibility record</DocLink> says exactly what is
          in place and what is not, including the part that is honestly missing.
        </P>
      </Section>

      <Section id="related" title="Related">
        <P>
          <DocLink to="kpis-and-resilience-index">KPIs &amp; the Resilience Index</DocLink> ·{" "}
          <DocLink to="per-item-time-series">Per-item time series</DocLink> ·{" "}
          <DocLink to="seeds-replications-confidence">Seeds, replications &amp; confidence</DocLink> ·{" "}
          <DocLink to="verifiable-exports">Verifiable exports</DocLink>
        </P>
      </Section>

      <Provenance from="the engine registry's version and the run record's own layers" />
    </>
  );
}
