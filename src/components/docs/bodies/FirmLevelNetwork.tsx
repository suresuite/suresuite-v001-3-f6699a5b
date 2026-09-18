// §6.3 section 8 — the firm-level (deep tier) network.
//
// The page that has to say D56 out loud: these tables are described at tier 3
// and still reach their tables through bulk RPCs rather than through the
// ingestion contract's landing path.

import { PageTitle, Section, P, Key, Callout, Term, DocLink, AppLink, Provenance } from "@/components/docs/prose";
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
          suppliers, each edge a supply relationship between two of them, and the depth of a node is
          how many firms away from you it sits.
        </P>
        <Key>
          This is where concentration risk becomes visible. Two suppliers you consider independent
          can share a single firm three tiers back, and nothing in your own purchasing data would
          ever show it.
        </Key>
      </Section>

      <Section id="reads" title="What this screen reads">
        <ReadsFrom page="FirmLevelNetwork.tsx" />
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
          The practical consequence: an upload here replaces what is there without showing you what
          changed. Compare before you load, because afterwards there is no record to compare
          against. <DocLink to="how-your-data-flows">How your data flows</DocLink> describes the
          four steps this skips.
        </p>
      </Callout>

      <Callout tone="limit" title="The simulation does not read this graph">
        <p>
          The engine runs on the tier-2 chain — arcs, bills of materials, item masters. The
          deep-tier graph feeds the network analyses and this map, and nothing else. So a change
          here moves a centrality and does not move a fill rate.
        </p>
      </Callout>

      <Section id="the-two-halves" title="What on this screen is yours, and what was computed">
        <P>
          <Term>{nodes.table}</Term> carries {written} columns an analysis wrote onto the same rows
          you uploaded — the centralities, the prominence score and their provenance stamps.{" "}
          <Term>{edges.table}</Term> carries none: every column of it is uploaded.
        </P>
        <P>
          So a node's size or colour on this map may be a number from an analysis run rather than
          something in your file, and whether it is current depends on when that analysis last ran.{" "}
          <DocLink to="network-science-metrics">Network science metrics</DocLink> covers what each
          measure means and when it is recomputed.
        </P>
      </Section>

      <Section id="related" title="Related">
        <P>
          <DocLink to="deep-tier-nodes">Deep-Tier Nodes</DocLink> ·{" "}
          <DocLink to="deep-tier-edges">Deep-Tier Edges</DocLink> ·{" "}
          <DocLink to="network-science-metrics">Network science metrics</DocLink> ·{" "}
          <DocLink to="network-summary">Network Summary</DocLink>
        </P>
        <P>
          Open it at <AppLink to="/network/firm-level">/network/firm-level</AppLink>.
        </P>
      </Section>

      <Provenance from="WP 5.1's confirmed table-grain lineage and the two deep-tier sidecars" />
    </>
  );
}
