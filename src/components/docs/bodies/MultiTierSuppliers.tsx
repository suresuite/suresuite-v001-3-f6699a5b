// §6.3 section 3 — Multi-Tier Suppliers.
//
// THE HONEST PAGE, AND WP 6.2 HAD TO CORRECT ITS HONESTY (§4 D58).
//
// This table has no upload and no reader, and the last measurement of production
// found zero rows across every project. A page that described it as a working
// feature would be the manual's own version of the defect this programme exists to
// end, so it describes what is actually there instead.
//
// What the first version of this page ALSO said — "No part of the application
// writes a row here, and no part reads one" — was false in BOTH directions, and
// the sidecar it is generated from had recorded the truth twenty lines from the
// sentence that denied it (three confirmed `surfaces` entries). `contract:check`
// R15 refuses that disagreement now.
//
// Verified against a real database (`supabase/rehearsal/240` §6):
//   · `get_project_datasets` SELECTs this table and returns its rows, and
//     `projectLanes.ts` calls it from /policies and /simulation-lab — a live
//     READER feeding two pages;
//   · `delete_project_dataset` empties it in its `'all'` branch, which is the
//     "Delete ALL data" button on the project manager.
//
// No application code writes it; one RPC could and nothing calls it
// (`bulk_insert_multi_tier_supply_chain`, which §6c of the rehearsal exercises);
// two pages READ it; one button CLEARS it. The scan behind the original claim
// looked in the right places — `src/` and `supabase/functions/` do not name this
// table — and every reference is one call away, inside SQL.
//
// The page does not mention the uncalled RPC. A reader cannot invoke it from this
// product, so telling them about it would describe the grant surface rather than
// the feature, and that is §4 D28's subject, not this page's.

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
          <strong>There is no upload for it and no screen that fills it in.</strong> Nothing in the
          application puts a row here. The last count taken against the production database found
          zero rows, across every project.
        </p>
        <p>
          Two things do reach it, and neither can give it data. The project loader reads this table
          on <Term>/policies</Term> and <Term>/simulation-lab</Term> — it comes back empty, every
          time, because nothing fills it. And <Key>Delete all data</Key> on the project manager
          clears it along with the rest, so if rows ever did arrive here by hand, that button
          removes them.
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
              Nothing puts rows in it, so there is no loading route to describe. It is documented
              here because it exists in the database, because the project loader asks for it on two
              screens and is answered with nothing, and because <Key>Delete all data</Key> clears
              it — so you may meet its name in an export, a schema listing or a delete count.
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
