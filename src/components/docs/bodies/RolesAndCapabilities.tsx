// §6.3 section 13 — roles and capabilities.
//
// The page that has to say D66: `min_project_role` is declared on every table
// in the contract and read by NOTHING. The count is computed from the generated
// module so the sentence cannot go stale in either direction.

import { PageTitle, Section, P, Key, Callout, Term, DocLink, AppLink, Provenance } from "@/components/docs/prose";
import { REFERENCE_TABLES } from "@/components/docs/generated/reference.generated";
import { FEATURE_CAPABILITIES, PAGE_CAPABILITIES } from "@/lib/capabilities.generated";

export default function RolesAndCapabilities() {
  const declared = REFERENCE_TABLES.filter((t) => t.governance?.minProjectRole).length;
  const roles = [...new Set(REFERENCE_TABLES.map((t) => t.governance?.minProjectRole).filter(Boolean))];
  const capabilities = PAGE_CAPABILITIES.length + FEATURE_CAPABILITIES.length;

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

      <Section id="capabilities" title={`The ${capabilities} capabilities, and how one is resolved`}>
        <P>
          There are two kinds. A <strong>page</strong> capability decides whether a route opens at
          all; a <strong>feature</strong> capability decides whether something inside one is
          available. {PAGE_CAPABILITIES.length} pages and {FEATURE_CAPABILITIES.length} features,
          and the list is the whole vocabulary — a name that is not in it can never be granted.
        </P>
        <div className="space-y-4">
          <div>
            <h4 className="mb-2 text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">
              Pages — {PAGE_CAPABILITIES.length}
            </h4>
            <div className="flex flex-wrap gap-1.5">
              {PAGE_CAPABILITIES.map((c) => (
                <span
                  key={c.key}
                  title={c.description}
                  className="rounded-sm border border-border bg-muted/50 px-1.5 py-0.5 text-[11px] text-muted-foreground"
                >
                  {c.label} <span className="font-mono text-[10px]">{c.key}</span>
                </span>
              ))}
            </div>
          </div>
          <div>
            <h4 className="mb-2 text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">
              Features — {FEATURE_CAPABILITIES.length}
            </h4>
            <div className="flex flex-wrap gap-1.5">
              {FEATURE_CAPABILITIES.map((c) => (
                <span
                  key={c.key}
                  title={c.description}
                  className="rounded-sm border border-border bg-muted/50 px-1.5 py-0.5 text-[11px] text-muted-foreground"
                >
                  {c.label}
                </span>
              ))}
            </div>
          </div>
        </div>
        <P>
          <strong>One page is unconditional.</strong> Your own profile is always open — otherwise a
          person denied every page would be locked out of the screen where they change their
          password, which is the kind of dead end an access system creates once and never recovers
          from.
        </P>
      </Section>

      <Section id="resolution" title="The order the answer is found in">
        <Key>
          Narrowest first. The first layer with a row about you decides, and the answer when nobody
          has a row is <em>no</em>.
        </Key>
        <P>
          A super administrator short-circuits everything and gets true. For everybody else the
          question is asked in this order, and the first answer found is the answer:
        </P>
        <div className="divide-y divide-border rounded-sm border border-border bg-card shadow-xs">
          {[
            ["you", "a grant or denial set on your own account"],
            ["your organization", "a grant or denial set for everyone in it"],
            ["your role", "what the role you hold carries by default"],
            ["nobody", "no row anywhere — the answer is no, not yes"],
          ].map(([who, what], i) => (
            <div key={who} className="flex gap-3 p-4">
              <span className="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-muted text-xs font-semibold text-foreground">
                {i + 1}
              </span>
              <div>
                <span className="text-[13px] font-semibold text-foreground">{who}</span>
                <p className="mt-0.5 text-[13px] leading-relaxed text-muted-foreground">{what}</p>
              </div>
            </div>
          ))}
        </div>
        <Callout title="No row and a denial are different answers">
          <p>
            A missing grant means <em>ask the next layer</em>. An explicit <Term>false</Term> means{" "}
            <em>deny, here, now</em>, and it stops the chain — so denying a capability on somebody's
            own account overrides a grant their role and their organization both carry.
          </p>
          <p>
            They look similar in a list and behave oppositely. <strong>Removing a row does not
            revoke</strong>: it hands the decision back to the layer above, which may well say yes.
            To take something away from one person, deny it on their account rather than deleting
            their grant.
          </p>
        </Callout>
        <P>
          A capability the catalog does not contain resolves to nothing at all, which is why the
          list above is the whole vocabulary rather than a summary of it.
        </P>
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

      <Provenance from="the governance block every sidecar declares, and the capability catalog generated from the migrations that seed it — the resolution order is read from the capabilities_for_user function itself" />
    </>
  );
}
