// §6.3 section 3 — Multi-Tier Suppliers.
//
// THE HONEST PAGE. This table has no upload, no reader and no writer (§4 D58),
// and the last measurement of production found zero rows across every project.
// A page that described it as a working feature would be the manual's own
// version of the defect this programme exists to end, so it describes what is
// actually there instead.

import { PageTitle, Section, P, Key, Callout, Term, DocLink, Provenance } from "@/components/docs/prose";
import { HowItLoads, SuppliedAndComputed, DatabaseRules } from "@/components/docs/tableRef";
import { refTable } from "@/components/docs/tableFacts";

export default function MultiTierSuppliers() {
  const t = refTable("multi_tier_supply_chain");

  return (
    <>
      <PageTitle lead="The firm-to-firm supply relationships that make up the deep chain.">
        Multi-Tier Suppliers
      </PageTitle>

      <Callout tone="limit" title="Read this first: nothing writes to this table">
        <p>
          <strong>There is no upload for it and no screen that fills it in.</strong> No part of the
          application writes a row here, and no part reads one. The last count taken against the
          production database found zero rows, across every project.
        </p>
        <p>
          The table exists, it has a shape, and it has been carried through every access-control
          rewrite since it was created — rules governing a table nobody can reach. We are telling
          you that rather than describing an upload path you would then go looking for.
        </p>
        <p>
          <strong>If you want a multi-tier supplier graph, the working one is{" "}
          <DocLink to="deep-tier-nodes">Deep-Tier Nodes</DocLink> and{" "}
          <DocLink to="deep-tier-edges">Deep-Tier Edges</DocLink>.</strong> They have uploads,
          screens and analyses behind them.
        </p>
      </Callout>

      <Section id="what-it-would-be" title="What it was meant to be">
        <P>
          One row per relationship between two firms: who supplies whom, at what tier, under what
          kind of relationship. The intent is the same as the deep-tier edges file, arrived at from
          a different direction — and the fact that two designs for one idea both reached the
          schema, with only one of them wired up, is the whole story of this table.
        </P>
        <HowItLoads
          table={t}
          instead={
            <p>
              Nothing writes it at all, so there is no route to describe. It is documented here
              because it exists in the database and you may meet it in an export or a schema
              listing.
            </p>
          }
        />
      </Section>

      <Section id="columns" title="Every column">
        <SuppliedAndComputed table={t} />
      </Section>

      <DatabaseRules table={t} />

      <Section id="related" title="Related">
        <P>
          <DocLink to="deep-tier-edges">Deep-Tier Edges</DocLink> ·{" "}
          <DocLink to="suppliers">Suppliers</DocLink> ·{" "}
          <DocLink to="known-limits">Known limits</DocLink>
        </P>
      </Section>

      <Provenance from="supabase/contract/multi_tier_supply_chain.contract.yaml, joined to the schema" />
    </>
  );
}
