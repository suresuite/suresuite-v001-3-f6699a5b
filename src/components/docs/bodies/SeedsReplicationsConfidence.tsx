// §6.3 section 7 — seeds, replications and confidence. Marked G*.

import { PageTitle, Section, P, Key, Callout, Term, DocLink, Provenance } from "@/components/docs/prose";

export default function SeedsReplicationsConfidence() {
  return (
    <>
      <PageTitle lead="Why the same model gives a range, and how wide that range has to be before you can ignore a difference.">
        Seeds, replications &amp; confidence
      </PageTitle>

      <Section id="why-a-range" title="Why one run is not an answer">
        <Key>
          The simulation is stochastic. Demand is drawn, lead times vary, and one run is one sample
          from a distribution of outcomes — not the outcome.
        </Key>
        <P>
          So the useful output is never a number, it is a number and a spread. A fill rate of 94%
          means something quite different if the runs ranged from 93 to 95 than if they ranged from
          78 to 99, and the mean alone cannot tell you which you have.
        </P>
      </Section>

      <Section id="seeds" title="Seeds">
        <P>
          A seed fixes the random draws, so the same model with the same seed gives the same
          result — every time, on any machine. That is what makes a result reproducible at all, and
          it is why a seed is part of what a run records rather than something the system picks and
          forgets.
        </P>
        <P>
          It also makes comparison honest. Two strategies run under the same seed see the same
          demand and the same delays, so their difference is the strategies rather than the luck.
        </P>
      </Section>

      <Section id="replications" title="Replications">
        <P>
          A replication is one run at one seed. Running several and aggregating is how the spread is
          measured — and the spread is what turns "A beat B" into "A beat B by more than the noise".
        </P>
        <P>
          More replications narrow the interval, at linear cost in time. Enough is when the interval
          is narrow relative to the difference you care about, which means the right number depends
          on the question rather than being a constant.
        </P>
      </Section>

      <Section id="warmup" title="Warm-up">
        <P>
          A simulation starts from an arbitrary state — inventories at their opening values, nothing
          in transit — and takes some weeks to settle into the behaviour you are trying to measure.
          Those early weeks are not representative and are excluded, so the measures describe the
          running chain rather than its startup.
        </P>
        <P>
          Warm-up is detected rather than assumed, and detected once on a reference run and reused
          across the variants being compared — because a warm-up detected separately per variant
          would itself become a difference between them.
        </P>
      </Section>

      <Callout tone="law" title="A confidence interval is about the simulation, not about your chain">
        <p>
          The interval says how much the <em>model's output</em> varies across random draws. It says
          nothing about whether the model is right. A tight interval around a wrong number is a
          precisely wrong number.
        </p>
        <p>
          The other half of that question is{" "}
          <DocLink to="data-trust-report">the Data Trust Report</DocLink> — what the model is
          standing on — and <DocLink to="model-validation">model validation</DocLink>, which asks
          whether it reproduces what actually happened.
        </p>
      </Callout>

      <Section id="related" title="Related">
        <P>
          <DocLink to="experiments-and-comparison">Experiments &amp; comparison</DocLink> ·{" "}
          <DocLink to="reading-your-results">Reading your results</DocLink> ·{" "}
          <DocLink to="simulation-lab">Simulation Lab</DocLink> ·{" "}
          <DocLink to="reproducibility-record">Reproducibility record</DocLink>
        </P>
      </Section>

      <Provenance from="the engine's statistics reference — seeded replication, warm-up detection and bootstrap aggregation" />
    </>
  );
}
