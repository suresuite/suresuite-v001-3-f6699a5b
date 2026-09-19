// §6.3 section 11 — reports and files.

import { PageTitle, Section, P, Key, Callout, Term, DocLink, Provenance } from "@/components/docs/prose";
import { UNDESCRIBED } from "@/components/docs/generated/dataModel.generated";

export default function ReportsAndFiles() {
  const owing = UNDESCRIBED.find((g) => g.tables.some((t) => t.table === "user_files"));

  return (
    <>
      <PageTitle lead="Rendered reports, where they are kept, and what they are worth later.">
        Reports &amp; files
      </PageTitle>

      <Section id="what-a-report-is" title="What a rendered report is">
        <Key>
          A snapshot of what you were looking at, at the moment you rendered it.
        </Key>
        <P>
          Useful for circulating and for keeping a record of what was presented. It is a document,
          not a live view: the project can move afterwards and the report will not.
        </P>
      </Section>

      <Callout tone="limit" title="A report is not a verifiable export">
        <p>
          A rendered report shows results. The three{" "}
          <DocLink to="verifiable-exports">verifiable workbooks</DocLink> show results{" "}
          <em>and the inputs and fingerprints they were computed from</em>, which is what lets
          somebody else check them.
        </p>
        <p>
          Send a report to explain. Send the workbooks to be believed.
        </p>
      </Callout>

      <Section id="files" title="Files">
        <P>
          Uploaded and generated files are kept against the project rather than against you, so a
          file survives the person who produced it and is reachable by anyone who can reach the
          project. <DocLink to="who-can-see-your-data">Who can see your data</DocLink> is the honest
          version of who that is.
        </P>
      </Section>

      <Callout tone="limit" title="An exported file leaves this system's guarantees behind">
        <p>
          Once a workbook or a report is on somebody's machine, nothing here can mark it stale, tell
          its reader the data has changed, or delete it. The fingerprints inside it are what make it
          checkable later — which is the argument for exporting the versioned artifacts rather than
          screenshots.
        </p>
      </Callout>

      {owing && (
        <Callout tone="limit" title="This table is not yet described in the contract">
          <p>
            <Term>user_files</Term> has no per-column description and is deferred to WP {owing.wp},
            so there is no column reference to link you to.
          </p>
        </Callout>
      )}

      <Section id="related" title="Related">
        <P>
          <DocLink to="verifiable-exports">Verifiable exports</DocLink> ·{" "}
          <DocLink to="exporting-and-deleting">Exporting and deleting your data</DocLink> ·{" "}
          <DocLink to="reading-your-results">Reading your results</DocLink>
        </P>
      </Section>

      <Provenance from="the data contract's coverage register, for what it describes and what it does not" />
    </>
  );
}
