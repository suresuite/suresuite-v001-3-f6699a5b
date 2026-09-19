// §6.3 section 13 — who can see your data.
//
// ── THE MOST LOAD-BEARING HONEST PAGE IN THE MANUAL ───────────────────────
//
// Four things have to be said plainly and none of them is comfortable:
//
//  1. Sign-in is against this application's own approved-user list, not a
//     managed identity provider, so a user id arriving with a write is
//     CLIENT-ASSERTED (§4 D28).
//  2. "RLS: enabled" reads as an assurance it does not give — it is enabled on
//     the three item masters with both policies `USING (true)` (WP 2.4), and
//     the static artifact cannot even determine it, which is a third state.
//  3. `min_project_role` is declared on every contract table and read by one
//     live path (§4 D66).
//  4. The public API's principal is a key with no user uuid, so three of its
//     calls name no actor at all (§4 D28, WP 7.1's).
//
// Every number below is computed from the generated contract rather than typed,
// so the page cannot become optimistic by going stale.

import { PageTitle, Section, P, Key, Callout, Term, DocLink, Provenance } from "@/components/docs/prose";
import { DocFigure } from "@/components/docs/DocFigure";
import { REFERENCE_TABLES } from "@/components/docs/generated/reference.generated";
import { COUNTS } from "@/components/docs/generated/dataModel.generated";
import { READ_EXPOSURE } from "@/components/docs/generated/policy.generated";

