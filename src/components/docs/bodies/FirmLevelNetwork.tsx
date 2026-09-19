// §6.3 section 8 — the firm-level (deep tier) network.
//
// The page that has to say D56 out loud: these tables are described at tier 3
// and still reach their tables through bulk RPCs rather than the landing path.

import { PageTitle, Section, P, Key, Callout, Defs, Term, DocLink, AppLink, Provenance } from "@/components/docs/prose";
import { DocFigure } from "@/components/docs/DocFigure";
import { ReadsFrom } from "@/components/docs/lineage";
import { refTable, computedColumns } from "@/components/docs/tableFacts";

export default function FirmLevelNetwork() {
  const nodes = refTable("network_nodes");
  const edges = refTable("network_edges");
  const written = computedColumns(nodes).length;

  return (
    <>
      <PageTitle lead="Your suppliers' suppliers, and outwards — the graph you did not buy from directly.">
        Firm-Level Network
      </PageTitle>

      <Section id="what-it-shows" title="What it shows">
        <P>
          Firms rather than materials. Each node is a company somewhere behind your direct
          suppliers, each edge a supply relationship between two of them, and a node's depth is how
          many firms away from you it sits.
        </P>
        <Key>
          This is where concentration risk becomes visible. Two suppliers you consider independent
          can share a single firm three tiers back, and nothing in your own purchasing data would
          ever show it.
        </Key>
        <DocFigure id="firm-network" />
      </Section>

      <Section id="the-panels" title="What the panels tell you">
        <P>
          The analytics beside the graph answer four different questions, and they are worth
          reading in this order.
        </P>
        <Defs
          items={[
            {
              term: "Tier composition",
              def: (
                <>
                  How your firms are distributed by depth. A graph that is almost all tier one is a
                  graph that has not been explored yet — the risk this view exists to find lives
                  further out than most discovery reaches.
                </>
              ),
            },
            {
              term: "Single-source exposure",
              def: (
                <>
                  Firms that are the only route to something. This is the list to act on, and{" "}
                  <em>no single-source nodes detected</em> on a shallow graph means the graph is
                  shallow, not that the exposure is absent.
                </>
              ),
            },
            {
              term: "Most connected firms · prominence statistics",
              def: (
                <>
                  Who sits at the centre, by connection count and by the composite score.{" "}
                  <DocLink to="network-science-metrics">Network science metrics</DocLink> explains
                  what each measure means and why a high one is not automatically a problem.
                </>
              ),
            },
            {
              term: "Industry breakdown · geographic concentration",
              def: (
                <>
                  The two correlated exposures that a purely structural view misses. Twelve
                  independent suppliers in one country share a flood, a port and a border.
                </>
              ),
            },
          ]}
        />
        <Callout tone="limit" title="Revenue coverage is the number that qualifies the rest">
          <p>
            Several of these measures weight by revenue, and revenue is an attribute that is often
            simply unknown for a firm three tiers out. The panel reports the coverage — what share
            of firms have a known revenue — and a weighted measure computed over 30% coverage is a
            measure of the 30%.
          </p>
          <p>Read the coverage figure before you read anything that depends on it.</p>
        </Callout>
      </Section>

      <Callout tone="limit" title="This graph does not go through the upload checks">
        <p>
          <DocLink to="deep-tier-nodes">Deep-Tier Nodes</DocLink> and{" "}
          <DocLink to="deep-tier-edges">Deep-Tier Edges</DocLink> are described tables with an
          upload tab and a template — and their rows go straight into the table through a bulk call
          rather than through the path everything else takes. Nothing is kept as a file, nothing is
          diffed against what you already had, and nothing is reviewed before it lands.
        </p>
        <p>
          <strong>The practical consequence: an upload here replaces what is there without showing
          you what changed.</strong> Compare before you load, because afterwards there is no staged
          copy to compare against.{" "}
          <DocLink to="how-your-data-flows">How your data flows</DocLink> describes the four steps
          this skips.
        </p>
      </Callout>

      <Callout tone="limit" title="The simulation does not read this graph">
        <p>
          The engine runs on the tier-2 chain — arcs, bills of materials, item masters. The
          deep-tier graph feeds the network analyses and this map, and nothing else. So a change
          here moves a centrality and does not move a fill rate.
        </p>
        <p>
          That is a modelling boundary rather than an oversight, and it is the most common wrong
          assumption about this screen: a tier-3 concentration you can see here is not inside any
          result you run.
        </p>
      </Callout>

      <Section id="the-two-halves" title="What on this screen is yours, and what was computed">
        <P>
          <Term>{nodes.table}</Term> carries {written} columns an analysis wrote onto the same rows
          you uploaded — the centralities, the prominence score and their provenance stamps.{" "}
          <Term>{edges.table}</Term> carries none: every column of it is uploaded.
        </P>
        <P>
          So a node's size or colour may be a number from an analysis run rather than something in
          your file, and whether it is current depends on when that analysis last ran. Recomputing
          prominence is an action on this screen for that reason.
        </P>
      </Section>

      <Section id="reads" title="What this screen reads">
        <ReadsFrom page="FirmLevelNetwork.tsx" />
      </Section>

      <Section id="related" title="Related">
        <P>
          <DocLink to="deep-tier-nodes">Deep-Tier Nodes</DocLink> ·{" "}
          <DocLink to="deep-tier-edges">Deep-Tier Edges</DocLink> ·{" "}
          <DocLink to="network-science-metrics">Network science metrics</DocLink> ·{" "}
          <DocLink to="network-summary">Network Summary</DocLink> ·{" "}
          <DocLink to="disruptions">Disruptions</DocLink>
        </P>
        <P>
          Open it at <AppLink to="/network/firm-level">/network/firm-level</AppLink>.
        </P>
      </Section>

      <Provenance from="the two deep-tier sidecars, the page's own analytics panels, and WP 5.1's confirmed table-grain lineage" />
    </>
  );
}
