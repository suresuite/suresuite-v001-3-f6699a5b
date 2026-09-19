// §6.3 section 13 — roles and capabilities.
//
// The page that has to say D66: `min_project_role` is declared on every table
// in the contract and read by NOTHING. The count is computed from the generated
// module so the sentence cannot go stale in either direction.

import { PageTitle, Section, P, Key, Callout, Term, DocLink, AppLink, Provenance } from "@/components/docs/prose";
import { REFERENCE_TABLES } from "@/components/docs/generated/reference.generated";

export default function RolesAndCapabilities() {
  const declared = REFERENCE_TABLES.filter((t) => t.governance?.minProjectRole).length;
  const roles = [...new Set(REFERENCE_TABLES.map((t) => t.governance?.minProjectRole).filter(Boolean))];

  return (
    <>
      <PageTitle lead="What a role may do, where that is decided, and where it is only declared.">
        Roles and capabilities
      </PageTitle>

      <Section id="two-systems" title="Two systems, and they are not the same system">
        <Key>
          A <em>capability</em> is a named thing you may do. A <em>role</em> is a bundle of them.
          Both exist here, and so does a third answer — the database's own row rules — which is the
          one that actually decides whether you see a row.
        </Key>
        <P>
          Understanding which of the three refused you is most of understanding an access problem in
          this product.
        </P>
      </Section>

      <Section id="capabilities" title="Capabilities, resolved in layers">
        <P>
          A capability is granted at four widths: to a role, to an organization, to a project role,
          and to one person. The layers resolve outwards — the narrowest layer that has an opinion
          decides, and a layer with no row means "ask the next one out".
        </P>
        <Callout title="No row and a denial are different answers">
          <p>
            A missing grant means <em>inherit</em>. An explicit <Term>false</Term> means{" "}
            <em>deny here</em>, and it stops the chain. They look similar in a list and behave
            oppositely, which is worth knowing before you remove a row expecting it to revoke
            something.
          </p>
        </Callout>
      </Section>

      <Section id="project-roles" title="Project roles">
        <P>
          Separately from organization-wide capabilities, a project has members with roles —{" "}
          {roles.map((r, i) => (
            <span key={r}>
              {i > 0 && ", "}
              <Term>{r as string}</Term>
            </span>
          ))}{" "}
          are the levels the contract names. A role can be delegated to somebody else, and a
          delegation can only <em>subtract</em>: you cannot grant more than you hold, and every
          delegation expires.
        </P>
      </Section>

      <Callout tone="limit" title="Every table declares a minimum role. Almost nothing reads it.">
        <p>
          All {declared} tables in the data contract declare a minimum project role for writing.{" "}
          <strong>One live path checks it</strong> — the promotion that lands reviewed data. Every
          other write is governed by the database's row rules instead, which ask a different
          question: not <em>what role do you hold</em> but <em>can you reach this project at all</em>.
        </p>
        <p>
          <strong>The two can disagree, and the disagreement is not theoretical.</strong> A person
          with the editor role on a project, who is not that project's modeler, passes the promotion
          gate and is then refused by the row rules on the very rows they were promoting. The
          declaration is a design that has not been made live, and until it is, the role you see on
          a membership screen is not the thing deciding your access.
        </p>
      </Callout>

      <Section id="related" title="Related">
        <P>
          <DocLink to="project-access">Project access</DocLink> ·{" "}
          <DocLink to="who-can-see-your-data">Who can see your data</DocLink> ·{" "}
          <DocLink to="organizations-and-members">Organizations and members</DocLink> ·{" "}
          <DocLink to="admin-screens">Admin screens</DocLink>
        </P>
        <P>
          Managed at <AppLink to="/admin/roles">/admin/roles</AppLink>.
        </P>
      </Section>

      <Provenance from="the governance block every sidecar declares, and the capability catalog the migrations define" />
    </>
  );
}
