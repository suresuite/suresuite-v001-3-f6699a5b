// §6.3 section 3 — Deep-Tier Nodes. Generated reference, authored narrative.

import { PageTitle, Section, P, Key, Callout, Term, DocLink, AppLink, Provenance } from "@/components/docs/prose";
import { HowItLoads, SuppliedAndComputed, DatabaseRules, TemplateHeaders } from "@/components/docs/tableRef";
import { refTable, computedColumns, suppliedColumns } from "@/components/docs/tableFacts";

export default function DeepTierNodes() {
  const t = refTable("network_nodes");
  const written = computedColumns(t).length;
  const supplied = suppliedColumns(t).length;

  return (
    <>
      <PageTitle lead="Firms discovered beyond tier one, with the attributes known about each.">
        Deep-Tier Nodes
      </PageTitle>

      <Section id="what-it-is" title="What this file is">
        <P>
          One row per firm in the deep-tier graph — your suppliers' suppliers and outwards. Where{" "}
          <DocLink to="suppliers">Suppliers</DocLink> is about the firms you buy from directly, this
          is about the ones behind them, which is where most of the risk you cannot see lives.
        </P>
        <Key>
          It carries {supplied} columns describing a firm and {written} written by an analysis onto
          the same row. That is why this table appears both here, among the inputs, and in the
          network pages among the results.
        </Key>
        <HowItLoads
          table={t}
          instead={
            <p>
              It has an upload tab and a template, and the rows go straight into the table through a
              bulk call rather than through the contract's landing path. No file is kept, no staged
              copy is diffed, and nothing is reviewed before it lands.
            </p>
          }
        />
      </Section>

      <Section id="columns" title="Every column, and who wrote it">
        <P>
          There is no CSV header mapping for this table, so each column's stored name is the name
          you see everywhere.
        </P>
        <SuppliedAndComputed table={t} />
      </Section>

      <Callout title="The engine does not read this table">
        <p>
          The simulation runs on the tier-2 chain — arcs, BOM, item masters. The deep-tier graph
          feeds the network analyses and the firm-level map, not the simulation. So a change here
          changes centralities and prominence, and it does not change a fill rate.
        </p>
      </Callout>

      <Section id="template" title="The file you upload">
        <TemplateHeaders table={t} />
        <P>
          Upload it from <AppLink to="/project-manager">Project Manager</AppLink> under the Deep
          Tier Network tab, with the CSV format selected. The nodes file and the{" "}
          <DocLink to="deep-tier-edges">edges file</DocLink> are two halves of one graph — upload
          the nodes first, because an edge naming a firm that has no node has nothing to connect.
        </P>
      </Section>

      <DatabaseRules table={t} />

      <Section id="related" title="Related">
        <P>
          <DocLink to="deep-tier-edges">Deep-Tier Edges</DocLink> ·{" "}
          <DocLink to="firm-level-network">Firm-Level Network</DocLink> ·{" "}
          <DocLink to="network-science-metrics">Network science metrics</DocLink> ·{" "}
          <DocLink to="network-summary">Network Summary</DocLink>
        </P>
        <P>
          Uploaded from <AppLink to="/project-manager">Project Manager</AppLink>, drawn in{" "}
          <AppLink to="/network/firm-level">Firm-Level Network</AppLink>.
        </P>
      </Section>

      <Provenance from="supabase/contract/network_nodes.contract.yaml, joined to the schema and the engine registry" />
    </>
  );
}
