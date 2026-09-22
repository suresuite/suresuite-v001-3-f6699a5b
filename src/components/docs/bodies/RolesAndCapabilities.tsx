// §6.3 section 13 — roles and capabilities.
//
// The page that has to say D66: `min_project_role` is declared on every table
// in the contract and read by almost nothing. The count is computed from the
// generated module so the sentence cannot go stale in either direction.
//
// The three role vocabularies and the project-role matrix are DERIVED, not
// authored here: the matrix and the rank ladder come from
// `capabilities.generated.ts` (read out of the migration seeds — I1, D101),
// and the screen table comes from the route guard itself. The only
// hand-written facts on this page are glosses.

import { PageTitle, Section, P, Key, Callout, Term, DocLink, AppLink, Provenance } from "@/components/docs/prose";
import { DocFigure } from "@/components/docs/DocFigure";
import { REFERENCE_TABLES } from "@/components/docs/generated/reference.generated";
import {
  FEATURE_CAPABILITIES,
  PAGE_CAPABILITIES,
  PROJECT_ROLES,
  PROJECT_ROLE_RANK,
  PROJECT_ROLE_DEFAULTS,
} from "@/lib/capabilities.generated";
import { ROUTE_PERMISSIONS } from "@/lib/permissions";
import type { UserRole } from "@/hooks/useUserRole";
import { FROZEN_CELL } from "@/components/shared/frozenCell";

/** Display order for the global vocabulary: widest first, like PROJECT_ROLES. */
const GLOBAL_ROLES: UserRole[] = ["super_admin", "admin", "modeler", "user"];

const GLOBAL_GLOSS: Record<UserRole, string> = {
  super_admin:
    "Everything, everywhere — the checks below are skipped entirely, and this is the only role that opens the administration area.",
  admin:
    "The full working surface: every workspace, the Project Manager and the Developer API, with every feature on by default.",
  modeler:
    "The builder's role. The same default surface as admin — the two differ by what older row rules name and by convention, not by their default grants.",
  user:
    "Read and analyse. Every workspace opens, but creating projects, editing data and running simulations are off by default.",
};

const ORG_ROLES: { role: string; gloss: string }[] = [
  { role: "owner", gloss: "The organization's principal. Together with admin, may issue and revoke the organization's API keys." },
  { role: "admin", gloss: "Manages the organization. The same API-key right as owner." },
  { role: "member", gloss: "Belongs. Sees their own membership row and nothing about who else is in the organization." },
];

const PROJECT_GLOSS: Record<string, string> = {
  owner: "The project's principal — a project's creator holds this automatically.",
  editor: "May rewrite the measured inputs and the decisions alike.",
  analyst: "May retune decisions, and may not rewrite the measured data those decisions are judged against.",
  viewer: "May look.",
};

/** The four grid rows, in the order the split is best explained in. */
const MATRIX_KEYS = ["data_edit_inputs", "data_edit_policies", "simulation_lab", "export"];

function YesNo({ allowed }: { allowed: boolean }) {
  return allowed ? (
    <span className="font-semibold text-foreground">yes</span>
  ) : (
    <span className="text-muted-foreground/70" aria-label="no">&mdash;</span>
  );
}

