// §6.3 section 13 — the audit log.

import { PageTitle, Section, P, Key, Callout, Term, DocLink, AppLink, Provenance } from "@/components/docs/prose";
import { refTable } from "@/components/docs/tableFacts";
import { SuppliedAndComputed, DatabaseRules } from "@/components/docs/tableRef";
import { REFERENCE_TABLES } from "@/components/docs/generated/reference.generated";

export default function AuditLog() {
  const t = refTable("audit_logs");
  const audited = REFERENCE_TABLES.filter((x) => x.governance?.audited);
  const unaudited = REFERENCE_TABLES.filter((x) => x.governance && !x.governance.audited);

  return (
    <>
      <PageTitle lead="What is recorded when your data changes — and what is not, yet.">
        Audit log
      </PageTitle>

      <Section id="what-is-recorded" title="What a row records">
        <Key>
          One row per statement that changed data: which table, what kind of change, when, and who
          the request said was doing it.
        </Key>
        <P>
          Statement grain rather than row grain, deliberately. A load of two thousand rows is one
          act by one person, and two thousand audit rows would bury it rather than describe it.
        </P>
        <SuppliedAndComputed table={t} />
      </Section>

      <Section id="coverage" title="What is covered">
        <P>
          {audited.length} of the {audited.length + unaudited.length} described tables write an audit
          row on every change. The promotion that lands reviewed data also records the role the
          person was acting under, so the row says the database agreed they could write.
        </P>
        {unaudited.length > 0 && (
          <P>
            {unaudited.length} described tables write no audit row. Each says so on its own page,
            because which tables are audited changes and a list in prose here would not.
          </P>
        )}
      </Section>

      <Callout tone="limit" title="An audit row names the identity the client presented">
        <p>
          This application signs you in against its own approved-user list rather than a managed
          identity provider, so the user id that arrives with a change is asserted by the browser.
          The database checks that this user can reach the project — a real constraint, checked
          server-side — and it does not verify that the person is who the request says.
        </p>
        <p>
          So the log answers <em>what changed, when, and under whose asserted identity</em>. It does
          not answer <em>who</em> in the sense a court would want.{" "}
          <DocLink to="who-can-see-your-data">Who can see your data</DocLink> is the fuller version
          of that.
        </p>
      </Callout>

      <Callout tone="limit" title="Some writes reach the database without naming anybody">
        <p>
          A request authenticated by an API key has no user behind it, so what it writes is recorded
          with no actor. Naming a fabricated user would be worse — an audit trail reading as though
          somebody acted when nobody did — so the field is left empty and the gap is stated here.
        </p>
      </Callout>

      <Callout title="The log outlives what it describes">
        <p>
          Deleting a project removes its data and does not remove the record that the data existed
          and was changed. A log a person could erase by deleting what it describes would not be a
          log. <DocLink to="exporting-and-deleting">Exporting and deleting your data</DocLink>{" "}
          covers what deletion does reach.
        </p>
      </Callout>

      <DatabaseRules table={t} />

      <Section id="related" title="Related">
        <P>
          <DocLink to="who-can-see-your-data">Who can see your data</DocLink> ·{" "}
          <DocLink to="admin-screens">Admin screens</DocLink> ·{" "}
          <DocLink to="reviewing-a-sync">Reviewing and applying a sync</DocLink>
        </P>
        <P>
          Read it at <AppLink to="/admin/audit">/admin/audit</AppLink>.
        </P>
      </Section>

      <Provenance from="the audit_logs sidecar and every sidecar's declared audit state" />
    </>
  );
}
