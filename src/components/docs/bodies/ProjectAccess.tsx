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

      <Callout tone="limit" title="Neither table can be written from the application">
        <p>
          There is no write rule on the membership or delegation tables, so changes go through a
          function that enforces the two rules above rather than through a direct write. That is
          deliberate and it is also a limit: it means these are not surfaces a project owner edits
          casually.
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

      <Provenance from="the project_members and delegation_grants sidecars, joined to the schema" />
    </>
  );
}