export default function RolesAndCapabilities() {
  const declared = REFERENCE_TABLES.filter((t) => t.governance?.minProjectRole).length;
  const capabilities = PAGE_CAPABILITIES.length + FEATURE_CAPABILITIES.length;

  // Route → allowed roles, folding the `/admin/*` wildcard into `/admin`.
  const routes = Object.entries(ROUTE_PERMISSIONS).filter(([path]) => !path.endsWith("/*"));
  const pageLabel = new Map(PAGE_CAPABILITIES.map((c) => [c.key, c.label]));
  const featureLabel = new Map(FEATURE_CAPABILITIES.map((c) => [c.key, c.label]));

  const grant = new Map(
    PROJECT_ROLE_DEFAULTS.map((g) => [`${g.projectRole}:${g.capabilityKey}`, g.allowed]),
  );

  return (
    <>
      <PageTitle lead="The three kinds of role you can hold, what each one may do, and where that is decided.">
        Roles and capabilities
      </PageTitle>

      <Section id="three-vocabularies" title="Three vocabularies, one person">
        <Key>
          You hold up to three roles at once: one on the platform, one in your organization, and
          one on each project. They are separate vocabularies, deliberately — a grant in one never
          silently becomes a grant in another.
        </Key>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div className="rounded-sm border border-border bg-card p-4 shadow-xs">
            <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Platform
            </div>
            <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
              One per account, set by an administrator. A new account starts as{" "}
              <Term>user</Term>, the least of the four.
            </p>
            <ul className="mt-3 space-y-2">
              {GLOBAL_ROLES.map((r) => (
                <li key={r}>
                  <Term>{r}</Term>
                  <p className="mt-0.5 text-[13px] leading-relaxed text-muted-foreground">
                    {GLOBAL_GLOSS[r]}
                  </p>
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-sm border border-border bg-card p-4 shadow-xs">
            <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Organization
            </div>
            <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
              Your standing inside the tenant wall —{" "}
              <DocLink to="organizations-and-members">the boundary itself</DocLink> is drawn by
              which organization you are in, not by this role.
            </p>
            <ul className="mt-3 space-y-2">
              {ORG_ROLES.map(({ role, gloss }) => (
                <li key={role}>
                  <Term>{role}</Term>
                  <p className="mt-0.5 text-[13px] leading-relaxed text-muted-foreground">{gloss}</p>
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-sm border border-border bg-card p-4 shadow-xs">
            <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Project
            </div>
            <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
              Which rooms, inside the wall. Four levels, strictly ordered — the ladder below and
              the matrix under it.
            </p>
            <ul className="mt-3 space-y-2">
              {PROJECT_ROLES.map((r) => (
                <li key={r}>
                  <Term>{r}</Term>
                  <p className="mt-0.5 text-[13px] leading-relaxed text-muted-foreground">
                    {PROJECT_GLOSS[r]}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        </div>
        <Callout title="The word owner appears twice and means two things">
          <p>
            An organization <Term>owner</Term> and a project <Term>owner</Term> are different
            standings in different vocabularies. Neither implies the other, and the system never
            translates between them — overloading one for the other is how a project grant would
            silently become an organization grant.
          </p>
        </Callout>
      </Section>

      <Section id="global-roles" title="What each platform role opens">
        <P>
          The screens, from the route guard the application actually runs. A super administrator
          passes every check, so the first column is uniform by construction.
        </P>
        <div className="overflow-x-auto rounded-sm border border-border bg-card shadow-xs">
          <table className="w-full min-w-[520px] border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-border">
                <th className={`p-3 text-left font-semibold text-foreground ${FROZEN_CELL}`}>Screen</th>
                {GLOBAL_ROLES.map((r) => (
                  <th key={r} className="p-3 text-center font-mono text-[11px] font-semibold text-foreground">
                    {r}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {routes.map(([path, allowed]) => (
                <tr key={path} className="border-b border-border last:border-b-0">
                  <td className={`p-3 ${FROZEN_CELL}`}>
                    <span className="text-foreground">{pageLabel.get(path) ?? path}</span>{" "}
                    <span className="font-mono text-[11px] text-muted-foreground">{path}</span>
                  </td>
                  {GLOBAL_ROLES.map((r) => (
                    <td key={r} className="p-3 text-center">
                      <YesNo allowed={r === "super_admin" || allowed.includes(r)} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <P>
          Features follow the same split: <Term>admin</Term> and <Term>modeler</Term> carry every
          feature by default, while <Term>user</Term> carries the read-oriented ones — the AI
          assistant, Project Intelligence and export — and not data editing or the Simulation Lab.
          Any of it can be changed per organization or per person, which is the next section.
        </P>
      </Section>

      <Section id="capabilities" title={`The ${capabilities} capabilities, and how one is resolved`}>
        <P>
          A <em>capability</em> is a named thing you may do; a role is a bundle of them. There are
          two kinds. A <strong>page</strong> capability decides whether a route opens at all; a{" "}
          <strong>feature</strong> capability decides whether something inside one is available.{" "}
          {PAGE_CAPABILITIES.length} pages and {FEATURE_CAPABILITIES.length} features, and the
          list is the whole vocabulary — a name that is not in it can never be granted.
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
        <DocFigure id="capability-layers" />
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
            ["your role on this project", "what your project role carries — consulted when the question is about a project"],
            ["your organization", "a grant or denial set for everyone in it"],
            ["your platform role", "what the role you hold carries by default"],
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
          list above is the whole vocabulary rather than a summary of it. On a screen that is not
          about one project — the admin area, your profile — the project layer is simply skipped.
        </P>
      </Section>

      <Section id="project-roles" title="Project roles — the ladder and the matrix">
        <P>
          The four levels are strictly ordered —{" "}
          {PROJECT_ROLES.map((r, i) => (
            <span key={r}>
              {i > 0 && <span className="text-muted-foreground"> &gt; </span>}
              <Term>{r}</Term>
            </span>
          ))}{" "}
          — and the ordering is written in exactly one place, so "is this grant bigger than mine"
          cannot be answered two different ways. What each level carries by default:
        </P>
        <div className="overflow-x-auto rounded-sm border border-border bg-card shadow-xs">
          <table className="w-full min-w-[520px] border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-border">
                <th className={`p-3 text-left font-semibold text-foreground ${FROZEN_CELL}`}>May they…</th>
                {PROJECT_ROLES.map((r) => (
                  <th key={r} className="p-3 text-center font-mono text-[11px] font-semibold text-foreground">
                    {r}
                    <span className="block font-sans text-[10px] font-normal text-muted-foreground">
                      rank {PROJECT_ROLE_RANK[r]}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {MATRIX_KEYS.map((key) => (
                <tr key={key} className="border-b border-border last:border-b-0">
                  <td className={`p-3 ${FROZEN_CELL}`}>
                    <span className="text-foreground">{featureLabel.get(key) ?? key}</span>
                    <span className="block text-[11px] text-muted-foreground">
                      {FEATURE_CAPABILITIES.find((c) => c.key === key)?.description}
                    </span>
                  </td>
                  {PROJECT_ROLES.map((r) => (
                    <td key={r} className="p-3 text-center">
                      <YesNo allowed={grant.get(`${r}:${key}`) ?? false} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <P>
          The split in the first two rows is the point of the vocabulary: an{" "}
          <Term>analyst</Term> may retune the decisions and may not rewrite the measured inputs
          those decisions are judged against. Roles can also be lent for a time — a delegation
          only <em>subtracts</em> (never more than the grantor holds) and always expires.{" "}
          <DocLink to="project-access">Project access</DocLink> has the two rules, the columns of
          both tables, and the honest note that there is no screen for any of it yet.
        </P>
        <Callout title="One gate reads the ladder today">
          <p>
            Promoting reviewed data into your project's canonical tables refuses anyone below{" "}
            <Term>editor</Term>, and the audit row the promotion writes records the role it
            resolved. That is the one live reader; the next callout is about all the others.
          </p>
        </Callout>
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
          Managed at <AppLink to="/admin/roles">/admin/roles</AppLink> (role defaults) and{" "}
          <AppLink to="/admin/users">/admin/users</AppLink> (who holds which).
        </P>
      </Section>

      <Provenance from="the governance block every sidecar declares; the capability catalog, the project-role ladder and the project-role matrix generated from the migrations that seed them; the screen table read from the route guard itself — the resolution order is read from the capabilities_for_user function" />
    </>
  );
}
