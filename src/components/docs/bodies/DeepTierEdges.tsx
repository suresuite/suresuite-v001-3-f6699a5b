// §6.3 section 3 — Deep-Tier Edges. Generated reference, authored narrative.

import { PageTitle, Section, P, Key, Callout, Term, DocLink, AppLink, Provenance } from "@/components/docs/prose";
import { HowItLoads, SuppliedAndComputed, DatabaseRules } from "@/components/docs/tableRef";
import { refTable, computedColumns } from "@/components/docs/tableFacts";

export default function DeepTierEdges() {
  const t = refTable("network_edges");
  const written = computedColumns(t).length;

  return (
    <>
      <PageTitle lead="Relationships between deep-tier firms, and their direction.">
        Deep-Tier Edges
      </PageTitle>

      <Section id="what-it-is" title="What this file is">
        <P>
          One row per relationship between two firms in the deep-tier graph: who supplies whom, how
          much of the upstream firm's revenue the relationship represents, and which way it points.
          <DocLink to="deep-tier-nodes"> Deep-Tier Nodes</DocLink> is the firms; this is the wiring
          between them.
        </P>
        <HowItLoads
          table={t}
          instead={
            <p>
              Uploaded from the same tab as the nodes file, and by the same route: a bulk call
              straight into the table. Nothing is staged, diffed or reviewed first.
            </p>
          }
        />
      </Section>

      <Section id="columns" title="Every column">
        <P>
          There is no CSV header mapping for this table, so each column's stored name is the name
          you see.
        </P>
        <SuppliedAndComputed table={t} />
      </Section>

      {written === 0 && (
        <Callout title="No provenance columns here, and that is on purpose">
          <p>
            <DocLink to="deep-tier-nodes">Deep-Tier Nodes</DocLink> and{" "}
            <DocLink to="node-list">Node List</DocLink> each carry a{" "}
            <Term>computed_from_hash</Term> saying which version of your data their computed columns
            came from. This table has none, because every column of it is uploaded — there is no
            computed value for a provenance column to describe.
          </p>
          <p>
            Adding one anyway would produce a column no writer could fill: a promise rather than a
            fact. That is the same rule the rest of this manual is held to.
          </p>
        </Callout>
      )}

      <DatabaseRules table={t} />

      <Section id="related" title="Related">
        <P>
          <DocLink to="deep-tier-nodes">Deep-Tier Nodes</DocLink> ·{" "}
          <DocLink to="multi-tier-suppliers">Multi-Tier Suppliers</DocLink> ·{" "}
          <DocLink to="firm-level-network">Firm-Level Network</DocLink>
        </P>
        <P>
          Drawn in <AppLink to="/network/firm-level">Firm-Level Network</AppLink>.
        </P>
      </Section>

      <Provenance from="supabase/contract/network_edges.contract.yaml, joined to the schema and the engine registry" />
    </>
  );
}
