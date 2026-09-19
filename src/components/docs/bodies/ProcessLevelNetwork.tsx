// §6.3 section 8 — the process-level network.

import { PageTitle, Section, P, Key, Callout, DocLink, AppLink, Provenance } from "@/components/docs/prose";
import { ReadsFrom } from "@/components/docs/lineage";

export default function ProcessLevelNetwork() {
  return (
    <>
      <PageTitle lead="The shop-floor view: the bill of materials with its depth intact.">
        Process-Level Network
      </PageTitle>

      <Section id="what-it-shows" title="What it shows">
        <P>
          Where the product-level view collapses a product to the materials it consumes, this one
          keeps the stages between. A sub-assembly that feeds another sub-assembly is its own node
          here, at its own level.
        </P>
        <Key>
          It is drawn from your <DocLink to="bom-multi-level">multi-level BOM</DocLink>. A project
          with only a single-level BOM has nothing extra to show here, and that is not a failure —
          it is what a flat bill of materials looks like.
        </Key>
      </Section>

      <Section id="reads" title="What this screen reads">
        <ReadsFrom page="ProcessLevelNetwork.tsx" />
      </Section>

      <Callout title="Depth here is not depth in the deep-tier graph">
        <p>
          Two different things are called levels in this product. This page's levels are stages of{" "}
          <em>manufacture</em> inside your own operation — a casting becomes a housing becomes a
          pump. The <DocLink to="firm-level-network">Firm-Level Network</DocLink>'s tiers are
          distances between <em>companies</em> — your supplier's supplier's supplier.
        </p>
        <p>They do not correspond, and a node cannot be in both.</p>
      </Callout>

      <Section id="related" title="Related">
        <P>
          <DocLink to="bom-multi-level">BOM — multi level</DocLink> ·{" "}
          <DocLink to="multi-tier-data">Multi-Tier Data</DocLink> ·{" "}
          <DocLink to="product-level-network">Product-Level Network</DocLink>
        </P>
        <P>
          Open it at <AppLink to="/network/process-level">/network/process-level</AppLink>.
        </P>
      </Section>

      <Provenance from="WP 5.1's confirmed table-grain lineage for this page" />
    </>
  );
}
