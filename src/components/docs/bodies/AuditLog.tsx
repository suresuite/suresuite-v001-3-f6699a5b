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
          act by one person, and two thousand audit rows would bury it rather than describe it. A
          data change also names the projects it touched.
        </P>
        <P>
          Three kinds of entry share the log: what an administrator did (users, organizations,
          projects, access rules, API keys), what changed in your data, and access events —
          every sign-in, every wrong password for a registered account, and every export,
          allowed or refused. A sign-in is recorded by the database after it has checked the
          password, so a browser cannot write one for somebody else.
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

      <Callout title="Nothing in the log can be edited or deleted — and you can check">
        <p>
          The database refuses to change or remove an entry once it is written. Each entry is also
          sealed with a fingerprint of its own content and of the entry before it, so an entry
          that was altered, removed or slipped in afterwards breaks the chain at that point.
          The audit screen checks the whole chain when it opens and names the first break.
        </p>
        <p>
          What the chain cannot prove on its own is that nobody with full control of the
          database rewrote it from some point onward, or cut entries off its end. What proves
          that is the chain&apos;s latest fingerprint recorded somewhere else — the audit screen
          shows it, with a button to copy it, for exactly that reason.
        </p>
      </Callout>

      <Callout title="The log outlives what it describes">
        <p>
          Deleting a project removes its data and does not remove the record that the data existed
          and was changed. A log a person could erase by deleting what it describes would not be a
          log. The same holds for people: deleting a user keeps their entries, which then read
          &ldquo;deleted user&rdquo; because the name left with the account.{" "}
          <DocLink to="exporting-and-deleting">Exporting and deleting your data</DocLink>{" "}
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
          Read it at <AppLink to="/admin/audit">/admin/audit</AppLink> — super admins only — over
          the last 24 hours, 7 days or 30 days, with a summary of who signed in and what they
          changed.
        </P>
      </Section>

      <Provenance from="the audit_logs sidecar and every sidecar's declared audit state" />
    </>
  );
}
