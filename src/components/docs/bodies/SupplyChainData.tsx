// §6.3 section 4 — Supply Chain Data. The first computed table, and the page
// that has to establish what "computed" means here: always rebuildable, never
// edited by hand, and carrying a stamp saying which version of your data it
// came from — or, more often today, carrying none.

import { PageTitle, Section, P, Key, Callout, Term, DocLink, Provenance } from "@/components/docs/prose";
import { refTable, computedColumns, suppliedColumns } from "@/components/docs/tableFacts";
import { SuppliedAndComputed, DatabaseRules, HowItLoads } from "@/components/docs/tableRef";

export default function SupplyChainData() {
  const t = refTable("supply_chain_data");
  const written = computedColumns(t);

  return (
    <>
      <PageTitle lead="The computed supply graph: who flows to whom, how much, and what share of it.">
        Supply Chain Data
      </PageTitle>

      <Section id="what-it-is" title="What this table is">
        <P>
          One row per edge of your chain, worked out from the four upload files rather than typed.
          Where <DocLink to="inbound-logistics">Inbound Logistics</DocLink> says <em>this supplier
          can deliver this material</em>, this says <em>and it is 40% of what that material's
          consumer takes</em>.
        </P>
        <Key>
          Nothing here is yours to edit. It is derived, it is always safe to drop and rebuild, and
          if a number looks wrong the fix is in the file it came from.
        </Key>
        <HowItLoads
          table={t}
          instead={
            <p>
              It is not uploaded at all. It is computed from your four logistics and BOM files by
              the graph build, and rebuilt whenever they change.
            </p>
          }
        />
      </Section>

      <Section id="the-three-numbers" title="The three numbers worth understanding">
        <P>
          <Term>weighted</Term> is the volume on this edge <em>after</em> unit normalisation —
          always per week, whatever period the uploaded row was quoted in. That is what makes two
          rows comparable, and it is why a monthly volume and a weekly one can sit in the same graph
          without either being rescaled by a reader.
        </P>
        <P>
          <Term>sourcing_ratio</Term> is this edge's share of everything flowing into its
          destination. A share, so it is dimensionless and adding two of them is meaningful.
        </P>
        <P>
          <Term>material_consumption_rate</Term> is carried through from your bill of materials
          rather than recomputed, so it means exactly what it means there.
        </P>
      </Section>

      <Section id="columns" title="Every column, and who wrote it">
        <SuppliedAndComputed table={t} />
      </Section>

      {written.length > 0 && (
        <Callout tone="limit" title="Some columns here are analysis results wearing a graph row">
          <p>
            {written.length} of this table's columns are not part of the graph at all — they are the
            output of the critical-node analysis, written onto the same rows. So a row of this table
            mixes something recomputed whenever your files change with something recomputed only
            when an analysis is run.
          </p>
          <p>
            <Term>computed_from_hash</Term> is what tells the two apart: it names the version of
            your data the analysis columns came from.{" "}
            <DocLink to="dataset-versions">Dataset Versions</DocLink> explains that anchor, and{" "}
            <DocLink to="reproducibility-record">Reproducibility record</DocLink> says plainly how
            many rows carry it today.
          </p>
        </Callout>
      )}

      <DatabaseRules table={t} />

      <Section id="related" title="Related">
        <P>
          <DocLink to="multi-tier-data">Multi-Tier Data</DocLink> ·{" "}
          <DocLink to="inbound-logistics">Inbound Logistics</DocLink> ·{" "}
          <DocLink to="product-level-network">Product-Level Network</DocLink>, which draws it ·{" "}
          <DocLink to="units-and-time-periods">Units and time periods</DocLink>
        </P>
        <P>
          {suppliedColumns(t).length} columns come from the graph build; {written.length} from an
          analysis.
        </P>
      </Section>

      <Provenance from="supabase/contract/supply_chain_data.contract.yaml, joined to the schema" />
    </>
  );
}
