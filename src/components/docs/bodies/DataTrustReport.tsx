// §6.3 section 6 — the Data Trust Report (A3).
//
// Describes what the reader SEES, section by section. The report itself is
// computed per project and cannot be rendered here without one, so this page
// does not attempt to mirror its numbers — mirroring them would be a second
// authoring of every figure in it, which is the defect this manual exists to
// end. What it documents is the vocabulary, and above all the THREE staleness
// states, because reading `unknown` as `stale` is the single most likely way to
// misread the report.

import { PageTitle, Section, P, Key, Callout, Defs, Term, DocLink, AppLink, Provenance } from "@/components/docs/prose";

export default function DataTrustReport() {
  return (
    <>
      <PageTitle lead="Coverage, freshness, ingest history and known limits, for one project, in one place.">
        Data Trust Report
      </PageTitle>

      <Section id="what-it-answers" title="The question it answers">
        <Key>
          Is this model built on good data — and where is it not?
        </Key>
        <P>
          <DocLink to="verify-your-inputs">Verify your inputs</DocLink> tells you whether a run can
          start. This tells you what the run would be standing on. They are different questions and
          a model can pass the first while failing the second badly.
        </P>
        <P>
          Open it beside the pre-run gate at <AppLink to="/policies">/policies</AppLink>.
        </P>
      </Section>

      <Section id="sections" title="What is in it">
        <Defs
          items={[
            {
              term: "Headline",
              def: (
                <>
                  One line. It is never better than the limits below it allow — a report with
                  unexplained rows does not say “all clear”.
                </>
              ),
            },
            {
              term: "Dataset fingerprint",
              def: (
                <>
                  The hash of the data this report was computed against. Two reports with the same
                  fingerprint describe the same project state, whatever their timestamps say.
                </>
              ),
            },
            {
              term: "Coverage",
              def: (
                <>
                  Per field the engine reads: how many entities got a value from your data, how many
                  from a named substitution, and how many from nothing. The third number is the one
                  that blocks.
                </>
              ),
            },
            {
              term: "Substitutions",
              def: (
                <>
                  The same list, filtered to where a rule stood in for you, with the rule's own
                  wording. <DocLink to="when-a-value-is-missing">When a value is missing</DocLink>{" "}
                  has the catalog.
                </>
              ),
            },
            {
              term: "Freshness",
              def: <>Per table: how many computed rows still describe the data you are holding.</>,
            },
            {
              term: "Ingest history",
              def: <>The recent loads into this project — where each came from and who applied it.</>,
            },
            {
              term: "Known limits",
              def: (
                <>
                  What this report cannot tell you. Some entries are true of every project; some
                  carry a count from yours. A limits block that never changes is a disclaimer, and
                  this one is meant to change.
                </>
              ),
            },
          ]}
        />
      </Section>

      <Callout tone="law" title="Freshness has three states, and unknown is not stale">
        <p>
          <Term>fresh</Term> — the row was computed from the data you are holding now.
        </p>
        <p>
          <Term>stale</Term> — the row was computed from a different version of this project. Any
          figure that depends on it describes a project state that no longer exists.
        </p>
        <p>
          <Term>unknown</Term> — <strong>we cannot tell.</strong> The row was written before
          provenance existed, so it carries nothing saying which data produced it. It may be
          perfectly current.
        </p>
        <p>
          Reporting <Term>unknown</Term> as <Term>stale</Term> would be answering a question with a
          guess, and reporting it as <Term>fresh</Term> would be worse. The third state exists so
          that the report can decline to answer, which is the only honest thing it can do about a
          row written before anything recorded where it came from.
        </p>
      </Callout>

      <Section id="the-one-that-changes-a-run" title="The finding that is not about display">
        <P>
          Most stale rows affect what you read. One kind affects what runs: a policy override seeded
          from data the project no longer holds. <strong>The engine reads overrides, not the
          grid.</strong> So a stale seeded override means the simulation uses a number that is not
          the one on screen.
        </P>
        <P>
          It is called out separately in the report for that reason. <DocLink to="how-policies-work">
          How policies work</DocLink> explains why a row-level value and a bundle value behave
          differently on a re-upload, which is the mechanism behind it.
        </P>
      </Section>

      <Section id="cannot-compute" title="What it does when it cannot compute a section">
        <P>
          It says so, and renders nothing else. A trust report that quietly omitted the part it
          could not calculate would be claiming a clean bill it never checked — which is precisely
          the failure the whole transparency standard exists to prevent.
        </P>
      </Section>

      <Section id="related" title="Related">
        <P>
          <DocLink to="verify-your-inputs">Verify your inputs</DocLink> ·{" "}
          <DocLink to="dataset-versions">Dataset Versions</DocLink> ·{" "}
          <DocLink to="known-limits">Known limits</DocLink> ·{" "}
          <DocLink to="reproducibility-record">Reproducibility record</DocLink>
        </P>
      </Section>

      <Provenance from="the Trust Report's own assembly — its sections, its severity vocabulary and its three freshness states" />
    </>
  );
}
