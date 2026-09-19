// §6.3 section 13 — the administrative surfaces.

import { PageTitle, Section, P, Key, Callout, Term, DocLink, AppLink, Provenance } from "@/components/docs/prose";
import { REFERENCE_TABLES } from "@/components/docs/generated/reference.generated";

const SCREENS: { path: string; what: string; care: string }[] = [
  {
    path: "/admin/users",
    what: "Who may sign in, and each person's own entitlements.",
    care: "This is where the AI allow-list lives, and clearing it grants every model rather than revoking them.",
  },
  {
    path: "/admin/roles",
    what: "Roles and the capabilities each one carries.",
    care: "Removing a grant and denying a capability are different acts with different results.",
  },
  {
    path: "/admin/organizations",
    what: "The tenant boundary and its members.",
    care: "Two organizations can share a display name and are not the same organization.",
  },
  { path: "/admin/projects", what: "Every project, across organizations.", care: "" },
  {
    path: "/admin/models",
    what: "Which AI models are configured and available.",
    care: "A model available here can still be unusable because a budget is spent.",
  },
  { path: "/admin/usage", what: "Spend against budgets, over time.", care: "" },
  {
    path: "/admin/audit",
    what: "What changed, when, and under whose asserted identity.",
    care: "Not every table writes here, and the identity is the one the client presented.",
  },
];

export default function AdminScreens() {
  const superAdminTables = REFERENCE_TABLES.filter((t) => t.governance?.write === "super_admin").length;

  return (
    <>
      <PageTitle lead="The administrative surfaces, what each one controls, and where each one surprises people.">
        Admin screens
      </PageTitle>

      <Section id="who-gets-here" title="Who reaches these">
        <Key>
          Administrators. {superAdminTables} of the described tables can only be written by one, and
          they are the ones that decide what everybody else can do.
        </Key>
        <P>
          Changing something here changes it for other people, which is the whole reason the
          surfaces are separate from the product.
        </P>
      </Section>

      <Section id="the-screens" title="The screens">
        <div className="divide-y divide-border rounded-sm border border-border bg-card shadow-xs">
          {SCREENS.map((s) => (
            <div key={s.path} className="p-4">
              <AppLink to={s.path}>
                <span className="font-mono text-[13px] font-semibold">{s.path}</span>
              </AppLink>
              <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{s.what}</p>
              {s.care && (
                <p className="mt-1 text-[12px] leading-relaxed text-foreground">
                  <span className="font-medium">Worth knowing:</span> {s.care}
                </p>
              )}
            </div>
          ))}
        </div>
      </Section>

      <Callout tone="limit" title="The one that reverses: clearing an AI allow-list grants everything">
        <p>
          On <AppLink to="/admin/users">/admin/users</AppLink>, a person's permitted-model list is
          treated as an allow-list <em>only while it has entries</em>. Emptying it — the intuitive
          way to take access away — means <strong>no restriction</strong>, so it grants every
          configured model.
        </p>
        <p>
          To restrict somebody, list what they may use. To remove one model, take it out of a list
          that still contains the others.{" "}
          <DocLink to="models-budgets-limits">Models, budgets and limits</DocLink> has the full
          explanation and why the behaviour is the way it is.
        </p>
      </Callout>

      <Callout tone="limit" title="Not every administrative act is in the audit log">
        <p>
          Several governance tables carry no audit triggers, so a change made on one of these
          screens may leave no record. Each table's own reference page says which it is, and{" "}
          <DocLink to="audit-log">Audit log</DocLink> covers the shape of the gap.
        </p>
      </Callout>

      <Section id="related" title="Related">
        <P>
          <DocLink to="roles-and-capabilities">Roles and capabilities</DocLink> ·{" "}
          <DocLink to="organizations-and-members">Organizations and members</DocLink> ·{" "}
          <DocLink to="audit-log">Audit log</DocLink> ·{" "}
          <DocLink to="models-budgets-limits">Models, budgets and limits</DocLink>
        </P>
      </Section>

      <Provenance from="the write capability every sidecar declares, and App.tsx's own route table" />
    </>
  );
}
