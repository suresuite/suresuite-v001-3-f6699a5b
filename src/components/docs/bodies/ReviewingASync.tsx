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

      <Callout tone="limit" title="Read this first: an ERP sync is not the CSV path with a different front door">
        <p>
          The review screen, the run record and the role check below are shared. What is{" "}
          <strong>not</strong> shared is the promotion: an ERP sync stages into its own table and is
          applied by its own function, which does not re-diff and does not take the contract's
          column rules with it.
        </p>
        <p>
          Three consequences, and each has its own box further down: a link can apply itself with
          nobody looking; the run's diff counts do not mean what the same words mean on an upload;
          and only two fields of a product actually cross.
        </p>
      </Callout>

      <Section id="the-shape" title="The shape of a sync">
        <Key>
          A sync fetches, stages and diffs before anything changes. Whether a person approves it is
          a setting.
        </Key>
        <P>
          Rows are fetched from the connected system, mapped into staged rows, and held with a diff
          against what you already have. Applying is a separate act — and it is the person with the
          review screen open, <em>unless</em> the link carries an auto-apply threshold.
        </P>
        <P>
          The review screen, the run record and the warnings are the same ones an upload produces,
          which is why the two feel alike. The rules underneath are not the same, and the sections
          below say where they part.
        </P>
      </Section>

      <Callout tone="limit" title="A link with an auto-apply threshold does not wait for you">
        <p>
          When a link has a threshold above zero and a sync's change is <em>small</em> relative to
          the live table — and nothing failed to map — the run applies <strong>itself</strong>. No
          review screen is opened and no approval is given at the time.
        </p>
        <p>
          It is attributed rather than anonymous: the write records the person who created the link
          and set the threshold, because that is when the authorisation happened. The run records
          that it was triggered automatically rather than by somebody present.
        </p>
        <p>
          <strong>Set the threshold to zero if you want every sync reviewed.</strong> A link whose
          creator has no recorded identity cannot auto-apply at all — the promotion refuses an
          unattributed write, and the run is left staged for a person instead, with the reason on
          the run.
        </p>
      </Callout>

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
        <P>
          <strong>That is the upload path.</strong> An ERP sync's diff is computed once, at landing,
          and the promotion does not recompute it — so the counts you approve are the counts as they
          were when the rows arrived.
        </P>
      </Section>

      <Callout tone="limit" title="On an ERP sync, “changed” does not mean anything changed">
        <p>
          The sync's diff asks one question per row: <em>have we seen this external id before?</em>{" "}
          If not it is <strong>new</strong>; if so it is <strong>changed</strong>. No values are
          compared. So a sync that pulls a completely unmodified catalogue reports every row as
          changed, and the unchanged count is always zero.
        </p>
        <p>
          Read the number as “rows we already had” rather than as “rows that differ”, and do not use
          it to decide whether a sync is worth reviewing. This is also what an auto-apply threshold
          is measured against, so a first sync of a large catalogue will always be far over any
          sensible threshold and a later one will always be far under it.
        </p>
      </Callout>

      <Callout tone="limit" title="Only two fields of a product actually cross">
        <p>
          A staged row carries a lot: unit of measure, lead time, minimum order quantity, unit cost,
          a supplier name, a cycle time. <strong>The promotion writes the product id and the name</strong>{" "}
          — plus the three columns that record where the row came from — and nothing else.
        </p>
        <p>
          So a sync populates your product <em>list</em>, not your product <em>economics</em>. Price,
          capacity, demand shape and fulfilment mode still come from{" "}
          <DocLink to="products">the products file</DocLink>, and a synced product with no file
          behind it reaches the engine on defaults. The staged values are kept and visible on the
          run; they are simply not applied.
        </p>
        <p>
          A product that has <em>disappeared</em> from the connected system is staged as removed and
          is <strong>not</strong> deleted here. Removing a product from your model stays a deliberate
          act.
        </p>
      </Callout>

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

      <Provenance from="supabase/contract/ingest_runs.contract.yaml and the promotion's declared role gate for the shared half; the ERP sync function and its own promotion RPC for the diff rule, the auto-apply threshold and the columns that are written — those are a different code path and the page says which fact came from which" />
    </>
  );
}
