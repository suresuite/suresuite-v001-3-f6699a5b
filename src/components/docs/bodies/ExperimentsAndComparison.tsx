// §6.3 section 7 — experiments and comparison.

import { PageTitle, Section, P, Key, Callout, Term, DocLink, Provenance } from "@/components/docs/prose";

export default function ExperimentsAndComparison() {
  return (
    <>
      <PageTitle lead="Ranking strategies against each other, and knowing when the ranking is real.">
        Experiments &amp; comparison
      </PageTitle>

      <Section id="what-an-experiment-is" title="What an experiment is">
        <Key>
          A set of runs designed to be compared, rather than a set of runs that happen to exist.
        </Key>
        <P>
          The difference is control. An experiment holds everything fixed except the thing under
          test, runs each variant against the <em>same</em> random world, and pairs the results —
          so the difference you read is the difference the strategy made, not the difference the
          seeds made.
        </P>
      </Section>

      <Section id="pairing" title="Why the same world matters so much">
        <P>
          Two strategies run against two different random worlds differ for two reasons and you
          cannot separate them. Run against one shared world, the noise largely cancels, and a
          difference far smaller than either strategy's own variability becomes visible.
        </P>
        <P>
          This is why a comparison needs an experiment rather than two runs launched separately, and
          why comparing two <DocLink to="simulation-lab">previews</DocLink> is usually comparing
          seeds.
        </P>
      </Section>

      <Section id="synergy" title="Combinations, and what synergy means here">
        <P>
          Strategies interact. Two that each help on their own can help less together — because they
          are fixing the same bottleneck — or more, because one unlocks the other. The comparison
          reports that explicitly rather than leaving you to infer it from three numbers:
        </P>
        <div className="overflow-x-auto rounded-sm border border-border bg-card p-4 shadow-xs">
          <code className="whitespace-pre font-mono text-[12px] leading-relaxed text-foreground">
{`synergy(A + B) = effect(A and B together) − effect(A) − effect(B)

  positive  the combination does more than the parts — complementary
  negative  they overlap on the same constraint — submodular`}
          </code>
        </div>
        <P>
          A negative synergy is not a failure. It is usually the most useful thing an experiment
          tells you: you have bought the same protection twice.
        </P>
      </Section>

      <Callout tone="limit" title="More strategies is not monotonically better">
        <p>
          Adding strategies to a portfolio helps up to a point and then stops, because they start
          competing for the same constraint. The comparison reports the effect by portfolio breadth
          precisely so that the turning point is visible, and it warns on portfolios broad enough
          for the warning to be worth reading.
        </p>
      </Callout>

      <Callout tone="limit" title="A ranking is a ranking under the scenario you ran">
        <p>
          <Term>ST-1</Term> ranks suppliers under delay and <Term>ST-2</Term> ranks them under
          volume loss, and <strong>the same supplier can rank differently</strong> — which is the
          clearest evidence there is that "our most critical supplier" is not a property of the
          chain but of the question. Run more than one.
        </p>
      </Callout>

      <Section id="related" title="Related">
        <P>
          <DocLink to="seeds-replications-confidence">Seeds, replications &amp; confidence</DocLink> ·{" "}
          <DocLink to="stress-tests">Stress tests</DocLink> ·{" "}
          <DocLink to="kpis-and-resilience-index">KPIs &amp; the Resilience Index</DocLink> ·{" "}
          <DocLink to="reading-your-results">Reading your results</DocLink>
        </P>
      </Section>

      <Provenance from="the engine's portfolio-study and synergy decomposition" />
    </>
  );
}
