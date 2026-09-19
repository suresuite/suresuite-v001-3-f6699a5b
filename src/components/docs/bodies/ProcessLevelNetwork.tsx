// §6.3 section 8 — the process-level network.

import { PageTitle, Section, P, Key, Callout, Defs, Term, DocLink, AppLink, Provenance } from "@/components/docs/prose";
import { DocFigure } from "@/components/docs/DocFigure";
import { ReadsFrom } from "@/components/docs/lineage";

export default function ProcessLevelNetwork() {
  return (
    <>
      <PageTitle lead="The shop-floor view: your bill of materials with its depth intact.">
        Process-Level Network
      </PageTitle>

      <Section id="what-it-shows" title="What it shows">
        <P>
          Where the product-level view collapses a product straight to the materials it consumes,
          this one keeps the stages in between. A sub-assembly that feeds another sub-assembly is
          its own node here, at its own level.
        </P>
        <Key>
          It is drawn from your <DocLink to="bom-multi-level">multi-level BOM</DocLink>. A project
          with only a single-level BOM has nothing extra to show — that is not a failure, it is
          what a flat bill of materials looks like.
        </Key>
        <DocFigure id="process-network" />
      </Section>

      <Callout tone="law" title="Depth here is not depth in the firm graph">
        <p>
          Two different things in this product are called levels, and confusing them is the mistake
          this page exists to prevent.
        </p>
        <p>
          <strong>Here, a level is a stage of manufacture inside your own operation</strong> — a
          casting becomes a housing becomes a pump. The{" "}
          <DocLink to="firm-level-network">Firm-Level Network</DocLink>'s tiers are distances
          between <em>companies</em> — your supplier's supplier's supplier.
        </p>
        <p>They do not correspond, they are not comparable, and a node cannot be in both.</p>
      </Callout>

      <Section id="levels" title="Levels, and what the level summary tells you">
        <P>
          Nodes are grouped by level and you can show one level at a time. Beside the graph, a
          connectivity summary reports per level: how many nodes it holds, the average number of
          arcs in and out, and the average flow across them.
        </P>
        <Defs
          items={[
            {
              term: "A level with many nodes and low connectivity",
              def: (
                <>
                  A wide, shallow stage — many parts that do not feed each other. Usually raw
                  materials or bought-in components.
                </>
              ),
            },
            {
              term: "A level with few nodes and high connectivity",
              def: (
                <>
                  A choke point. Everything above it passes through a small number of stages, which
                  is exactly where a disruption propagates furthest.
                </>
              ),
            },
            {
              term: "A level with one node",
              def: (
                <>
                  Worth looking at directly. A single stage every product passes through is a
                  single point of failure that no supplier-level analysis would show you.
                </>
              ),
            },
          ]}
        />
      </Section>

      <Section id="top-flow" title="Filtering to the busiest nodes">
        <P>
          <Term>Top nodes by flow volume</Term> reduces the drawing to the components carrying the
          most material. On a deep BOM this is the difference between a readable picture and a
          hairball.
        </P>
        <P>
          Use it to find where volume concentrates, and turn it off before concluding anything
          about structure — a component can be structurally critical and carry very little volume,
          which is precisely the case the filter hides.
        </P>
      </Section>

      <Section id="focus" title="Following one component through the tree">
        <P>
          Selecting a node highlights what it can reach. That is the question a BOM view is
          actually for: <em>if this component is unavailable, what stops?</em> — and the answer is
          everything downstream of it, which is visible at a glance and very hard to work out from
          a spreadsheet.
        </P>
        <P>
          Search finds a component by name when the tree is too large to scan, and labels can be
          turned off when you want the shape rather than the detail.
        </P>
      </Section>

      <Section id="disruption" title="Aiming a disruption at a stage">
        <P>
          A node here can be turned into a disruption directly. That is the payoff of keeping the
          depth: in the collapsed view there is no sub-assembly to disrupt, because the modelling
          has already folded it away.
        </P>
        <P>
          <DocLink to="disruptions">Disruptions</DocLink> covers what a disruption records — and
          the fact that this product currently holds them in two unrelated shapes.
        </P>
      </Section>

      <Section id="reads" title="What this screen reads">
        <ReadsFrom page="ProcessLevelNetwork.tsx" />
      </Section>

      <Section id="related" title="Related">
        <P>
          <DocLink to="bom-multi-level">BOM — multi level</DocLink> — the file this is drawn from ·{" "}
          <DocLink to="multi-tier-data">Multi-Tier Data</DocLink> ·{" "}
          <DocLink to="product-level-network">Product-Level Network</DocLink> ·{" "}
          <DocLink to="disruptions">Disruptions</DocLink>
        </P>
        <P>
          Open it at <AppLink to="/network/process-level">/network/process-level</AppLink>.
        </P>
      </Section>

      <Provenance from="the page's own level grouping and WP 5.1's confirmed table-grain lineage" />
    </>
  );
}
