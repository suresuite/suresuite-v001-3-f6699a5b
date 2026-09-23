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

      <Callout title="The rule's last exception is closed">
        <p>
          Reading the organization row itself was, for a while, the one place the rule above was
          not absolute: that read still accepted a match on the display name or the slug. It is
          identity-only now, and proved the same way — a rename still matches, a tenant with the
          same name does not, and a tenant whose slug equals another's name is no longer readable
          across the wall.
        </p>
        <p>
          The closure has one visible consequence: your account must carry its organization by
          identity, and the system <em>refuses to guess</em> when two organizations share the
          display name your account was created with. An account in that state belongs to no
          tenant until an administrator resolves it — which is the correct failure, because
          guessing either way would put the account inside a wall nobody chose.
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
