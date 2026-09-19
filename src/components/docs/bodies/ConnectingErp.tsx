// §6.3 section 10 — connecting an ERP / MRP system.

import { PageTitle, Section, P, Key, Callout, Term, DocLink, Provenance } from "@/components/docs/prose";
import { refTable } from "@/components/docs/tableFacts";
import { SuppliedAndComputed, DatabaseRules } from "@/components/docs/tableRef";

export default function ConnectingErp() {
  const t = refTable("project_erp_links");

  return (
    <>
      <PageTitle lead="Linking a project to a system of record, so the data comes to you.">
        Connecting an ERP / MRP system
      </PageTitle>

      <Section id="what-a-link-is" title="What a link is">
        <Key>
          A standing permission to read from your system, attached to one project.
        </Key>
        <P>
          Once linked, a sync can be requested and the rows arrive the same way an upload does —
          into staging, diffed against what you already have, waiting for somebody to approve.{" "}
          <DocLink to="reviewing-a-sync">Reviewing and applying a sync</DocLink> is that half.
        </P>
        <P>
          A link belongs to one project. Connecting a system does not connect it to your
          organization, and a second project needs its own link — which is deliberate: a connector
          that silently spanned projects would put one project's data in another.
        </P>
      </Section>

      <Section id="columns" title="Every column">
        <SuppliedAndComputed table={t} />
      </Section>

      <Callout tone="limit" title="Changes to a link are not recorded in the audit log">
        <p>
          {t.governance && !t.governance.audited
            ? "This table carries no audit triggers, so who created, changed or removed a connection is not written to the audit log."
            : "Every change to this table is recorded."}{" "}
          A connection is a standing grant of read access to a system of record, which is exactly
          the kind of change a reader of{" "}
          <DocLink to="audit-log">the audit log</DocLink> would expect to find there.
        </p>
        <p>
          We are stating it because the alternative is that somebody looks, finds nothing, and
          concludes nothing happened.
        </p>
      </Callout>

      <DatabaseRules table={t} />

      <Section id="related" title="Related">
        <P>
          <DocLink to="reviewing-a-sync">Reviewing and applying a sync</DocLink> ·{" "}
          <DocLink to="csv-vs-connector">CSV or connector</DocLink> ·{" "}
          <DocLink to="uploading-data">Uploading data</DocLink> ·{" "}
          <DocLink to="who-can-see-your-data">Who can see your data</DocLink>
        </P>
      </Section>

      <Provenance from="supabase/contract/project_erp_links.contract.yaml, joined to the schema" />
    </>
  );
}
