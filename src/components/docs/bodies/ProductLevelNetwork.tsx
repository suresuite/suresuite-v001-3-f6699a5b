// §6.3 section 8 — the product-level network.

import { PageTitle, Section, P, Key, Callout, DocLink, AppLink, Provenance } from "@/components/docs/prose";
import { ReadsFrom } from "@/components/docs/lineage";

export default function ProductLevelNetwork() {
  return (
    <>
      <PageTitle lead="Supplier to material to product to customer, drawn.">
        Product-Level Network
      </PageTitle>

      <Section id="what-it-shows" title="What it shows">
        <P>
          Your chain as a graph: the suppliers you buy from, the materials they deliver, the
          products those materials become, and the customers who take them. Four kinds of node, and
          the arcs are the rows of your uploads.
        </P>
        <Key>
          It is a picture of your data, not an analysis of it. Everything on the screen traces back
          to a row you uploaded, and a node you cannot find is a row you have not.
        </Key>
        <P>
          Which makes it the fastest way to check a new project. A material floating with no
          supplier, a customer connected to nothing, a product with no bill of materials — all of
          them are visible here in a second and invisible in a spreadsheet.
        </P>
      </Section>

      <Section id="reads" title="What this screen reads">
        <ReadsFrom page="ProductLevelNetwork.tsx" />
      </Section>

      <Callout title="If a node is missing, the upload is where to look">
        <p>
          The graph is built from the arcs. A supplier with no{" "}
          <DocLink to="inbound-logistics">inbound row</DocLink> has nothing to attach to, and a
          product with no <DocLink to="bom-single-level">BOM row</DocLink> is disconnected from the
          material side of the chain however complete its master record is.
        </p>
      </Callout>

      <Section id="related" title="Related">
        <P>
          <DocLink to="process-level-network">Process-Level Network</DocLink> ·{" "}
          <DocLink to="firm-level-network">Firm-Level Network</DocLink> ·{" "}
          <DocLink to="supply-chain-data">Supply Chain Data</DocLink> ·{" "}
          <DocLink to="network-science-metrics">Network science metrics</DocLink>
        </P>
        <P>
          Open it at <AppLink to="/network/product-level">/network/product-level</AppLink>.
        </P>
      </Section>

      <Provenance from="WP 5.1's confirmed table-grain lineage for this page" />
    </>
  );
}
