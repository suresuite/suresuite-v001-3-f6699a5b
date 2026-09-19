// §6.3 section 13 — organizations and members.

import { PageTitle, Section, P, Key, Callout, Term, DocLink, AppLink, Provenance } from "@/components/docs/prose";
import { refTable } from "@/components/docs/tableFacts";
import { SuppliedAndComputed, DatabaseRules } from "@/components/docs/tableRef";

export default function OrganizationsAndMembers() {
  const org = refTable("organizations");
  const members = refTable("organization_members");

  return (
    <>
      <PageTitle lead="The tenant boundary, and who sits inside it.">
        Organizations and members
      </PageTitle>

      <Section id="the-boundary" title="The boundary">
        <Key>
          An organization is the wall. Projects live inside one, and nothing crosses between two
          except a person who belongs to both.
        </Key>
        <P>
          It is the coarsest and most important of the access questions, because everything finer —
          project membership, roles, capabilities — operates inside a boundary that has already been
          drawn.
        </P>
      </Section>

      <Callout tone="law" title="Organizations are matched by identity, not by name">
        <p>
          Two organizations can be called the same thing and are not the same organization. Renaming
          one does not disconnect it from its projects, and creating a second with an identical
          display name does not give it access to the first's data.
        </p>
        <p>
          That sounds obvious and it was not always true here: a display name used as a join key is
          the defect this was fixed to close, and it is proved against a real database rather than
          asserted — a rename still matches, a shared display name does not.
        </p>
      </Callout>

      <Section id="columns" title="Organizations — every column">
        <SuppliedAndComputed table={org} />
      </Section>

      <Callout tone="limit" title="One read path still matches on name">
        <p>
          The organizations table's own read rule still accepts a match on the display name or the
          slug, which is the last remaining place the rule above is not absolute. It governs reading
          the organization row itself — not its projects or its data, which are matched by identity
          — and it is recorded rather than glossed because a rule with one exception is a rule whose
          exception you should know.
        </p>
      </Callout>

      <Section id="members" title="Members — every column">
        <SuppliedAndComputed table={members} />
      </Section>

      <DatabaseRules table={org} />

      <Section id="related" title="Related">
        <P>
          <DocLink to="project-access">Project access</DocLink> ·{" "}
          <DocLink to="roles-and-capabilities">Roles and capabilities</DocLink> ·{" "}
          <DocLink to="who-can-see-your-data">Who can see your data</DocLink> ·{" "}
          <DocLink to="admin-screens">Admin screens</DocLink>
        </P>
        <P>
          Managed at <AppLink to="/admin/organizations">/admin/organizations</AppLink>.
        </P>
      </Section>

      <Provenance from="the organizations and organization_members sidecars, joined to the schema" />
    </>
  );
}
