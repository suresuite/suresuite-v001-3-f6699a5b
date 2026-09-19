// §6.3 section 12 — getting everything out, and getting it removed.

import { PageTitle, Section, P, Key, Callout, Term, DocLink, AppLink, Provenance } from "@/components/docs/prose";
import { COUNTS } from "@/components/docs/generated/dataModel.generated";

export default function ExportingAndDeleting() {
  return (
    <>
      <PageTitle lead="Taking your data out, and having it removed.">
        Exporting and deleting your data
      </PageTitle>

      <Section id="the-commitment" title="The commitment">
        <Key>
          Your data is yours. You can take it out in a format nothing here owns, and you can have it
          removed.
        </Key>
        <P>
          That is one of the five commitments this product is built on —{" "}
          <DocLink to="what-happens-to-your-data">What happens to your data</DocLink> states all
          five, and this page is the practical half of the last one.
        </P>
      </Section>

      <Section id="getting-it-out" title="Getting it out">
        <P>
          Everything you uploaded is a CSV you already have. What you may not have is everything the
          system computed from it, and the three{" "}
          <DocLink to="verifiable-exports">verifiable workbooks</DocLink> are the way to take that:
          the exact rows a version was computed over, the decisions you made, and what came out.
        </P>
        <P>
          They are ordinary spreadsheets. Nothing in them needs this software to be read, which is
          the point — an export you can only open here is not an export.
        </P>
      </Section>

      <Callout tone="limit" title="There is no one-click “export everything” yet">
        <p>
          The workbooks cover the data spine — inputs, decisions, results. The system holds{" "}
          {COUNTS.tablesInSchema} tables in all, and some of what surrounds the spine (conversation
          threads, request logs, admin records) has no export of its own.
        </p>
        <p>
          If you need a complete copy rather than the model and its results, that is a request to
          make of whoever administers your organization rather than a button on a screen. We would
          rather say that than let you assume the workbooks are exhaustive.
        </p>
      </Callout>

      <Section id="deleting" title="Deleting">
        <P>
          Deleting a project removes it and what hangs off it. The relationships between tables are
          declared in the database, so a deletion follows them rather than relying on anybody
          remembering which tables were involved — which is exactly why those relationships are
          documented per table rather than left implicit.
        </P>
        <P>
          <DocLink to="all-tables">All tables</DocLink> shows, for every described table, what it
          points at and what happens to it when the thing it points at goes.
        </P>
      </Section>

      <Callout tone="limit" title="What a deletion does not reach">
        <p>
          The audit record of a change is not the change. Removing a project removes its data;{" "}
          <DocLink to="audit-log">the audit log</DocLink> keeps the record that data existed and was
          modified, because a log that could be deleted by the person it describes would not be a
          log.
        </p>
        <p>
          Exports you have already downloaded are on your machine and outside this system entirely.
        </p>
      </Callout>

      <Section id="related" title="Related">
        <P>
          <DocLink to="verifiable-exports">Verifiable exports</DocLink> ·{" "}
          <DocLink to="what-happens-to-your-data">What happens to your data</DocLink> ·{" "}
          <DocLink to="who-can-see-your-data">Who can see your data</DocLink> ·{" "}
          <DocLink to="audit-log">Audit log</DocLink>
        </P>
        <P>
          Projects are managed at <AppLink to="/project-manager">Project Manager</AppLink>.
        </P>
      </Section>

      <Provenance from="the data contract's table count and the foreign keys it records for each table" />
    </>
  );
}
