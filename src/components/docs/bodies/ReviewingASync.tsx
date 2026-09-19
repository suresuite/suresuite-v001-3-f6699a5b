// §6.3 section 10 — reviewing and applying a sync.

import { PageTitle, Section, P, Key, Callout, Steps, Term, DocLink, Provenance } from "@/components/docs/prose";
import { refTable } from "@/components/docs/tableFacts";
import { SuppliedAndComputed } from "@/components/docs/tableRef";

export default function ReviewingASync() {
  const runs = refTable("ingest_runs");

  return (
    <>
      <PageTitle lead="Seeing exactly what would change, before any of it does.">
        Reviewing and applying a sync
      </PageTitle>

      <Section id="the-shape" title="The shape of a sync">
        <Key>
          Nothing from a connected system lands in your data until a person approves it.
        </Key>
        <P>
          A sync fetches rows, parses them, checks them against the same rules an upload is checked
          against, and holds them in staging with a diff against what you already have. Applying is
          a separate, deliberate act.
        </P>
        <P>
          That is the same path a CSV takes, on purpose. One review screen, one set of validation
          rules, one promotion — a second route into your data would be a second set of rules to
          keep in step, which is how they stop being in step.
        </P>
      </Section>

      <Section id="the-run" title="A run is the unit you approve">
        <P>
          Rows belong to a <em>run</em>, and approval is a decision about the run rather than about
          a row. So a sync is all-or-nothing: you cannot accept half of it and leave the rest
          staged, because half a consistent set of rows is not a consistent set of rows.
        </P>
        <SuppliedAndComputed table={runs} />
      </Section>

      <Section id="the-diff" title="The diff, and why it is computed twice">
        <Steps
          steps={[
            {
              title: "At landing",
              body: <>Every staged row is compared against what is in your data now, and marked as new, changed or unchanged.</>,
            },
            {
              title: "On demand",
              body: <>Recomputed whenever you open the review, because your data may have moved since the rows landed.</>,
            },
            {
              title: "Inside the promotion",
              body: (
                <>
                  Computed <em>again</em>, in the same transaction that writes. This is the one that
                  counts: the review screen shows a decision, and the promotion verifies the
                  decision still describes what it is about to do.
                </>
              ),
            },
          ]}
        />
        <P>
          The two answers are cross-checked against each other, and a disagreement raises rather
          than reporting a promotion that did something else.
        </P>
      </Section>

      <Callout tone="law" title="Approval needs a role, and the role is checked in the database">
        <p>
          Promoting needs project role <Term>{runs.governance?.minProjectRole ?? "editor"}</Term> or
          above, and the check is inside the promotion itself rather than in the screen that offers
          the button. A request that reaches the database another way is refused the same way.
        </p>
        <p>
          The audit row the promotion writes names the person who approved it and the role they
          acted under. <DocLink to="audit-log">Audit log</DocLink> covers what that record does and
          does not prove.
        </p>
      </Callout>

      <Section id="related" title="Related">
        <P>
          <DocLink to="connecting-erp">Connecting an ERP / MRP system</DocLink> ·{" "}
          <DocLink to="uploading-data">Uploading data</DocLink> ·{" "}
          <DocLink to="csv-vs-connector">CSV or connector</DocLink> ·{" "}
          <DocLink to="how-your-data-flows">How your data flows</DocLink>
        </P>
      </Section>

      <Provenance from="supabase/contract/ingest_runs.contract.yaml and the promotion's declared role gate" />
    </>
  );
}
