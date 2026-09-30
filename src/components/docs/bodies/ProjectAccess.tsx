// §6.3 section 13 — project access.

import { PageTitle, Section, P, Key, Callout, Term, DocLink, AppLink, Provenance } from "@/components/docs/prose";
import { refTable } from "@/components/docs/tableFacts";
import { SuppliedAndComputed, DatabaseRules } from "@/components/docs/tableRef";

export default function ProjectAccess() {
  const members = refTable("project_members");
  const grants = refTable("delegation_grants");

  return (
    <>
      <PageTitle lead="Membership of a single project, as distinct from the organization around it.">
        Project access
      </PageTitle>

      <Section id="why-separate" title="Why this is separate from the organization">
        <Key>
          Belonging to an organization is not the same as belonging to every project in it.
        </Key>
        <P>
          Organization membership answers <em>are you inside the wall</em>. Project membership
          answers <em>which rooms</em>. A consultant who should see one study and not the rest is
          the case this exists for.
        </P>
      </Section>

      <Section id="members" title="Members — every column">
        <SuppliedAndComputed table={members} />
        <DatabaseRules table={members} />
      </Section>

      <Section id="delegation" title="Delegation, and its two rules">
        <P>
          A role can be handed to somebody else for a time. Two rules are enforced rather than
          encouraged:
        </P>
        <div className="space-y-2">
          <div className="rounded-sm border border-border bg-card p-4 shadow-xs">
            <div className="text-sm font-semibold text-foreground">It only subtracts</div>
            <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
              You cannot delegate more than you hold. Handing someone your access gives them at most
              what you have, which means a chain of delegations cannot accumulate into something
              nobody granted.
            </p>
          </div>
          <div className="rounded-sm border border-border bg-card p-4 shadow-xs">
            <div className="text-sm font-semibold text-foreground">It expires</div>
            <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
              An expiry is required, not optional, and the expiry is applied when access is
              resolved. A delegation nobody remembers to revoke revokes itself.
            </p>
          </div>
        </div>
        <SuppliedAndComputed table={grants} />
      </Section>

      <Callout title="Where project roles are set">
        <p>
          <strong>A super administrator sets project roles</strong>, in two places that write
          the same row: a person&rsquo;s page on{" "}
          <AppLink to="/admin/users">/admin/users</AppLink> (every project that person is on),
          and <AppLink to="/admin/projects">/admin/projects</AppLink> &rarr; Access &amp; roles
          (everyone on one project). The Access dialog lists everyone in the project&rsquo;s
          organization with their roles at all three levels and what they may do on the project
          today. The project&rsquo;s owner always keeps the Owner role &mdash; transfer the project
          to change who owns it &mdash; and the dialog offers a role only to members of the
          project&rsquo;s organization. You can see your own project roles on your profile, under
          My Access.
        </p>
        <p>
          <strong>Nothing delegates a role yet.</strong> The delegation rules below are the
          database&rsquo;s; there is no screen that lends a role, so the consultant who should see
          one study for a month is set up today as a member of the organization with a project
          role, removed by hand when the month is over.
        </p>
      </Callout>

      <Callout tone="limit" title="And membership is not what decides who can read your rows">
        <p>
          Project membership answers <em>which rooms</em> in the design. In the database today, one
          live path checks a project role — the promotion that lands reviewed data — and every other
          read and write is decided by the row rules, which ask about your organization and the
          project's modeler instead.
        </p>
        <p>
          <DocLink to="who-can-see-your-data">Who can see your data</DocLink> has the measured
          version of this, including how many tables are readable regardless of either. Read it
          before relying on membership to separate two pieces of work.
        </p>
      </Callout>

      <Callout title="The write path is a function, not a table rule">
        <p>
          Neither table carries a write rule, so any change goes through a function rather than
          through a direct write. That is the right design — it means the rules above cannot be
          bypassed by writing the row another way — and it is why the Access dialog is the only
          place a project role changes.
        </p>
      </Callout>

      <Callout title="A project's owner always holds the Owner role">
        <p>
          Creating a project makes you its owner and gives you the Owner role; so does an
          administrator transferring a project to you, which also removes the previous
          owner&rsquo;s role. Projects from the window before either rule existed were given
          their missing owner once. Neither admin screen will take the Owner role away from a
          project&rsquo;s owner.
        </p>
      </Callout>

      <Section id="related" title="Related">
        <P>
          <DocLink to="roles-and-capabilities">Roles and capabilities</DocLink> ·{" "}
          <DocLink to="organizations-and-members">Organizations and members</DocLink> ·{" "}
          <DocLink to="who-can-see-your-data">Who can see your data</DocLink>
        </P>
      </Section>

      <Provenance from="the project_members and delegation_grants sidecars joined to the schema; the refusals are the admin_set_project_member, admin_remove_project_member and admin_transfer_project functions, and no screen writes delegation_grants" />
    </>
  );
}
