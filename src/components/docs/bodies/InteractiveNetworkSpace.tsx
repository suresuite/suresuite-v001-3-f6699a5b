// §6.3 section 8 — the interactive network space.

import { PageTitle, Section, P, Key, Callout, DocLink, AppLink, Provenance } from "@/components/docs/prose";
import { ReadsFrom } from "@/components/docs/lineage";

export default function InteractiveNetworkSpace() {
  return (
    <>
      <PageTitle lead="Exploring the chain without a fixed layout.">
        Interactive Network Space
      </PageTitle>

      <Section id="what-it-shows" title="What it is for">
        <P>
          The other three network views each answer a question by fixing a layout: materials flow
          left to right, manufacture stacks by level, firms arrange by tier. This one does not fix
          anything — you move nodes, pull a cluster apart, and look at the shape you get.
        </P>
        <Key>
          It is for the question you have not formed yet. If you know what you are looking for, one
          of the structured views will answer it faster.
        </Key>
      </Section>

      <Section id="reads" title="What this screen reads">
        <ReadsFrom page="InteractiveNetworkSpace.tsx" />
      </Section>

      <Callout title="A layout you arrange is not saved as a finding">
        <p>
          Moving nodes changes what you are looking at and nothing else. The arrangement is not
          stored, is not part of any run's provenance, and cannot be exported as a result — so a
          picture from this screen is an illustration rather than evidence. Anything you want to
          quote should come from a measure with a run behind it.
        </p>
      </Callout>

      <Section id="related" title="Related">
        <P>
          <DocLink to="product-level-network">Product-Level Network</DocLink> ·{" "}
          <DocLink to="firm-level-network">Firm-Level Network</DocLink> ·{" "}
          <DocLink to="network-science-metrics">Network science metrics</DocLink>
        </P>
        <P>
          Open it at{" "}
          <AppLink to="/network/interactive-space">/network/interactive-space</AppLink>.
        </P>
      </Section>

      <Provenance from="WP 5.1's confirmed table-grain lineage for this page" />
    </>
  );
}
