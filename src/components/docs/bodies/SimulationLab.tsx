// §6.3 section 7 — running an experiment.

import { PageTitle, Section, P, Key, Callout, Steps, Term, DocLink, AppLink, Provenance } from "@/components/docs/prose";
import { ReadsFrom } from "@/components/docs/lineage";

export default function SimulationLab() {
  return (
    <>
      <PageTitle lead="Preview and experiment modes, and what each one produces.">
        Simulation Lab — running an experiment
      </PageTitle>

      <Section id="before-you-run" title="Before you run anything">
        <Key>
          Verify first. A run against an unverified model produces numbers with the same confidence
          as one against a verified model, and they are not the same numbers.
        </Key>
        <P>
          <DocLink to="verify-your-inputs">Verify your inputs</DocLink> tells you what would be
          filled in for you.{" "}
          <DocLink to="data-trust-report">Data Trust Report</DocLink> tells you how much of the
          model that is.
        </P>
      </Section>

      <Section id="how-a-run-goes" title="How a run goes">
        <Steps
          steps={[
            {
              title: "The model is assembled",
              body: (
                <>
                  Your tier-2 data plus your policy decisions, mapped into the engine's own entities.
                  Anything missing is substituted here, and the mapping report says what was.
                </>
              ),
            },
            {
              title: "It is handed to the engine",
              where: "worker",
              body: (
                <>
                  The simulation runs outside the browser. Closing the tab does not stop it, and it
                  does not need your machine to be fast.
                </>
              ),
            },
            {
              title: "Replications run",
              body: (
                <>
                  The same world, different random draws.{" "}
                  <DocLink to="seeds-replications-confidence">Seeds, replications &amp;
                  confidence</DocLink> is why one run is not an answer.
                </>
              ),
            },
            {
              title: "Results come back stamped",
              body: (
                <>
                  Aggregate measures with their spread, and per-replication detail underneath.{" "}
                  <DocLink to="reading-your-results">Reading your results</DocLink> covers what to
                  look at first.
                </>
              ),
            },
          ]}
        />
      </Section>

      <Callout title="Preview is for shape; an experiment is for an answer">
        <p>
          A preview runs few replications and comes back quickly — enough to see whether the model
          behaves at all, not enough to distinguish two strategies. An experiment runs the
          replications the statistics need.
        </p>
        <p>
          The trap is comparing two previews. Their difference is mostly the random seed, and it can
          easily be larger than the difference the change you are testing would make.
        </p>
      </Callout>

      <Section id="reads" title="What this screen reads">
        <ReadsFrom page="SimulationLab.tsx" />
      </Section>

      <Section id="related" title="Related">
        <P>
          <DocLink to="scenarios">Scenarios</DocLink> ·{" "}
          <DocLink to="disruptions">Disruptions</DocLink> ·{" "}
          <DocLink to="experiments-and-comparison">Experiments &amp; comparison</DocLink> ·{" "}
          <DocLink to="performance-and-caching">Performance &amp; caching</DocLink>
        </P>
        <P>
          Open it at <AppLink to="/simulation-lab">/simulation-lab</AppLink>.
        </P>
      </Section>

      <Provenance from="WP 5.1's confirmed table-grain lineage for this page" />
    </>
  );
}