export default function WhoCanSeeYourData() {
  const described = REFERENCE_TABLES.length;
  const rlsOn = REFERENCE_TABLES.filter((t) => t.rls.enabled).length;
  const indeterminate = REFERENCE_TABLES.filter((t) => !t.rls.determinate).length;
  const allOpen = REFERENCE_TABLES.filter(
    (t) => t.rls.enabled && t.rls.policies > 0 && t.rls.unrestricted === t.rls.policies,
  );
  const audited = REFERENCE_TABLES.filter((t) => t.governance?.audited).length;
  const withRead = REFERENCE_TABLES.filter((t) => t.governance?.read).length;
  const exposure = READ_EXPOSURE;

  return (
    <>
      <PageTitle lead="The honest answer, including the parts that are not reassuring.">
        Who can see your data
      </PageTitle>

      <Section id="the-short-answer" title="The short answer">
        <Key>
          People in your organization who have been given access to your project, and the people who
          operate this system.
        </Key>
        <P>
          The rest of this page is the long answer, and it is longer because the short one leaves
          out where the boundaries are actually enforced and where they are currently only
          described.
        </P>
              <DocFigure id="three-gates" />
      </Section>

      <Section id="the-three-gates" title="Three gates, and only two of them decide">
        <P>
          A write to your data passes three checks that sound like one thing and are not.
        </P>
        <div className="space-y-3">
          <div className="rounded-sm border border-border bg-card p-4 shadow-xs">
            <div className="text-sm font-semibold text-foreground">Can you reach the project?</div>
            <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
              The database's own row rules. This is the gate that actually refuses people, and it
              asks about reachability rather than about your role.
            </p>
          </div>
          <div className="rounded-sm border border-border bg-card p-4 shadow-xs">
            <div className="text-sm font-semibold text-foreground">Do you hold the capability?</div>
            <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
              Resolved in layers from your role, your organization and you. It governs what the
              application offers you.
            </p>
          </div>
          <div className="rounded-sm border border-border bg-card p-4 shadow-xs">
            <div className="text-sm font-semibold text-foreground">
              Do you hold the minimum project role?
            </div>
            <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
              Declared on all {described} described tables and checked by <strong>one</strong> live
              path — the promotion that lands reviewed data. Everywhere else it is a design that has
              not been made live.
            </p>
          </div>
        </div>
        <Callout tone="limit" title="The first and third can disagree">
          <p>
            A person with the editor role on a project, who is not that project's modeler, passes
            the promotion's role check and is then refused by the row rules on the rows they were
            promoting. Two gates asking different questions about the same action, and only one of
            them is the one that decides.
          </p>
        </Callout>
      </Section>

      <Callout tone="limit" title="“Row-level security: enabled” is not the assurance it sounds like">
        <p>
          {rlsOn} of {described} described tables have row-level security switched on. Switched on is
          not the same as restrictive: a rule can be enabled and permit everything, and{" "}
          {allOpen.length > 0 ? (
            <>
              <strong>
                {allOpen.length}{" "}
                {allOpen.length === 1 ? "table does exactly that" : "tables do exactly that"}
              </strong>{" "}
              — every one of their rules permits every row.
            </>
          ) : (
            <>none of the described tables is in that state today.</>
          )}
        </p>
        {indeterminate > 0 && (
          <p>
            For {indeterminate} more, the static analysis of the migrations{" "}
            <strong>cannot determine</strong> the answer — a third state, and not the same as “off”.
            That is not a hedge: the three item-master tables were recorded as having it off, and
            executing the migration against a real database found it{" "}
            <em>on, with rules that permit everything</em> — the inherited claim was wrong in both
            directions at once.
          </p>
        )}
        <p>
          So the useful question is never “is RLS enabled”. It is “what does the rule say”, and that
          is on each table's own reference page.
        </p>
      </Callout>

      <Callout tone="limit" title={`And the count above answers the wrong question: ${exposure.open.length} tables are readable by everybody`}>
        <p>
          The {allOpen.length} above are tables whose <em>every</em> rule permits every row. That
          measures whether a table is unprotected, and it is not what you came here to ask. Asking
          instead <strong>which tables have a READ rule that permits every row</strong> — leaving
          their write rules as strict as they are — answers{" "}
          <strong>{exposure.open.length} of {exposure.described}</strong>.
        </p>
        <p>
          <strong>
            {exposure.signedOut.length === exposure.open.length
              ? "Every one of them"
              : `${exposure.signedOut.length} of them`}{" "}
            is readable without signing in at all
          </strong>{" "}
          — by the key this application's own browser bundle carries, which is to say by anybody who
          loads the site. They are:
        </p>
        <div className="flex flex-wrap gap-1.5">
          {exposure.open.map((t) => (
            <span
              key={t.table}
              className="rounded-sm border border-border bg-muted/50 px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground"
            >
              {t.table}
            </span>
          ))}
        </div>
        <p>
          That list includes your inbound and outbound lanes, both bills of materials, and your
          policy defaults and overrides. <strong>Your chain's structure and your decisions are not
          hidden from other organizations by a row rule today.</strong> Writing them is restricted;
          reading them is not.
        </p>
        <p>
          <strong>This is known, recorded and deliberately unchanged.</strong> The application
          itself runs under that same key with no signed-in database session, so revoking the reads
          stops the product working — the fix is an authentication model rather than a policy edit,
          and it is scheduled as its own piece of work. A test fails if the set grows.
        </p>
        <p>
          What it means for you today: treat anything in those tables as visible to everyone who can
          reach this deployment, and do not rely on project or organization boundaries to separate
          two clients' structural data. If that is not acceptable for a piece of work, the answer is
          a separate deployment, not a setting.
        </p>
      </Callout>

      <Callout tone="limit" title="Your identity is asserted by the browser, not proved">
        <p>
          This application authenticates against its own list of approved users, held in your
          browser — not against a managed identity provider. So the user id that arrives with a
          write is <strong>client-asserted</strong>.
        </p>
        <p>
          What is real: the database refuses a load into a project that user cannot reach. That is a
          genuine constraint and it is checked server-side. What it is not is proof of who did it.
          An audit row naming a person records the identity the client presented.
        </p>
        <p>
          We would rather write that down than let an audit trail imply a stronger guarantee than it
          gives. <DocLink to="audit-log">Audit log</DocLink> says what the record does prove.
        </p>
      </Callout>

      <Section id="what-is-recorded" title="What is recorded when someone touches your data">
        <P>
          {audited} of {described} described tables write an audit row on every change, naming the
          actor. Where a write goes through the promotion, the row also names the role the actor was
          acting under — so the record says the database agreed they could write, not only that they
          did.
        </P>
        <P>
          The tables that are <em>not</em> audited are named on their own pages rather than
          collected here, because “which tables are audited” is a fact that changes and a list in
          prose would not.
        </P>
      </Section>

      <Callout tone="limit" title="The public API does not carry a person at all">
        <p>
          A request authenticated with an API key has no user behind it — a key is issued to a
          project, not to a person. Three calls in the public API therefore write with no actor
          recorded.
        </p>
        <p>
          Naming a fabricated user would make the audit trail read as though somebody acted when
          nobody did, which is worse than an empty field. The gap is real and it is stated rather
          than filled. <DocLink to="getting-an-api-key">Getting an API key</DocLink> covers what
          that means for a key you issue.
        </p>
      </Callout>

      <Section id="operators" title="The people who run this system">
        <P>
          Administrators of your organization can reach your projects. So can whoever operates the
          hosting for this deployment — a database administrator can read a database, and no
          application-level rule changes that. There is no encryption scheme here that would put
          your data beyond the reach of the people who run the servers, and a manual that implied
          otherwise would be wrong.
        </P>
        <P>
          The {COUNTS.tablesInSchema} tables in the system are the surface that exists;{" "}
          <DocLink to="all-tables">All tables</DocLink> lists every one, described or not.
        </P>
      </Section>

      {withRead < described && (
        <Callout tone="limit" title="Read permissions are not declared per table">
          <p>
            {withRead} of {described} described tables declare a read capability. The rest declare
            who may WRITE and leave reading to the row rules, so this manual can tell you precisely
            who may change a table and cannot tell you as precisely who may see it.
          </p>
        </Callout>
      )}

      <Section id="related" title="Related">
        <P>
          <DocLink to="what-happens-to-your-data">What happens to your data</DocLink> ·{" "}
          <DocLink to="roles-and-capabilities">Roles and capabilities</DocLink> ·{" "}
          <DocLink to="audit-log">Audit log</DocLink> ·{" "}
          <DocLink to="known-limits">Known limits</DocLink> ·{" "}
          <DocLink to="exporting-and-deleting">Exporting and deleting your data</DocLink>
        </P>
      </Section>

      <Provenance from="every sidecar's governance and RLS blocks, counted rather than described" />
    </>
  );
}
