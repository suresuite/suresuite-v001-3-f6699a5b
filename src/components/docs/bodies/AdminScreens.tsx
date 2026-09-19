// §6.3 section 13 — the administrative surfaces.

import { PageTitle, Section, P, Key, Callout, Term, DocLink, AppLink, Provenance } from "@/components/docs/prose";
import { REFERENCE_TABLES } from "@/components/docs/generated/reference.generated";
import { ADMIN_SCREENS } from "@/components/docs/generated/policy.generated";

/** What each screen is for, keyed by the router's own path. The LIST of screens
 *  is derived — a hand-written one had seven of the nine, and was missing the
 *  page its own worked example pointed at. */
const WHAT: Record<string, { what: string; care?: string }> = {
  "/admin": {
    what: "The landing page for the administrative area — where the other screens are reached from.",
  },
  "/admin/users": {
    what: "Who may sign in, and the way into each person's own entitlements.",
    care: "The entitlements themselves are on the per-user page below, not here.",
  },
  "/admin/users/:userId": {
    what: "One person's access: their role, their capability grants and denials, and their permitted AI models.",
    care: "This is where the AI allow-list lives, and clearing it grants every model rather than revoking them.",
  },
  "/admin/roles": {
    what: "Roles and the capabilities each one carries.",
    care: "Removing a grant and denying a capability are different acts with different results.",
  },
  "/admin/organizations": {
    what: "The tenant boundary and its members.",
    care: "Two organizations can share a display name and are not the same organization.",
  },
  "/admin/projects": { what: "Every project, across organizations." },
  "/admin/models": {
    what: "Which AI models are configured and available.",
    care: "A model available here can still be unusable because a budget is spent.",
  },
  "/admin/usage": { what: "Spend against budgets, over time." },
  "/admin/audit": {
    what: "What changed, when, and under whose asserted identity.",
    care: "Not every table writes here, and the identity is the one the client presented.",
  },
};

export default function AdminScreens() {
  const superAdminTables = REFERENCE_TABLES.filter((t) => t.governance?.write === "super_admin").length;
  const { routes, gates, pageCapabilities } = ADMIN_SCREENS;

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

      <Section id="the-screens" title={`The ${routes.length} screens`}>
        <div className="divide-y divide-border rounded-sm border border-border bg-card shadow-xs">
          {routes.map((r) => {
            const meta = WHAT[r.path];
            return (
              <div key={r.path} className="p-4">
                {r.path.includes(":") ? (
                  <span className="font-mono text-[13px] font-semibold text-foreground">{r.path}</span>
                ) : (
                  <AppLink to={r.path}>
                    <span className="font-mono text-[13px] font-semibold">{r.path}</span>
                  </AppLink>
                )}
                <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
                  {meta?.what ?? (
                    <span className="text-destructive">
                      Not described on this page. The router serves this screen and the manual has
                      no sentence for it — a blind spot, printed rather than guessed at.
                    </span>
                  )}
                </p>
                {meta?.care && (
                  <p className="mt-1 text-[12px] leading-relaxed text-foreground">
                    <span className="font-medium">Worth knowing:</span> {meta.care}
                  </p>
                )}
              </div>
            );
          })}
        </div>
        <P>
          A path with a colon in it is reached by clicking through rather than typed — the per-user
          page opens from a row on the user list.
        </P>
      </Section>

      {gates.length === 1 && (
        <Callout tone="limit" title="Administrative access is one grant, not nine">
          <Key>
            Every screen above is gated by the same capability. There is no way to grant somebody
            the usage screen without also granting them the roles screen.
          </Key>
          <p>
            The product declares {pageCapabilities} page capabilities and exactly{" "}
            <strong>one</strong> of them covers this entire area. A path is matched to the longest
            declared capability it starts under, and every administrative path starts under{" "}
            <Term>{gates[0]}</Term>.
          </p>
          <p>
            So “give them access to usage reporting” is, today, “make them an administrator”. If
            that is more than you meant, the alternative is not a narrower grant — it is not
            granting it, and running the report for them. We would rather say that than let an
            administrator discover it by watching somebody open the roles screen.
          </p>
        </Callout>
      )}

      <Callout tone="limit" title="The one that reverses: clearing an AI allow-list grants everything">
        <p>
          On a person's own access page — opened from{" "}
          <AppLink to="/admin/users">/admin/users</AppLink>, not on the list itself — their
          permitted-model list is treated as an allow-list <em>only while it has entries</em>.
          Emptying it, the intuitive way to take access away, means <strong>no restriction</strong>,
          so it grants every configured model.
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

      <Provenance from="the write capability every sidecar declares, App.tsx's own route table, and the page-capability catalog resolved by the same longest-prefix rule the application uses to gate a path" />
    </>
  );
}
