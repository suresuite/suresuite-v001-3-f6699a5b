// §6.3 section 8 — the product-level network.

import { PageTitle, Section, P, Key, Callout, Defs, Term, DocLink, AppLink, Provenance } from "@/components/docs/prose";
import { DocFigure } from "@/components/docs/DocFigure";
import { ReadsFrom } from "@/components/docs/lineage";

export default function ProductLevelNetwork() {
  return (
    <>
      <PageTitle lead="Supplier to material to product to customer, drawn from the rows you uploaded.">
        Product-Level Network
      </PageTitle>

      <Section id="what-it-shows" title="What it shows">
        <P>
          Your chain as a graph. Four kinds of node, arranged left to right in the order material
          moves, and every arc is a row of one of your uploads.
        </P>
        <Key>
          It is a picture of your data, not an analysis of it. A node you cannot find is a row you
          have not uploaded, and that makes this the fastest way to check a new project.
        </Key>
        <DocFigure id="product-network" />
      </Section>

      <Section id="the-four-groups" title="The four groups, and where each comes from">
        <P>
          Nodes are coloured by group, and the group is not something you set — it is worked out
          from which file the arc came from. A location that appears as the upstream end of an
          inbound arc is a supplier; the downstream end of that same arc is a material, and so on
          across the chain.
        </P>
        <Defs
          items={[
            {
              term: "Supplier",
              def: (
                <>
                  The upstream end of an <DocLink to="inbound-logistics">inbound</DocLink> arc.
                </>
              ),
            },
            {
              term: "Material",
              def: (
                <>
                  The downstream end of an inbound arc, and the upstream end of a{" "}
                  <DocLink to="bom-single-level">BOM</DocLink> arc. Materials sit in the middle
                  because they are the only group that is both bought and consumed.
                </>
              ),
            },
            {
              term: "Product",
              def: (
                <>
                  The downstream end of a BOM arc, and the upstream end of an{" "}
                  <DocLink to="outbound-logistics">outbound</DocLink> arc.
                </>
              ),
            },
            { term: "Customer", def: <>The downstream end of an outbound arc.</> },
          ]}
        />
        <Callout tone="limit" title="A node's group is inferred, so a mis-typed id becomes a new node">
          <p>
            Because the classification comes from the arcs rather than from a declaration, a
            material spelled two ways in two files becomes two nodes in two different groups — and
            each one looks perfectly legitimate on its own. Seeing a material you do not recognise
            beside one you do is usually this, and it is the single most common data problem this
            screen exposes.
          </p>
        </Callout>
      </Section>

      <Section id="reading-a-node" title="Reading one node">
        <P>
          Clicking a node opens its details: how many arcs come in, how many go out, and the flow
          volume on each side. Those four numbers answer most of what you would want to know about
          a node's position.
        </P>
        <Defs
          items={[
            {
              term: "Incoming / outgoing count",
              def: (
                <>
                  How many arcs touch it. A material with <em>one</em> incoming arc is single
                  sourced, whatever its volume — the count is the risk, not the quantity.
                </>
              ),
            },
            {
              term: "Incoming / outgoing flow",
              def: (
                <>
                  The volumes on those arcs, normalised to weeks so two rows quoted over different
                  periods are comparable. <DocLink to="units-and-time-periods">Units and time
                  periods</DocLink> is why that normalisation exists.
                </>
              ),
            },
          ]}
        />
      </Section>

      <Section id="zero-flow" title="Nodes carrying no flow are hidden by default">
        <P>
          A node with nothing moving in or out is filtered out of the drawing, and{" "}
          <Term>Show All Nodes</Term> brings it back. That default is the right one for reading the
          chain and the wrong one for auditing it.
        </P>
        <Callout title="Turn the filter off once, on purpose, early">
          <p>
            A material that was uploaded but which nothing consumes, or a customer with no volume
            on any arc, is invisible until you do. Those are exactly the rows worth finding while
            you are still building the model — so look at the unfiltered graph once, then leave the
            filter on for everything else.
          </p>
          <p>
            The filtering is recorded per row rather than applied at draw time, so{" "}
            <DocLink to="supply-chain-data">Supply Chain Data</DocLink> says which edges were
            hidden and why.
          </p>
        </Callout>
      </Section>

      <Section id="analytics" title="The analytics panel">
        <P>
          Opening analytics computes network measures over this graph and shows them beside it,
          along with two summaries that are worth more than either measure alone:
        </P>
        <Defs
          items={[
            {
              term: "Supplier diversity · single-source risk",
              def: (
                <>
                  How many suppliers you have, and what share of materials depends on exactly one.
                  The second number is the one to act on.
                </>
              ),
            },
            {
              term: "Material diversity · concentration risk",
              def: <>The same question asked of materials rather than suppliers.</>,
            },
          ]}
        />
        <Callout tone="law" title="These numbers belong to a run, not to the moment">
          <p>
            The measures are computed from a specific state of your data and stored with the
            identity of that state. So a figure here is current only while your data has not moved,
            and when it has, the panel recomputes rather than showing you the old one.
          </p>
          <p>
            <DocLink to="network-science-metrics">Network science metrics</DocLink> explains each
            measure, and <DocLink to="data-trust-report">the Data Trust Report</DocLink> is where a
            project's computed rows are sorted into current, out of date, and{" "}
            <em>we cannot tell</em>.
          </p>
        </Callout>
      </Section>

      <Section id="map" title="The map view">
        <P>
          The same nodes placed geographically rather than by position in the chain. It answers a
          different question — how far apart things are, and how much of the chain sits in one
          place — and it needs coordinates, which come from{" "}
          <DocLink to="node-list">Node List</DocLink>.
        </P>
        <P>
          A node with no coordinates cannot be placed, so a sparse map usually means an incomplete
          node list rather than a sparse chain.
        </P>
      </Section>

      <Section id="reads" title="What this screen reads">
        <ReadsFrom page="ProductLevelNetwork.tsx" />
      </Section>

      <Section id="related" title="Related">
        <P>
          <DocLink to="process-level-network">Process-Level Network</DocLink> — the same chain with
          manufacturing depth kept ·{" "}
          <DocLink to="firm-level-network">Firm-Level Network</DocLink> — companies rather than
          materials ·{" "}
          <DocLink to="supply-chain-data">Supply Chain Data</DocLink> — the table this is drawn
          from ·{" "}
          <DocLink to="network-science-metrics">Network science metrics</DocLink>
        </P>
        <P>
          Open it at <AppLink to="/network/product-level">/network/product-level</AppLink>.
        </P>
      </Section>

      <Provenance from="the page's own node grouping and WP 5.1's confirmed table-grain lineage" />
    </>
  );
}
