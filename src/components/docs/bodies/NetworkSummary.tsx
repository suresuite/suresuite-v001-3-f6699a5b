// §6.3 section 4 — Network Summary.
//
// §6.3 pairs this page with `external_evidence`, which the contract does not
// describe. The page says so rather than describing a table it cannot read.

import { PageTitle, Section, P, Key, Callout, Term, DocLink, Provenance } from "@/components/docs/prose";
import { refTable, computedColumns } from "@/components/docs/tableFacts";
import { SuppliedAndComputed, DatabaseRules, HowItLoads } from "@/components/docs/tableRef";
import { UNDESCRIBED } from "@/components/docs/generated/dataModel.generated";

export default function NetworkSummary() {
  const t = refTable("network_summary");
  const written = computedColumns(t);
  const evidence = UNDESCRIBED.find((g) => g.tables.some((x) => x.table === "external_evidence"));

  return (
    <>
      <PageTitle lead="One rolled-up description of a project's deep-tier graph.">
        Network Summary
      </PageTitle>

      <Section id="what-it-is" title="What this table is">
        <P>
          A single row per project: how many firms the deep-tier graph holds, how many relationships
          between them, and how those break down by depth. It is the headline you see before opening
          the <DocLink to="firm-level-network">Firm-Level Network</DocLink> itself.
        </P>
        <Key>
          Every value column of it is derived. There is nothing here you supplied — the whole row is
          a count over tables you did.
        </Key>
        <HowItLoads
          table={t}
          instead={
            <p>
              Nothing uploads it and nothing edits it. The contract names the ETL as what computes
              it — and see the box below, because that is not what happens today.
            </p>
          }
        />
      </Section>

      <Callout tone="limit" title="Nothing writes this table today">
        <p>
          The columns below are marked as computed by the ETL that rebuilds your chain. <strong>That
          ETL does not write this table.</strong> It writes the sourcing shares and it refreshes the
          node list, and it never touches the summary.
        </p>
        <p>
          The only thing that can write a row here is a bulk-insert function, and{" "}
          <strong>nothing calls it</strong> — no screen, no upload, no edge function, no job. So on
          a project created today this table is empty, and it stays empty.
        </p>
        <p>
          We are saying it because the reference below reads as a description of something that gets
          filled in. If you have rows here, they predate this and were written by something that no
          longer runs; read them as a historical artifact rather than as a current count.
        </p>
      </Callout>

      <Section id="columns" title="Every column, and who wrote it">
        <P>
          The “written by” marks below are the contract's declaration, not an observation. Read them
          as what each column is <em>for</em>, given the box above.
        </P>
        <SuppliedAndComputed table={t} />
      </Section>

      {written.length > 0 && (
        <Callout title="A count is only as current as the run that took it">
          <p>
            All {written.length} computed columns here carry{" "}
            <Term>computed_from_hash</Term> — the version of your data the count was taken over. If
            you have uploaded a new network since, the counts describe the old one until the graph
            is rebuilt, and the stamp is how you tell.
          </p>
          <p>
            <DocLink to="data-trust-report">Data Trust Report</DocLink> sorts a project's computed
            rows into current, out of date, and <em>we cannot tell</em> — and the third of those is
            not a euphemism for the second.
          </p>
        </Callout>
      )}

      <Callout tone="limit" title="The evidence behind a discovered firm is not described yet">
        <p>
          Deep-tier discovery records where it learned about a firm, in{" "}
          <Term>external_evidence</Term>. That table has no per-column description in the data
          contract
          {evidence ? `, and is deferred to WP ${evidence.wp}` : ""}, so this manual has no
          reference page for it and will not write one by hand.
        </p>
        <p>
          What that means practically: you can see a firm in the graph and the manual cannot yet
          tell you how to read the record of where it came from.
        </p>
      </Callout>

      <DatabaseRules table={t} />

      <Section id="related" title="Related">
        <P>
          <DocLink to="deep-tier-nodes">Deep-Tier Nodes</DocLink> ·{" "}
          <DocLink to="deep-tier-edges">Deep-Tier Edges</DocLink> ·{" "}
          <DocLink to="firm-level-network">Firm-Level Network</DocLink> ·{" "}
          <DocLink to="dataset-versions">Dataset Versions</DocLink>
        </P>
      </Section>

      <Provenance from="supabase/contract/network_summary.contract.yaml joined to the schema; the absence of a live writer is a call-site scan over src/ and supabase/functions/, where the table's only writing function has none" />
    </>
  );
}
