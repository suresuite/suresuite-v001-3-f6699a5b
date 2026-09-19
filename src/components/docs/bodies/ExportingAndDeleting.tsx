// §6.3 section 12 — getting everything out, and getting it removed.

import { PageTitle, Section, P, Key, Callout, Term, DocLink, AppLink, Provenance } from "@/components/docs/prose";
import { COUNTS } from "@/components/docs/generated/dataModel.generated";
import { PROJECT_DELETION } from "@/components/docs/generated/policy.generated";

export default function ExportingAndDeleting() {
  const d = PROJECT_DELETION;
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

      <Section id="deleting" title="Deleting a project">
        <Key>
          Two mechanisms do it, and knowing which is which tells you what is actually gone.
        </Key>
        <P>
          {d.projectScoped} tables hold rows belonging to a project. Deleting one removes them two
          ways: <strong>{d.cascade}</strong> tables are wired to the project in the database and go
          automatically, and a further <strong>{d.sweptOnly.length}</strong> are deleted by name by
          the deletion itself, because they were created without that wiring.
        </P>
        <P>
          <DocLink to="all-tables">All tables</DocLink> shows, for every described table, what it
          points at and what happens to it when the thing it points at goes.
        </P>
      </Section>

      {d.detached.length > 0 && (
        <Callout title={`${d.detached.length} things are detached rather than deleted, on purpose`}>
          <p>
            Your conversation threads and your rendered files are not removed with the project. They
            lose their link to it and remain yours — a report you rendered last month is still in
            your file list after the project it described is gone.
          </p>
          <p>
            That is the right behaviour for something you own personally, and it is worth knowing
            before you delete a project expecting everything about it to disappear. Deleting those
            is a separate act, on the file itself.
          </p>
        </Callout>
      )}

      {d.neither.length > 0 && (
        <Callout
          tone="note"
          title={`${d.neither.length} project-scoped tables are deliberately left behind`}
        >
          <p>
            They have no database wiring to the project and are not on the deletion's list, so{" "}
            <strong>their rows survive it</strong> — and for these three that is the intended
            answer, not an oversight:{" "}
            {d.neither.map((t, i) => (
              <span key={t}>
                {i > 0 ? ", " : ""}
                <Term>{t}</Term>
              </span>
            ))}
            . Usage, API traffic and assistant events are facts about the <em>account</em>, and
            deleting one project should not rewrite last quarter's usage.
          </p>
          <p>
            <strong>This used to be a list of ten, and seven of them were your data</strong> —{" "}
            <Term>policy_defaults</Term> and <Term>policy_overrides</Term> (the decisions you typed
            into the grid), <Term>customers</Term>, the tier-2 and tier-3 supplier uploads, the
            network summary and the job magnitudes. They now follow the project because the schema
            says so, on every path that deletes one. The rows that had already been orphaned were
            removed at the same time.
          </p>
          <p>
            If removal has to be provably complete — a contractual erasure rather than tidying a
            workspace — the three above are what remains, and they are the deliberate part. Name
            this page when you ask.
          </p>
        </Callout>
      )}

      {d.asynchronous && (
        <Callout tone="limit" title="Deletion is confirmed before it has happened">
          <p>
            The screen reports success as soon as the deletion <em>starts</em>. The work then runs in
            the background in batches, and if it fails part way through{" "}
            <strong>nothing tells you</strong> — the failure is recorded in the server's own logs
            and the message you already saw said it worked.
          </p>
          <p>
            In practice a partly deleted project shows up as a project that has disappeared from
            your list with rows left behind it. If you have reason to need a deletion verified
            rather than assumed, that is an administrator's check today, not something this screen
            can answer.
          </p>
        </Callout>
      )}

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

      <Provenance from="the data contract's table count, the project foreign keys the introspected schema records for every project-scoped table, and the delete-project function's own table list — the two joined, which is the only way the gap between them is visible" />
    </>
  );
}
