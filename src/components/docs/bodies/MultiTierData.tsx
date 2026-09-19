// §6.3 section 4 — Multi-Tier Data.

import { PageTitle, Section, P, Key, Callout, Term, DocLink, Provenance } from "@/components/docs/prose";
import { refTable } from "@/components/docs/tableFacts";
import { SuppliedAndComputed, DatabaseRules, HowItLoads } from "@/components/docs/tableRef";

export default function MultiTierData() {
  const t = refTable("supply_chain_data_multi_tier");

  return (
    <>
      <PageTitle lead="The same computed graph, extended behind your direct suppliers.">
        Multi-Tier Data
      </PageTitle>

      <Section id="what-it-is" title="What this table is">
        <P>
          One row per edge of the <em>deep</em> supply graph — the tier-2 and tier-3 relationships
          behind the suppliers you buy from. Built by the same graph build as{" "}
          <DocLink to="supply-chain-data">Supply Chain Data</DocLink>, from the deep-tier uploads
          instead of the logistics ones.
        </P>
        <Key>
          <Term>level</Term> is how many tiers upstream the edge sits — 2 is a supplier's supplier.{" "}
          <Term>path_root</Term> is the direct supplier the whole chain hangs off, which is what
          lets a deep risk be attributed to a firm you actually have a contract with.
        </Key>
        <HowItLoads
          table={t}
          instead={
            <p>
              Computed from the deep-tier uploads rather than uploaded. Rebuilt with the rest of the
              graph.
            </p>
          }
        />
      </Section>

      <Callout tone="limit" title="The simulation does not read this table">
        <p>
          The strategic engine models a single focal plant with three echelons. Deep-tier structure
          is not propagated into it, so these rows feed the network views and the analyses and
          nothing that produces a fill rate or a cost.
        </p>
        <p>
          That is a modelling boundary rather than an omission, and it is on{" "}
          <DocLink to="known-limits">Known limits</DocLink> for the same reason it is here: a reader
          who assumes their tier-3 concentration is inside the simulation would be wrong about what
          their results mean.
        </p>
      </Callout>

      <Section id="columns" title="Every column">
        <SuppliedAndComputed table={t} />
      </Section>

      <DatabaseRules table={t} />

      <Section id="related" title="Related">
        <P>
          <DocLink to="supply-chain-data">Supply Chain Data</DocLink> ·{" "}
          <DocLink to="deep-tier-edges">Deep-Tier Edges</DocLink> ·{" "}
          <DocLink to="firm-level-network">Firm-Level Network</DocLink> ·{" "}
          <DocLink to="process-level-network">Process-Level Network</DocLink>
        </P>
      </Section>

      <Provenance from="supabase/contract/supply_chain_data_multi_tier.contract.yaml, joined to the schema" />
    </>
  );
}
