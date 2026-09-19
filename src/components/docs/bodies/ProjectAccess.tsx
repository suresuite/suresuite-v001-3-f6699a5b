// §6.3 section 13 — project access.

import { PageTitle, Section, P, Key, Callout, Term, DocLink, Provenance } from "@/components/docs/prose";
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

      <Callout tone="limit" title="Read this first: there is no screen for any of this">
        <p>
          <strong>Nothing in the application adds a member to a project, and nothing delegates a
          role.</strong> There is no menu item, no dialog and no button — no part of the product
          reads or writes either table. What exists is the database design above and one automatic
          rule: creating a project makes you its owner.
        </p>
        <p>
          So the consultant in the paragraph above is a case this is <em>designed</em> for and not
          one you can set up today. Adding somebody to a project is a request to whoever operates
          this deployment, not something a project owner can do.
        </p>
        <p>
          We are saying it here because a reference page describing two tables, their columns and
          their rules reads as a description of a feature, and a reader would reasonably go looking
          for the screen.
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
          Neither table carries a write rule, so any change goes through a function that enforces
          subtraction and expiry rather than through a direct write. That is the right design — it
          means the two rules above cannot be bypassed by writing the row another way — and it is
          why there is nothing to add a member <em>with</em> until something calls it.
        </p>
      </Callout>

      <Callout tone="limit" title="A project created before membership existed may have no members">
        <p>
          Membership had one writer in its life and it ran once, so projects created in a window
          afterwards had no members — including no role for their own creator. That is fixed going
          forward by a trigger that adds the creator; a project from that window may still need a
          member added by hand.
        </p>
        <p>
          It went unnoticed because nothing had ever <em>asked</em> for a project role until the
          promotion gate started checking one. A rule nothing reads cannot report that it is empty.
        </p>
      </Callout>

      <Section id="related" title="Related">
        <P>
          <DocLink to="roles-and-capabilities">Roles and capabilities</DocLink> ·{" "}
          <DocLink to="organizations-and-members">Organizations and members</DocLink> ·{" "}
          <DocLink to="who-can-see-your-data">Who can see your data</DocLink>
        </P>
      </Section>

      <Provenance from="the project_members and delegation_grants sidecars joined to the schema; the absence of a surface is an import scan over src/, where neither table appears outside this manual" />
    </>
  );
}
